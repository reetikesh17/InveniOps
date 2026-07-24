import { describe, expect, it } from "vitest";
import { ComponentType, Severity } from "@prisma/client";
import {
  SignalBuffer,
  type IngestionSignal,
  type SignalBufferOptions,
  type SignalSink,
} from "../../../../src/services/ingestion/buffer.js";

let nextId = 0;

function makeSignal(severity: Severity, overrides: Partial<IngestionSignal> = {}): IngestionSignal {
  nextId += 1;
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    signalId: `signal-${nextId}`,
    componentId: "CACHE_CLUSTER_01",
    componentType: ComponentType.CACHE,
    severity,
    rawPayload: {},
    occurredAt: now,
    receivedAt: now,
    correlationId: `req-${nextId}`,
    ...overrides,
  };
}

/** Records every batch it's handed; never fails unless told to. */
function recordingSink(shouldFail = false): SignalSink & { readonly batches: IngestionSignal[][] } {
  const batches: IngestionSignal[][] = [];
  return {
    batches,
    drain(batch: readonly IngestionSignal[]): Promise<void> {
      if (shouldFail) {
        return Promise.reject(new Error("sink failure"));
      }
      batches.push([...batch]);
      return Promise.resolve();
    },
  };
}

function makeOptions(overrides: Partial<SignalBufferOptions> = {}): SignalBufferOptions {
  return {
    capacity: 100,
    highWaterMarkFraction: 0.8,
    lowWaterMarkFraction: 0.5,
    shedCeilingFractions: { [Severity.P1]: 0.7, [Severity.P2]: 0.4, [Severity.P3]: 0.15 },
    drainBatchSize: 10,
    drainIntervalMs: 50,
    sink: recordingSink(),
    ...overrides,
  };
}

