// Full-lifecycle E2E test — runs against the real docker-compose stack over
// the real HTTP API (same posture as tests/chaos/, NOT the in-process app
// tests/integration/api/lifecycle.test.ts exercises). Ingests a real,
// debounce-triggering burst across 5 components, then verifies every layer
// of the pipeline against the real system: Postgres, Mongo, Redis, and the
// backend's own alert logs — not inferred from HTTP responses alone.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Db } from "mongodb";
import type { Redis } from "ioredis";
import {
  createDefaultAlertStrategyRegistry,
  reconcileSeverity,
} from "../../src/domain/alerting/index.js";
import {
  postSignals,
  getHealth,
  getIncident,
  transitionIncident,
  submitRca,
  getTransitions,
  getComponentHealth,
  getMttrAnalytics,
  getAuthenticatedEmail,
  type SignalInput,
  type Severity,
  type ComponentType,
} from "./helpers/apiClient.js";
import { makePrismaClient, makeMongoDb, makeRedisClient } from "./helpers/dataClients.js";
import type { SignalDocument } from "../../src/repositories/mongo/signalRepository.js";
import { findAlertLogsSince } from "./helpers/docker.js";
import { waitForValue } from "./helpers/wait.js";
import { BACKEND_CONTAINER_NAME } from "./helpers/testEnv.js";

const RUN_TAG = `e2e-${Date.now()}`;
const SIGNALS_PER_COMPONENT = 100;
const strategyRegistry = createDefaultAlertStrategyRegistry();

// Deliberately chosen to exercise every direction reconcileSeverity can go —
// not just "reported already matches the floor" (see
// src/domain/alerting/severity.ts): DB_PRIMARY (equal), API (reported
// UNDER the floor — the floor must correct it up), MCP_HOST (reported OVER
// the floor — the report must win), CACHE and NOSQL (equal). See
// src/domain/alerting/strategies/*.ts for each type's severityFloor.
interface ComponentSpec {
  readonly key: string;
  readonly componentId: string;
  readonly componentType: ComponentType;
  readonly reportedSeverity: Severity;
}

const COMPONENTS: readonly ComponentSpec[] = [
  { key: "rdbms", componentId: `${RUN_TAG}-RDBMS`, componentType: "RDBMS", reportedSeverity: "P0" },
  { key: "api", componentId: `${RUN_TAG}-API`, componentType: "API", reportedSeverity: "P2" },
  {
    key: "mcpHost",
    componentId: `${RUN_TAG}-MCP_HOST`,
    componentType: "MCP_HOST",
    reportedSeverity: "P0",
  },
  { key: "cache", componentId: `${RUN_TAG}-CACHE`, componentType: "CACHE", reportedSeverity: "P2" },
  { key: "nosql", componentId: `${RUN_TAG}-NOSQL`, componentType: "NOSQL", reportedSeverity: "P1" },
];

function expectedAlertSeverity(componentType: ComponentType, reported: Severity): Severity {
  const strategy = strategyRegistry.resolve(componentType);
  return reconcileSeverity(strategy.severityFloor, reported) as Severity;
}

function makeSignal(spec: ComponentSpec, index: number): SignalInput {
  return {
    signalId: `${spec.componentId}-${index}-${randomUUID()}`,
    componentId: spec.componentId,
    componentType: spec.componentType,
    severity: spec.reportedSeverity,
    rawPayload: { e2e: true, index },
    occurredAt: new Date().toISOString(),
  };
}

interface IngestTotals {
  sent: number;
  accepted: number;
  dropped: number;
  rateLimitRetries: number;
}

let prisma: PrismaClient;
let mongoDb: Db;
let closeMongo: () => Promise<void>;
let redis: Redis;

let ingestStartedAtIso: string;
let dlqSizeBefore: number;
const totals: IngestTotals = { sent: 0, accepted: 0, dropped: 0, rateLimitRetries: 0 };
const workItemIdByKey = new Map<string, string>();

