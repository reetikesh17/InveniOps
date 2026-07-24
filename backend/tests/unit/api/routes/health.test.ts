import { describe, expect, it } from "vitest";
import { buildHealthResponse, type BuildHealthResponseInput } from "../../../../src/api/routes/health.js";
import type { HealthSnapshot } from "../../../../src/services/observability/healthProbeInstance.js";
import type { BufferStats } from "../../../../src/services/ingestion/buffer.js";
import { Severity } from "@prisma/client";

const UP = { status: "up" as const, latencyMs: 5 };
const DOWN = { status: "down" as const, latencyMs: 2000 };

function allUpDependencies(): HealthSnapshot {
  return { postgres: UP, mongo: UP, redis: UP, queue: UP };
}

function makeBufferStats(overrides: Partial<BufferStats> = {}): BufferStats {
  return {
    capacity: 1000,
    totalSize: 10,
    fillFraction: 0.01,
    state: "normal",
    depthBySeverity: { [Severity.P0]: 0, [Severity.P1]: 0, [Severity.P2]: 10, [Severity.P3]: 0 },
    droppedBySeverity: { [Severity.P0]: 0, [Severity.P1]: 0, [Severity.P2]: 0, [Severity.P3]: 0 },
    droppedByReason: { shed_ceiling: 0, hard_capacity: 0, sink_failure: 0 },
    droppedBySeverityAndReason: {
      [Severity.P0]: { shed_ceiling: 0, hard_capacity: 0, sink_failure: 0 },
      [Severity.P1]: { shed_ceiling: 0, hard_capacity: 0, sink_failure: 0 },
      [Severity.P2]: { shed_ceiling: 0, hard_capacity: 0, sink_failure: 0 },
      [Severity.P3]: { shed_ceiling: 0, hard_capacity: 0, sink_failure: 0 },
    },
    ...overrides,
  };
}

function makeInput(overrides: Partial<BuildHealthResponseInput> = {}): BuildHealthResponseInput {
  return {
    dependencies: allUpDependencies(),
    queueDepth: { waitingCount: 0, activeCount: 0, dlqSize: 0 },
    bufferStats: makeBufferStats(),
    uptimeSeconds: 123,
    version: "1.2.3",
    signalsPerSecond: 42,
    ...overrides,
  };
}

describe("buildHealthResponse", () => {
  it("returns 200/healthy when every dependency is up and the buffer isn't shedding", () => {
    const { httpStatus, body } = buildHealthResponse(makeInput());
    expect(httpStatus).toBe(200);
    expect(body.status).toBe("healthy");
  });

  it.each(["postgres", "mongo", "redis", "queue"] as const)(
    "returns 503 naming %s as down when only %s is down",
    (failing) => {
      const dependencies = allUpDependencies();
      const withFailure: HealthSnapshot = { ...dependencies, [failing]: DOWN };

      const { httpStatus, body } = buildHealthResponse(makeInput({ dependencies: withFailure }));

      expect(httpStatus).toBe(503);
      expect(body.status).toBe("unhealthy");
      expect(body.dependencies[failing].status).toBe("down");
      // Every other dependency is still reported accurately as up — a
      // caller can tell exactly which one to look at.
      for (const name of ["postgres", "mongo", "redis", "queue"] as const) {
        if (name !== failing) {
          expect(body.dependencies[name].status).toBe("up");
        }
      }
    },
  );

  it("returns 200/degraded (not 503) when dependencies are up but the buffer is shedding", () => {
    const { httpStatus, body } = buildHealthResponse(makeInput({ bufferStats: makeBufferStats({ state: "shedding" }) }));
    expect(httpStatus).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.buffer.shedding).toBe(true);
  });

  it("includes uptime, version, and current throughput", () => {
    const { body } = buildHealthResponse(makeInput({ uptimeSeconds: 999, version: "9.9.9", signalsPerSecond: 111 }));
    expect(body.uptimeSeconds).toBe(999);
    expect(body.version).toBe("9.9.9");
    expect(body.throughput.signalsPerSecond).toBe(111);
  });

  it("surfaces buffer depth/fill and queue depth/DLQ size from the given snapshots", () => {
    const { body } = buildHealthResponse(
      makeInput({
        bufferStats: makeBufferStats({ totalSize: 55, capacity: 100, fillFraction: 0.55 }),
        queueDepth: { waitingCount: 4, activeCount: 2, dlqSize: 1 },
      }),
    );
    expect(body.buffer).toMatchObject({ depth: 55, capacity: 100, fillFraction: 0.55 });
    expect(body.queue).toEqual({ waitingCount: 4, activeCount: 2, dlqSize: 1 });
  });
});
