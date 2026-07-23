import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient, ComponentType, Severity } from "@prisma/client";
import { MongoClient, type Db } from "mongodb";
import { createApp } from "../../../src/api/app.js";
import { connectClients, disconnectClients } from "../../../src/repositories/clients.js";
import { signalBuffer } from "../../../src/services/ingestion/signalBufferInstance.js";
import { startWorkerSystem, stopWorkerSystem, type WorkerSystem } from "../../../src/workers/index.js";
import { TEST_DATABASE_URL, TEST_MONGODB_URI } from "../testEnv.js";

const COMPONENT_ID = `LIFECYCLE_TEST_${randomUUID()}`;

const assertionPrisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const assertionMongoClient = new MongoClient(TEST_MONGODB_URI);
let assertionDb: Db;

let server: Server;
let baseUrl: string;
let workerSystem: WorkerSystem;

beforeAll(async () => {
  await connectClients();
  await assertionMongoClient.connect();
  assertionDb = assertionMongoClient.db();

  workerSystem = await startWorkerSystem();
  signalBuffer.setSink(workerSystem.sink);
  signalBuffer.start();

  const app = createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 30_000);

afterAll(async () => {
  signalBuffer.stop();
  await stopWorkerSystem(workerSystem, 10_000);
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });

  // Child rows first — work_items is referenced by both with ON DELETE RESTRICT.
  const workItemIds = (await assertionPrisma.workItem.findMany({
    where: { componentId: COMPONENT_ID },
    select: { id: true },
  })).map((workItem) => workItem.id);
  await assertionPrisma.stateTransition.deleteMany({ where: { workItemId: { in: workItemIds } } });
  await assertionPrisma.rcaRecord.deleteMany({ where: { workItemId: { in: workItemIds } } });
  await assertionPrisma.workItem.deleteMany({ where: { componentId: COMPONENT_ID } });
  await assertionDb.collection("signals").deleteMany({ componentId: COMPONENT_ID });

  await assertionPrisma.$disconnect();
  await assertionMongoClient.close();
  await disconnectClients();
}, 30_000);

async function waitUntil<T>(fn: () => Promise<T | undefined | null>, timeoutMs: number, intervalMs = 200): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result !== undefined && result !== null) {
      return result;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }
  throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
}

interface JsonResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

async function postJson(path: string, body: unknown): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function getJson(path: string): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const RCA_TEXT = "Restarted the connection pool after exhausting max connections.";

