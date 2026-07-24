import { describe, expect, it } from "vitest";
import { ComponentType, Severity } from "@prisma/client";
import { serializeSignal, deserializeSignal } from "../../../src/workers/queue.js";
import type { IngestionSignal } from "../../../src/services/ingestion/buffer.js";

describe("serializeSignal / deserializeSignal", () => {
  it("round-trips correlationId through the Redis JSON boundary along with every other field", () => {
    const signal: IngestionSignal = {
      signalId: "sig-1",
      componentId: "CACHE_CLUSTER_01",
      componentType: ComponentType.CACHE,
      severity: Severity.P1,
      rawPayload: { message: "oops" },
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
      receivedAt: new Date("2026-01-01T00:00:01.000Z"),
      correlationId: "req-abc-123",
    };

    const serialized = serializeSignal(signal);
    expect(serialized.correlationId).toBe("req-abc-123");

    // Simulates the actual Redis round trip: JSON.stringify/parse, same as
    // what BullMQ does under the hood.
    const rehydrated = JSON.parse(JSON.stringify(serialized)) as typeof serialized;
    const deserialized = deserializeSignal(rehydrated);

    expect(deserialized).toEqual(signal);
  });
});
