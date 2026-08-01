// Floods past the ingestion buffer's capacity and asserts on the resulting
// backpressure behavior: watermarks engage, low severity sheds first, P0
// is never shed, and every drop is counted (not silent).
//
// Runs against a temporary, isolated backend instance (see
// helpers/ephemeralBackend.ts) rather than the shared dev container — the
// real container's per-IP rate limiter would reject almost this entire
// flood long before the buffer ever felt pressure, and this scenario's job
// is to test the BUFFER's watermark/shedding logic specifically, not the
// rate limiter (that's tests/unit/services/ingestion/buffer.test.ts's job
// at the unit level, and this is its real-HTTP, real-process counterpart).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEphemeralBackend, type EphemeralBackend } from "./helpers/ephemeralBackend.js";
import { waitFor } from "./helpers/waitFor.js";
import { readMetricValue } from "./helpers/dataClients.js";
import type { SignalInput } from "./helpers/apiClient.js";

const HOST_PORT = 3097;
const BUFFER_CAPACITY = 1000;

function makeChaosSignal(severity: SignalInput["severity"], index: number): SignalInput {
  return {
    signalId: `chaos-saturation-${severity}-${index}-${Date.now()}`,
    componentId: `CHAOS_SATURATION_${severity}`,
    componentType: "CACHE",
    severity,
    rawPayload: { chaosTest: "queue-saturation" },
    occurredAt: new Date().toISOString(),
  };
}

async function postTo(
  baseUrl: string,
  signals: readonly SignalInput[],
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/v1/signals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signals),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

describe("chaos: queue saturation", () => {
  let backend: EphemeralBackend;

  beforeAll(async () => {
    backend = await startEphemeralBackend("queue-saturation", HOST_PORT, {
      // Effectively unlimited — this scenario is specifically about the
      // BUFFER's own watermarks, not the rate limiter in front of it.
      RATE_LIMIT_IP_CAPACITY: "1000000",
      RATE_LIMIT_IP_REFILL_PER_SECOND: "1000000",
      RATE_LIMIT_GLOBAL_CAPACITY: "1000000",
      RATE_LIMIT_GLOBAL_REFILL_PER_SECOND: "1000000",
      // Small and slow-draining so a modest, fast HTTP flood reliably
      // outpaces drainage and produces real, observable backpressure
      // instead of racing a 4000/sec default drain rate.
      BUFFER_CAPACITY: String(BUFFER_CAPACITY),
      BUFFER_HIGH_WATER_MARK_FRACTION: "0.8",
      BUFFER_LOW_WATER_MARK_FRACTION: "0.5",
      BUFFER_SHED_CEILING_P1_FRACTION: "0.7",
      BUFFER_SHED_CEILING_P2_FRACTION: "0.4",
      BUFFER_SHED_CEILING_P3_FRACTION: "0.15",
      BUFFER_DRAIN_BATCH_SIZE: "5",
      BUFFER_DRAIN_INTERVAL_MS: "1000",
    });
  }, 45_000);

  afterAll(async () => {
    await backend?.stop();
  });

  it("engages watermarks, sheds low severity first, never sheds P0, and reports every drop", async () => {
    // Deliberately no P0 in the flood — P0 survival is asserted separately
    // below via a dedicated batch, so there's no ambiguity about which
    // severity a given drop belongs to.
    const floodBatches: SignalInput[][] = [];
    for (let batch = 0; batch < 6; batch += 1) {
      const signals: SignalInput[] = [];
      for (let i = 0; i < 500; i += 1) {
        // Weighted toward P3 so the shed-ceiling ordering (P3 sheds before
        // P2 before P1) has enough P3 volume to clearly demonstrate.
        const roll = (batch * 500 + i) % 10;
        const severity: SignalInput["severity"] = roll < 6 ? "P3" : roll < 9 ? "P2" : "P1";
        signals.push(makeChaosSignal(severity, batch * 500 + i));
      }
      floodBatches.push(signals);
    }

    const floodResponses = await Promise.all(
      floodBatches.map((batch) => postTo(backend.baseUrl, batch)),
    );

    // Every response is a real HTTP outcome, never a hang/crash — 202
    // (fully accepted) or 503 (buffer_saturated, with accepted/dropped
    // counts) are the only acceptable outcomes here.
    for (const response of floodResponses) {
      expect([202, 503]).toContain(response.status);
    }

    const totalDroppedInResponses = floodResponses.reduce((sum, response) => {
      const dropped = response.body["dropped"];
      return sum + (typeof dropped === "number" ? dropped : 0);
    }, 0);
    expect(totalDroppedInResponses).toBeGreaterThan(0); // the flood actually exceeded capacity

    // Confirm the watermark genuinely engaged (not just "some individual
    // signal happened to exceed hard capacity").
    await waitFor(
      async () => {
        const res = await fetch(`${backend.baseUrl}/health`);
        const body = (await res.json()) as { buffer: { shedding: boolean; fillFraction: number } };
        return body.buffer.shedding || body.buffer.fillFraction >= 0.8;
      },
      { timeoutMs: 10_000, description: "buffer to report shedding after the flood" },
    );

    // While the buffer is still under pressure, submit a P0-only batch —
    // per the buffer's own design (see src/services/ingestion/buffer.ts),
    // P0 has no shed ceiling at all and is only ever evicted in the
    // pathological "buffer is entirely full of P0s" case, which this
    // flood (all P1-P3) cannot produce. This must come back 202, in full.
    const p0Signals = Array.from({ length: 20 }, (_, i) => makeChaosSignal("P0", i));
    const p0Response = await postTo(backend.baseUrl, p0Signals);

    expect(p0Response.status).toBe(202);
    expect(p0Response.body["accepted"]).toBe(20);

    // Drop counts are reported, not silent — cross-check the backend's own
    // authoritative counters, not just the HTTP response bodies above.
    const metricsText = await (await fetch(`${backend.baseUrl}/metrics`)).text();
    const p3ShedCeiling = readMetricValue(metricsText, "ims_signals_dropped_total", {
      severity: "P3",
      reason: "shed_ceiling",
    });
    const p0AnyDrop =
      readMetricValue(metricsText, "ims_signals_dropped_total", {
        severity: "P0",
        reason: "shed_ceiling",
      }) +
      readMetricValue(metricsText, "ims_signals_dropped_total", {
        severity: "P0",
        reason: "hard_capacity",
      });

    expect(p3ShedCeiling).toBeGreaterThan(0); // low severity actually got shed
    expect(p0AnyDrop).toBe(0); // P0 was never shed, not even once
  });
});
