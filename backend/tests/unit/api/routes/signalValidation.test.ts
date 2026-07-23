import { describe, expect, it } from "vitest";
import { parseSignalBatch } from "../../../../src/api/routes/signalValidation.js";

function validSignal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    componentId: "CACHE_CLUSTER_01",
    componentType: "CACHE",
    severity: "P2",
    rawPayload: { message: "connection refused" },
    occurredAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function signalWithoutField(field: string): Record<string, unknown> {
  const signal = validSignal();
  delete signal[field];
  return signal;
}

describe("parseSignalBatch", () => {
  it("accepts a single valid signal object", () => {
    const result = parseSignalBatch(validSignal(), 10);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0]?.componentId).toBe("CACHE_CLUSTER_01");
    }
  });

  it("accepts a batch array of valid signals", () => {
    const result = parseSignalBatch([validSignal(), validSignal({ componentId: "API_GATEWAY" })], 10);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.signals).toHaveLength(2);
    }
  });

  it("preserves a client-supplied signalId when present", () => {
    const result = parseSignalBatch(validSignal({ signalId: "src-evt-123" }), 10);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.signals[0]?.signalId).toBe("src-evt-123");
    }
  });

  it("leaves signalId undefined when not supplied, for the caller to assign one", () => {
    const result = parseSignalBatch(validSignal(), 10);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.signals[0]?.signalId).toBeUndefined();
    }
  });

  it("rejects an empty batch", () => {
    const result = parseSignalBatch([], 10);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("empty_batch");
    }
  });

  it("rejects a batch exceeding the max size", () => {
    const batch = Array.from({ length: 3 }, () => validSignal());
    const result = parseSignalBatch(batch, 2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("batch_too_large");
    }
  });

  it("reports a field-level error for a missing required field", () => {
    const result = parseSignalBatch(signalWithoutField("componentId"), 10);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "validation_failed") {
      expect(result.errors.some((error) => error.field === "componentId")).toBe(true);
    }
  });

  it("rejects an invalid componentType", () => {
    const result = parseSignalBatch(validSignal({ componentType: "NOT_A_TYPE" }), 10);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "validation_failed") {
      expect(result.errors.some((error) => error.field === "componentType")).toBe(true);
    }
  });

  it("rejects an invalid severity", () => {
    const result = parseSignalBatch(validSignal({ severity: "P9" }), 10);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "validation_failed") {
      expect(result.errors.some((error) => error.field === "severity")).toBe(true);
    }
  });

  it("rejects a non-date occurredAt", () => {
    const result = parseSignalBatch(validSignal({ occurredAt: "not-a-date" }), 10);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "validation_failed") {
      expect(result.errors.some((error) => error.field === "occurredAt")).toBe(true);
    }
  });

  it("annotates field errors with the item's index when validating a batch", () => {
    const result = parseSignalBatch([validSignal(), signalWithoutField("componentId")], 10);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "validation_failed") {
      expect(result.errors.some((error) => error.field === "[1].componentId")).toBe(true);
    }
  });

  it("accepts arbitrary JSON shapes for rawPayload", () => {
    const result = parseSignalBatch(validSignal({ rawPayload: { nested: { arr: [1, 2, 3] }, n: null } }), 10);
    expect(result.ok).toBe(true);
  });
});