describe("E2E: full incident lifecycle", () => {
  beforeAll(async () => {
    prisma = makePrismaClient();
    const mongo = await makeMongoDb();
    mongoDb = mongo.db;
    closeMongo = mongo.close;
    redis = makeRedisClient();

    const preflight = await getHealth();
    if (preflight.body.status !== "healthy") {
      throw new Error(
        `backend not healthy before the test even started: ${JSON.stringify(preflight.body)}`,
      );
    }
    dlqSizeBefore = preflight.body.queue.dlqSize;
    ingestStartedAtIso = new Date().toISOString();

    // Concentrated: round-robin batches of 20 across all 5 components
    // (not one component fully drained before the next starts), so the
    // whole 500-signal burst arrives in a tight window per component —
    // real-world "a burst of errors just started," not signals trickling
    // in over minutes. Chunked (not one 100-signal request per component)
    // because a single request's cost can never exceed the real per-IP
    // rate limiter's capacity (default 50) regardless of timing;
    // postSignals retries on 429 as a backstop regardless.
    const CHUNK = 20;
    for (let offset = 0; offset < SIGNALS_PER_COMPONENT; offset += CHUNK) {
      for (const spec of COMPONENTS) {
        const batch = Array.from({ length: CHUNK }, (_, i) => makeSignal(spec, offset + i));
        const result = await postSignals(batch);
        totals.sent += batch.length;
        totals.accepted += result.accepted;
        totals.dropped += result.dropped;
        totals.rateLimitRetries += result.rateLimitRetries;
        expect(result.status, `unexpected status posting a batch for ${spec.componentId}`).toBe(
          202,
        );
      }
    }

    // Wait for the async buffer -> queue -> worker -> debouncer pipeline to
    // fully process every signal for every component before any assertion runs.
    for (const spec of COMPONENTS) {
      const workItem = await waitForValue(
        () => prisma.workItem.findFirst({ where: { componentId: spec.componentId } }),
        (item) => item !== null && item.signalCount >= SIGNALS_PER_COMPONENT,
        {
          timeoutMs: 60_000,
          intervalMs: 1_000,
          description: `${spec.componentId}'s work item to reach signalCount ${SIGNALS_PER_COMPONENT}`,
        },
      );
      workItemIdByKey.set(spec.key, workItem!.id);
    }
  }, 120_000);

  afterAll(async () => {
    const workItemIds = [...workItemIdByKey.values()];
    await prisma.stateTransition.deleteMany({ where: { workItemId: { in: workItemIds } } });
    await prisma.rcaRecord.deleteMany({ where: { workItemId: { in: workItemIds } } });
    await prisma.workItem.deleteMany({ where: { id: { in: workItemIds } } });
    await mongoDb
      .collection("signals")
      .deleteMany({ componentId: { $in: COMPONENTS.map((c) => c.componentId) } });
    for (const id of workItemIds) {
      await redis.del(`dashboard:incident:${id}`);
      await redis.zrem("dashboard:active_incidents", id);
    }
    await prisma.$disconnect();
    await closeMongo();
    redis.disconnect();
  }, 30_000);

  // --- 1 & buffer-loss half of the assignment's step 4/12 wording ---
  it("ingests 500 signals across 5 components without the buffer dropping any", () => {
    expect(totals.sent).toBe(COMPONENTS.length * SIGNALS_PER_COMPONENT);
    expect(totals.accepted).toBe(totals.sent);
    expect(totals.dropped).toBe(0);
  });

  // --- 2: not 500 work items ---
  it("creates exactly one work item per component — 5 total, not 500", async () => {
    const count = await prisma.workItem.count({
      where: { componentId: { in: COMPONENTS.map((c) => c.componentId) } },
    });
    expect(count).toBe(COMPONENTS.length);
  });

  // --- 3: every signal persisted with the right workItemId ---
  it("persists every signal to Mongo, linked to the correct work item", async () => {
    for (const spec of COMPONENTS) {
      const workItemId = workItemIdByKey.get(spec.key)!;
      const docs = await mongoDb
        .collection<SignalDocument>("signals")
        .find({ componentId: spec.componentId })
        .toArray();
      expect(docs, `${spec.componentId} signal count in Mongo`).toHaveLength(SIGNALS_PER_COMPONENT);
      const distinctWorkItemIds = new Set(docs.map((d) => d.workItemId));
      expect(
        distinctWorkItemIds,
        `${spec.componentId}'s signals must all link to its one work item`,
      ).toEqual(new Set([workItemId]));
    }
  });

  // --- 4: severities match what the alerting Strategy assigns ---
  it("assigns severities matching what each component's alerting Strategy computes", async () => {
    for (const spec of COMPONENTS) {
      const workItemId = workItemIdByKey.get(spec.key)!;

      // The dispatched alert carries the Strategy's reconciled severity
      // (floor vs. reported, whichever is more urgent) — see
      // src/domain/alerting/severity.ts. That reconciliation is what "what
      // the alerting strategy should have assigned" literally means, and
      // it's computed here via the real backend code, not a hand-copied
      // floor table, so this test can't silently drift from it.
      const expectedAlert = expectedAlertSeverity(spec.componentType, spec.reportedSeverity);
      const alerts = await waitForValue(
        () => findAlertLogsSince(BACKEND_CONTAINER_NAME, ingestStartedAtIso, spec.componentId),
        (lines) => lines.length > 0,
        {
          timeoutMs: 20_000,
          intervalMs: 1_000,
          description: `an ALERT log line for ${spec.componentId}`,
        },
      );
      expect(alerts[0]!.severity, `${spec.componentId} dispatched alert severity`).toBe(
        expectedAlert,
      );

      // The persisted WorkItem row is a different, deliberately separate
      // fact: it stores whatever the triggering signal itself reported,
      // never the floor-reconciled value (see
      // src/services/ingestion/debouncer.ts's toCreateInput and
      // src/services/alerting/dispatcher.ts's toContext — the floor only
      // ever touches the rendered alert). Asserting this too so the test
      // documents that distinction instead of silently assuming they're
      // the same thing.
      const workItem = await prisma.workItem.findUniqueOrThrow({ where: { id: workItemId } });
      expect(workItem.severity, `${spec.componentId} persisted work item severity`).toBe(
        spec.reportedSeverity,
      );
    }
  });

  // --- 5: alerts dispatched once per work item, not once per signal ---
  it("dispatches exactly one alert per work item, not once per signal", async () => {
    for (const spec of COMPONENTS) {
      const alerts = await findAlertLogsSince(
        BACKEND_CONTAINER_NAME,
        ingestStartedAtIso,
        spec.componentId,
      );
      const createdAlerts = alerts.filter((a) => a.msg.includes("New incident opened:"));
      expect(
        createdAlerts,
        `${spec.componentId} received ${SIGNALS_PER_COMPONENT} signals but must fire exactly one "created" alert`,
      ).toHaveLength(1);
    }
  });

  // --- 6: dashboard cache reflects reality ---
  it("dashboard cache (Redis) matches Postgres for every work item", async () => {
    for (const spec of COMPONENTS) {
      const workItemId = workItemIdByKey.get(spec.key)!;

      const score = await redis.zscore("dashboard:active_incidents", workItemId);
      expect(
        score,
        `${spec.componentId}'s work item should be in the active-incidents cache`,
      ).not.toBeNull();

      const cachedRaw = await redis.get(`dashboard:incident:${workItemId}`);
      expect(cachedRaw, `${spec.componentId}'s cached incident summary`).not.toBeNull();
      const cached = JSON.parse(cachedRaw!) as {
        severity: string;
        state: string;
        componentId: string;
        signalCount: number;
      };

      const truth = await prisma.workItem.findUniqueOrThrow({ where: { id: workItemId } });
      expect(cached.componentId).toBe(truth.componentId);
      expect(cached.severity).toBe(truth.severity);
      expect(cached.state).toBe(truth.state);
      expect(cached.signalCount).toBe(truth.signalCount);
    }
  });

  // --- 7-11: full lifecycle on one work item (the RDBMS one) ---
  // ACTOR is still passed to transitionIncident/submitRca below for
  // call-site compatibility, but the server ignores it now — the audit
  // trail records the authenticated caller's email instead (see
  // getAuthenticatedEmail(), asserted against at the end of this block).
  const ACTOR = "e2e-responder";
  let incidentStartTime: string;
  let mttrSeconds: number;

  it("transitions OPEN -> INVESTIGATING -> RESOLVED", async () => {
    const workItemId = workItemIdByKey.get("rdbms")!;

    const toInvestigating = await transitionIncident(workItemId, "INVESTIGATING", ACTOR);
    expect(toInvestigating.status).toBe(200);
    expect(toInvestigating.body["state"]).toBe("INVESTIGATING");

    const toResolved = await transitionIncident(workItemId, "RESOLVED", ACTOR);
    expect(toResolved.status).toBe(200);
    expect(toResolved.body["state"]).toBe("RESOLVED");

    incidentStartTime = new Date(
      new Date(toResolved.body["firstSignalAt"] as string).getTime() + 10,
    ).toISOString();
  });

  it("rejects CLOSED without an RCA and leaves state unchanged", async () => {
    const workItemId = workItemIdByKey.get("rdbms")!;
    const before = await getIncident(workItemId);
    expect(before.body.state).toBe("RESOLVED");
    const before_updatedAt = before.body.updatedAt;

    const closeAttempt = await transitionIncident(workItemId, "CLOSED", ACTOR);
    expect(closeAttempt.status).toBe(409);

    const after = await getIncident(workItemId);
    expect(after.body.state).toBe("RESOLVED");
    expect(after.body.updatedAt).toBe(before_updatedAt);
  });

  it("rejects an RCA missing one required field with a 422 naming that field", async () => {
    const workItemId = workItemIdByKey.get("rdbms")!;
    const incomplete = await submitRca(workItemId, {
      actor: ACTOR,
      incidentStartTime,
      incidentEndTime: new Date().toISOString(),
      rootCauseCategory: "CAPACITY_EXHAUSTION",
      rootCauseDescription: "Connection pool exhausted under sustained load.",
      fixApplied: "Increased max pool size and recycled idle connections.",
      // preventionSteps deliberately omitted
    });
    expect(incomplete.status).toBe(422);
    const errors = incomplete.body["errors"] as Array<{ field: string; message: string }>;
    expect(errors.some((e) => e.field === "preventionSteps")).toBe(true);

    const stillResolved = await getIncident(workItemId);
    expect(stillResolved.body.state).toBe("RESOLVED");
  });

  it("accepts a valid RCA: closes the incident, computes MTTR from firstSignalAt, and records the full transition audit trail", async () => {
    const workItemId = workItemIdByKey.get("rdbms")!;
    const before = await getIncident(workItemId);
    const firstSignalAt = new Date(before.body.firstSignalAt);

    const beforeSubmit = Date.now();
    const rcaResult = await submitRca(workItemId, {
      actor: ACTOR,
      incidentStartTime,
      incidentEndTime: new Date(Date.now() - 50).toISOString(),
      rootCauseCategory: "CAPACITY_EXHAUSTION",
      rootCauseDescription: "Connection pool exhausted under sustained load.",
      fixApplied: "Increased max pool size and recycled idle connections.",
      preventionSteps: "Add pool-utilization alerting before exhaustion.",
    });
    const afterSubmit = Date.now();

    expect(rcaResult.status).toBe(200);
    expect(rcaResult.body["state"]).toBe("CLOSED");

    mttrSeconds = rcaResult.body["mttrSeconds"] as number;
    const expectedMin = Math.floor((beforeSubmit - firstSignalAt.getTime()) / 1000);
    const expectedMax = Math.ceil((afterSubmit - firstSignalAt.getTime()) / 1000);
    expect(mttrSeconds).toBeGreaterThanOrEqual(expectedMin);
    expect(mttrSeconds).toBeLessThanOrEqual(expectedMax);

    const transitions = await getTransitions(workItemId);
    expect(transitions.status).toBe(200);
    const pairs = transitions.items.map((t) => `${t.fromState}->${t.toState}`);
    expect(pairs).toEqual(["OPEN->INVESTIGATING", "INVESTIGATING->RESOLVED", "RESOLVED->CLOSED"]);
    // Not ACTOR (the client-supplied, now-ignored value) — the audit trail
    // records who was actually authenticated for these calls.
    const authenticatedEmail = await getAuthenticatedEmail();
    expect(transitions.items.every((t) => t.actor === authenticatedEmail)).toBe(true);
  });

  // --- 11: analytics endpoints reflect this incident's MTTR ---
  it("analytics endpoints now return this incident's MTTR", async () => {
    const spec = COMPONENTS.find((c) => c.key === "rdbms")!;

    // Scoped to this run's unique componentId — this is its only-ever MTTR
    // sample, so the all-time average must equal it exactly (not just "be
    // in range"), unlike the bucketed endpoint below, which is shared with
    // the rest of this (possibly busy) dev database.
    const componentHealth = await getComponentHealth(spec.componentId);
    expect(componentHealth.status).toBe(200);
    expect(componentHealth.body.avgMttrMs).toBe(mttrSeconds * 1000);

    // Secondary check on the bucketed, grouped endpoint: not exact-value
    // (other componentType=RDBMS traffic on a shared dev stack could share
    // the same bucket), so this asserts presence and a sane magnitude, not
    // an exact match.
    const now = new Date();
    const mttr = await getMttrAnalytics({
      from: new Date(now.getTime() - 5 * 60_000).toISOString(),
      to: new Date(now.getTime() + 60_000).toISOString(),
      interval: 600,
      groupBy: "componentType",
    });
    expect(mttr.status).toBe(200);
    const rdbmsPoint = mttr.points.find((p) => p.value === "RDBMS");
    expect(rdbmsPoint, "an RDBMS point in the MTTR analytics response").toBeDefined();
    expect(rdbmsPoint!.sampleCount).toBeGreaterThanOrEqual(1);
  });

  // --- 12: DLQ is empty ---
  it("the dead-letter queue is empty — nothing from this run failed processing", async () => {
    const after = await getHealth();
    // Diff, not a bare === 0: a shared dev stack can carry residue from
    // unrelated earlier activity, but THIS run must never add to it —
    // that's the actual property "the DLQ is empty" is standing in for.
    expect(after.body.queue.dlqSize, "DLQ size must not have grown during this run").toBe(
      dlqSizeBefore,
    );
  });
});