describe("incident lifecycle: ingest -> investigate -> resolve -> reject bad close -> RCA -> closed", () => {
  it("carries one incident through its full lifecycle end to end via the real API", async () => {
    // 1. Ingest signals for a fresh component.
    const ingest = await postJson("/api/v1/signals", [
      {
        componentId: COMPONENT_ID,
        componentType: ComponentType.CACHE,
        severity: Severity.P1,
        rawPayload: { message: "connection refused" },
        occurredAt: new Date().toISOString(),
      },
      {
        componentId: COMPONENT_ID,
        componentType: ComponentType.CACHE,
        severity: Severity.P1,
        rawPayload: { message: "connection refused" },
        occurredAt: new Date().toISOString(),
      },
      {
        componentId: COMPONENT_ID,
        componentType: ComponentType.CACHE,
        severity: Severity.P1,
        rawPayload: { message: "connection refused" },
        occurredAt: new Date().toISOString(),
      },
    ]);
    expect(ingest.status).toBe(202);

    // 2. Work item appears and all 3 signals are counted (async, via the
    // buffer -> queue -> worker -> debouncer pipeline — the row can exist
    // with signalCount still 0 momentarily, between creation and the
    // increment step, so wait for the count, not just existence).
    const workItemId = await waitUntil(async () => {
      const workItem = await assertionPrisma.workItem.findFirst({ where: { componentId: COMPONENT_ID } });
      return workItem && workItem.signalCount >= 3 ? workItem.id : undefined;
    }, 20_000);

    const created = await getJson(`/api/v1/incidents/${workItemId}`);
    expect(created.status).toBe(200);
    expect(created.body["state"]).toBe("OPEN");
    expect(created.body["signalCount"]).toBe(3);
    expect(created.body["legalNextStates"]).toEqual(["INVESTIGATING"]);
    const firstSignalAt = new Date(created.body["firstSignalAt"] as string);

    // It's visible in the active-incident list too (cache-backed).
    const list = await getJson("/api/v1/incidents?limit=200");
    expect(list.status).toBe(200);
    const items = list.body["items"] as Array<Record<string, unknown>>;
    expect(items.some((item) => item["id"] === workItemId)).toBe(true);

    // Its raw signals are retrievable from Mongo.
    const signals = await getJson(`/api/v1/incidents/${workItemId}/signals`);
    expect(signals.status).toBe(200);
    expect(signals.body["total"]).toBe(3);

    // 3. OPEN -> INVESTIGATING.
    const toInvestigating = await postJson(`/api/v1/incidents/${workItemId}/transition`, {
      toState: "INVESTIGATING",
      actor: "oncall-alice",
    });
    expect(toInvestigating.status).toBe(200);
    expect(toInvestigating.body["state"]).toBe("INVESTIGATING");

    // 4. INVESTIGATING -> RESOLVED.
    const toResolved = await postJson(`/api/v1/incidents/${workItemId}/transition`, {
      toState: "RESOLVED",
      actor: "oncall-alice",
    });
    expect(toResolved.status).toBe(200);
    expect(toResolved.body["state"]).toBe("RESOLVED");

    // 5. Attempting CLOSED via the plain transition endpoint is rejected —
    // no RCA payload is ever supplied through this endpoint, so the
    // domain layer's canClose guard fails unconditionally.
    const closeWithoutRca = await postJson(`/api/v1/incidents/${workItemId}/transition`, {
      toState: "CLOSED",
      actor: "oncall-alice",
    });
    expect(closeWithoutRca.status).toBe(409);

    // incidentStartTime just needs to be >= firstSignalAt; incidentEndTime
    // just needs to be <= "now" at submission time. firstSignalAt is very
    // recent (the whole pipeline runs in well under a second), so pin
    // incidentEndTime to "now minus a safety margin" rather than a fixed
    // offset from firstSignalAt — a fixed offset risks landing in the
    // future if the pipeline (as it does) finishes faster than the offset.
    const incidentStartTime = new Date(firstSignalAt.getTime() + 10).toISOString();
    const incidentEndTime = (): string => new Date(Date.now() - 50).toISOString();

    // 6. Submitting an incomplete RCA is rejected with field-level errors,
    // and the incident stays RESOLVED.
    const incompleteRca = await postJson(`/api/v1/incidents/${workItemId}/rca`, {
      actor: "oncall-alice",
      incidentStartTime,
      incidentEndTime: incidentEndTime(),
      rootCauseCategory: "INFRASTRUCTURE_FAILURE",
      // rootCauseDescription, fixApplied, preventionSteps omitted
    });
    expect(incompleteRca.status).toBe(422);
    expect(Array.isArray(incompleteRca.body["errors"])).toBe(true);
    const stillResolved = await getJson(`/api/v1/incidents/${workItemId}`);
    expect(stillResolved.body["state"]).toBe("RESOLVED");

    // 7. A valid RCA closes the incident and computes MTTR from
    // firstSignalAt to submission time.
    const beforeSubmit = Date.now();
    const validRca = await postJson(`/api/v1/incidents/${workItemId}/rca`, {
      actor: "oncall-alice",
      incidentStartTime,
      incidentEndTime: incidentEndTime(),
      rootCauseCategory: "INFRASTRUCTURE_FAILURE",
      rootCauseDescription: RCA_TEXT,
      fixApplied: RCA_TEXT,
      preventionSteps: RCA_TEXT,
    });
    const afterSubmit = Date.now();
    expect(validRca.status).toBe(200);
    expect(validRca.body["state"]).toBe("CLOSED");

    const expectedMinMttr = Math.floor((beforeSubmit - firstSignalAt.getTime()) / 1000);
    const expectedMaxMttr = Math.ceil((afterSubmit - firstSignalAt.getTime()) / 1000);
    const mttrSeconds = validRca.body["mttrSeconds"] as number;
    expect(mttrSeconds).toBeGreaterThanOrEqual(expectedMinMttr);
    expect(mttrSeconds).toBeLessThanOrEqual(expectedMaxMttr);

    // 8. CLOSED — no longer in the active cache, served directly from
    // Postgres, RCA included, no further transitions legal.
    const closed = await getJson(`/api/v1/incidents/${workItemId}`);
    expect(closed.status).toBe(200);
    expect(closed.body["state"]).toBe("CLOSED");
    expect(closed.body["legalNextStates"]).toEqual([]);
    expect(closed.body["rca"]).toMatchObject({ rootCauseCategory: "INFRASTRUCTURE_FAILURE", mttrSeconds });

    const closedList = await getJson("/api/v1/incidents?limit=200");
    const closedItems = closedList.body["items"] as Array<Record<string, unknown>>;
    expect(closedItems.some((item) => item["id"] === workItemId)).toBe(false);
  }, 60_000);
});