describe("SignalBuffer", () => {
  describe("capacity", () => {
    it("never exceeds capacity under sustained overload", () => {
      const buffer = new SignalBuffer(makeOptions({ capacity: 50 }));

      const severities = [Severity.P0, Severity.P1, Severity.P2, Severity.P3];
      for (let i = 0; i < 500; i += 1) {
        const severity = severities[i % severities.length] ?? Severity.P3;
        buffer.submit(makeSignal(severity));
        expect(buffer.totalSize).toBeLessThanOrEqual(50);
      }

      expect(buffer.totalSize).toBeLessThanOrEqual(50);
    });

    it("accepts signals up to capacity when only a single severity is arriving", () => {
      const buffer = new SignalBuffer(makeOptions({ capacity: 20, highWaterMarkFraction: 0.99 }));

      let accepted = 0;
      for (let i = 0; i < 20; i += 1) {
        const result = buffer.submit(makeSignal(Severity.P2));
        if (result.accepted) accepted += 1;
      }

      expect(accepted).toBe(20);
      expect(buffer.totalSize).toBe(20);
    });

    it("drops (not crashes) once genuinely at hard capacity, distinct from ceiling-based shedding", () => {
      // Reaching hard capacity always implies fill = 100%, which always
      // trips the high-water mark first — so this buffer is already
      // shedding by the time it's full. To isolate the hard-capacity path
      // from the ceiling path, give P2 a generous ceiling (won't be hit)
      // and fill most of the buffer with P0 (which has no ceiling at all).
      const buffer = new SignalBuffer(
        makeOptions({
          capacity: 10,
          highWaterMarkFraction: 0.5,
          lowWaterMarkFraction: 0.1,
          shedCeilingFractions: { [Severity.P1]: 0.9, [Severity.P2]: 0.9, [Severity.P3]: 0.9 },
        }),
      );

      for (let i = 0; i < 9; i += 1) {
        expect(buffer.submit(makeSignal(Severity.P0)).accepted).toBe(true);
      }
      expect(buffer.bufferState).toBe("shedding");

      expect(buffer.submit(makeSignal(Severity.P2)).accepted).toBe(true); // fills the last slot, size 1 << ceiling 9
      expect(buffer.totalSize).toBe(10);

      const overflow = buffer.submit(makeSignal(Severity.P2));
      expect(overflow).toEqual({ accepted: false, reason: "hard_capacity" });
      expect(buffer.totalSize).toBe(10);
      expect(buffer.getStats().droppedBySeverity[Severity.P2]).toBe(1);
      expect(buffer.getStats().droppedByReason.hard_capacity).toBe(1);
    });
  });

  describe("watermark hysteresis", () => {
    it("engages shedding at the high-water mark and disengages at the low-water mark", async () => {
      const buffer = new SignalBuffer(
        makeOptions({ capacity: 100, highWaterMarkFraction: 0.8, lowWaterMarkFraction: 0.5, drainBatchSize: 1 }),
      );

      for (let i = 0; i < 79; i += 1) {
        buffer.submit(makeSignal(Severity.P0));
      }
      expect(buffer.bufferState).toBe("normal");

      buffer.submit(makeSignal(Severity.P0)); // 80/100 = high-water mark
      expect(buffer.bufferState).toBe("shedding");

      // Draining down to just above the low-water mark should not exit yet.
      for (let i = 0; i < 29; i += 1) {
        await buffer.drainToSink();
      }
      expect(buffer.totalSize).toBe(51);
      expect(buffer.bufferState).toBe("shedding");

      await buffer.drainToSink(); // 50/100 = low-water mark
      expect(buffer.totalSize).toBe(50);
      expect(buffer.bufferState).toBe("normal");
    });

    it("does not re-enter shedding until crossing the high-water mark again (no flapping at the boundary)", async () => {
      const buffer = new SignalBuffer(
        makeOptions({ capacity: 100, highWaterMarkFraction: 0.8, lowWaterMarkFraction: 0.5, drainBatchSize: 1 }),
      );

      for (let i = 0; i < 80; i += 1) {
        buffer.submit(makeSignal(Severity.P0));
      }
      expect(buffer.bufferState).toBe("shedding");

      for (let i = 0; i < 31; i += 1) {
        await buffer.drainToSink();
      }
      expect(buffer.bufferState).toBe("normal");

      // Sitting right at 49% (below high-water mark) must stay normal.
      buffer.submit(makeSignal(Severity.P0));
      expect(buffer.totalSize).toBe(50);
      expect(buffer.bufferState).toBe("normal");
    });
  });

  describe("severity-prioritized shedding", () => {
    it("sheds P3 while P0 keeps being accepted once shedding is active", () => {
      const buffer = new SignalBuffer(
        makeOptions({
          capacity: 100,
          highWaterMarkFraction: 0.5,
          lowWaterMarkFraction: 0.1,
          shedCeilingFractions: { [Severity.P1]: 0.7, [Severity.P2]: 0.4, [Severity.P3]: 0.1 },
        }),
      );

      // Push fill to the high-water mark purely with P0 so shedding engages
      // without consuming any of P3's ceiling.
      for (let i = 0; i < 50; i += 1) {
        buffer.submit(makeSignal(Severity.P0));
      }
      expect(buffer.bufferState).toBe("shedding");

      // P3's ceiling is 10% of 100 = 10 signals.
      let p3Accepted = 0;
      let p3Rejected: unknown;
      for (let i = 0; i < 15; i += 1) {
        const result = buffer.submit(makeSignal(Severity.P3));
        if (result.accepted) {
          p3Accepted += 1;
        } else {
          p3Rejected = result;
        }
      }
      expect(p3Accepted).toBe(10);
      expect(p3Rejected).toEqual({ accepted: false, reason: "shed_ceiling" });
      expect(buffer.getStats().droppedBySeverity[Severity.P3]).toBe(5);

      // P0 must still be accepted without limit (up to hard capacity).
      const p0Result = buffer.submit(makeSignal(Severity.P0));
      expect(p0Result.accepted).toBe(true);
      expect(buffer.getStats().droppedBySeverity[Severity.P0]).toBe(0);
    });

    it("sheds P3 before P2 before P1 as pressure increases (ceilings enforce priority order)", () => {
      const buffer = new SignalBuffer(
        makeOptions({
          capacity: 100,
          highWaterMarkFraction: 0.01,
          lowWaterMarkFraction: 0,
          shedCeilingFractions: { [Severity.P1]: 0.3, [Severity.P2]: 0.2, [Severity.P3]: 0.1 },
        }),
      );

      buffer.submit(makeSignal(Severity.P0)); // crosses high-water mark immediately, enters shedding
      expect(buffer.bufferState).toBe("shedding");

      const acceptedCountFor = (severity: Severity, attempts: number): number => {
        let accepted = 0;
        for (let i = 0; i < attempts; i += 1) {
          if (buffer.submit(makeSignal(severity)).accepted) accepted += 1;
        }
        return accepted;
      };

      expect(acceptedCountFor(Severity.P3, 20)).toBe(10); // ceiling 10
      expect(acceptedCountFor(Severity.P2, 30)).toBe(20); // ceiling 20
      expect(acceptedCountFor(Severity.P1, 40)).toBe(30); // ceiling 30
    });

    it("never drops P0 as part of ceiling-based shedding, no matter how full lower severities are", () => {
      const buffer = new SignalBuffer(
        makeOptions({
          capacity: 100,
          highWaterMarkFraction: 0.01,
          lowWaterMarkFraction: 0,
          shedCeilingFractions: { [Severity.P1]: 0.3, [Severity.P2]: 0.2, [Severity.P3]: 0.1 },
        }),
      );

      buffer.submit(makeSignal(Severity.P0));
      expect(buffer.bufferState).toBe("shedding");

      // Stay well under hard capacity (100) — this test is about the
      // ceiling mechanism never applying to P0, not about the separate,
      // intentionally-rare hard-capacity eviction that only kicks in when
      // the buffer is entirely full of P0s (covered by its own test below).
      for (let i = 0; i < 50; i += 1) {
        buffer.submit(makeSignal(Severity.P0));
      }

      expect(buffer.getStats().droppedBySeverity[Severity.P0]).toBe(0);
    });

    it("evicts the oldest lower-severity signal to make room for a P0 when the buffer is genuinely at hard capacity", () => {
      const buffer = new SignalBuffer(makeOptions({ capacity: 3, highWaterMarkFraction: 0.99 }));

      const oldestP3 = makeSignal(Severity.P3, { signalId: "oldest-p3" });
      buffer.submit(oldestP3);
      buffer.submit(makeSignal(Severity.P3));
      buffer.submit(makeSignal(Severity.P2));
      expect(buffer.totalSize).toBe(3);

      const p0Result = buffer.submit(makeSignal(Severity.P0));
      expect(p0Result.accepted).toBe(true);
      expect(buffer.totalSize).toBe(3);
      expect(buffer.getStats().droppedBySeverity[Severity.P3]).toBe(1);
      expect(buffer.getStats().droppedByReason.hard_capacity).toBe(1);
      expect(buffer.getStats().droppedBySeverity[Severity.P0]).toBe(0);
    });

    it("as an absolute last resort, evicts the oldest P0 when the buffer is entirely full of P0s", () => {
      const buffer = new SignalBuffer(makeOptions({ capacity: 3, highWaterMarkFraction: 0.99 }));

      const oldestP0 = makeSignal(Severity.P0, { signalId: "oldest-p0" });
      buffer.submit(oldestP0);
      buffer.submit(makeSignal(Severity.P0, { signalId: "middle-p0" }));
      buffer.submit(makeSignal(Severity.P0, { signalId: "newest-p0" }));
      expect(buffer.totalSize).toBe(3);

      const result = buffer.submit(makeSignal(Severity.P0, { signalId: "arriving-p0" }));
      expect(result.accepted).toBe(true);
      expect(buffer.totalSize).toBe(3);
      expect(buffer.getStats().droppedBySeverity[Severity.P0]).toBe(1);
      expect(buffer.getStats().droppedByReason.hard_capacity).toBe(1);
    });
  });

  describe("draining", () => {
    it("drains in priority order: P0 fully before P1, P1 before P2, and so on", async () => {
      const sink = recordingSink();
      const buffer = new SignalBuffer(makeOptions({ capacity: 100, drainBatchSize: 100, sink }));

      buffer.submit(makeSignal(Severity.P2));
      buffer.submit(makeSignal(Severity.P0));
      buffer.submit(makeSignal(Severity.P3));
      buffer.submit(makeSignal(Severity.P1));
      buffer.submit(makeSignal(Severity.P0));

      await buffer.drainToSink();

      expect(sink.batches).toHaveLength(1);
      expect(sink.batches[0]?.map((signal) => signal.severity)).toEqual([
        Severity.P0,
        Severity.P0,
        Severity.P1,
        Severity.P2,
        Severity.P3,
      ]);
    });

    it("respects the batch size across multiple ticks", async () => {
      const sink = recordingSink();
      const buffer = new SignalBuffer(makeOptions({ capacity: 100, drainBatchSize: 3, sink }));

      for (let i = 0; i < 7; i += 1) {
        buffer.submit(makeSignal(Severity.P1));
      }

      const first = await buffer.drainToSink();
      const second = await buffer.drainToSink();
      const third = await buffer.drainToSink();
      const fourth = await buffer.drainToSink();

      expect([first.drained, second.drained, third.drained, fourth.drained]).toEqual([3, 3, 1, 0]);
      expect(buffer.totalSize).toBe(0);
    });

    it("counts a batch as dropped (not lost silently) when the sink throws", async () => {
      const sink = recordingSink(true);
      const buffer = new SignalBuffer(makeOptions({ capacity: 100, drainBatchSize: 10, sink }));

      buffer.submit(makeSignal(Severity.P1));
      buffer.submit(makeSignal(Severity.P2));

      const result = await buffer.drainToSink();

      expect(result).toEqual({ drained: 0, failed: 2 });
      expect(buffer.totalSize).toBe(0);
      expect(buffer.getStats().droppedByReason.sink_failure).toBe(2);
    });
  });

  describe("drainAll (shutdown)", () => {
    it("loses nothing when given adequate time", async () => {
      const sink = recordingSink();
      const buffer = new SignalBuffer(makeOptions({ capacity: 500, drainBatchSize: 20, sink }));

      for (let i = 0; i < 137; i += 1) {
        buffer.submit(makeSignal(Severity.P2));
      }

      const result = await buffer.drainAll(5000);

      expect(result).toEqual({ processed: 137, succeeded: 137, failed: 0, remaining: 0 });
      expect(buffer.totalSize).toBe(0);
      const totalSunk = sink.batches.reduce((sum, batch) => sum + batch.length, 0);
      expect(totalSunk).toBe(137);
    });

    it("reports what's left behind when the timeout is hit before draining completes", async () => {
      let callCount = 0;
      const slowSink: SignalSink = {
        async drain(batch) {
          callCount += 1;
          void batch;
          await new Promise((resolve) => setTimeout(resolve, 20));
        },
      };
      const buffer = new SignalBuffer(makeOptions({ capacity: 500, drainBatchSize: 5, sink: slowSink }));

      for (let i = 0; i < 50; i += 1) {
        buffer.submit(makeSignal(Severity.P2));
      }

      const result = await buffer.drainAll(35);

      expect(result.remaining).toBeGreaterThan(0);
      expect(result.remaining).toBe(buffer.totalSize);
      expect(callCount).toBeGreaterThan(0);
    });
  });

  describe("getStats", () => {
    it("reports depth by severity and fill fraction", () => {
      const buffer = new SignalBuffer(makeOptions({ capacity: 10 }));
      buffer.submit(makeSignal(Severity.P0));
      buffer.submit(makeSignal(Severity.P0));
      buffer.submit(makeSignal(Severity.P3));

      const stats = buffer.getStats();
      expect(stats.capacity).toBe(10);
      expect(stats.totalSize).toBe(3);
      expect(stats.fillFraction).toBeCloseTo(0.3);
      expect(stats.depthBySeverity[Severity.P0]).toBe(2);
      expect(stats.depthBySeverity[Severity.P3]).toBe(1);
      expect(stats.depthBySeverity[Severity.P1]).toBe(0);
    });

    it("cross-tabulates drops by severity and reason, distinct from the separate by-severity and by-reason totals", () => {
      const buffer = new SignalBuffer(
        makeOptions({
          capacity: 100,
          highWaterMarkFraction: 0.01,
          lowWaterMarkFraction: 0,
          shedCeilingFractions: { [Severity.P1]: 0.3, [Severity.P2]: 0.2, [Severity.P3]: 0.01 },
        }),
      );

      buffer.submit(makeSignal(Severity.P0)); // crosses high-water mark, enters shedding
      for (let i = 0; i < 5; i += 1) {
        buffer.submit(makeSignal(Severity.P3)); // P3's ceiling is 1 -> 4 of these get shed_ceiling-dropped
      }

      const stats = buffer.getStats();
      expect(stats.droppedBySeverityAndReason[Severity.P3].shed_ceiling).toBe(4);
      expect(stats.droppedBySeverityAndReason[Severity.P3].hard_capacity).toBe(0);
      expect(stats.droppedBySeverityAndReason[Severity.P0].shed_ceiling).toBe(0);
      // Still consistent with the pre-existing, separate breakdowns.
      expect(stats.droppedBySeverity[Severity.P3]).toBe(4);
      expect(stats.droppedByReason.shed_ceiling).toBe(4);
    });
  });

  describe("isDraining", () => {
    it("reflects whether the drain loop is currently running", () => {
      const buffer = new SignalBuffer(makeOptions());
      expect(buffer.isDraining).toBe(false);

      buffer.start();
      expect(buffer.isDraining).toBe(true);

      buffer.stop();
      expect(buffer.isDraining).toBe(false);
    });
  });
});
