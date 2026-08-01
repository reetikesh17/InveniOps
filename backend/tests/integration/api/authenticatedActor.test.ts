// Focused on one thing: the audit trail (StateTransition.actor,
// RcaRecord's submitter) records the *authenticated* caller's email, not
// anything a client asserts in the request body — the actual point of
// wiring requireAuth into these routes. Creates its work item directly via
// Prisma (not through the real ingestion pipeline — that path is already
// covered end to end by tests/integration/api/lifecycle.test.ts) to keep
// this test scoped to just the actor-attribution behavior.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../../../src/api/app.js";
import { connectClients, disconnectClients } from "../../../src/repositories/clients.js";
import { TEST_DATABASE_URL } from "../testEnv.js";

const assertionPrisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let server: Server;
let baseUrl: string;
const createdEmails: string[] = [];
const createdWorkItemIds: string[] = [];

beforeAll(async () => {
  await connectClients();
  const app = createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 30_000);

afterAll(async () => {
  await assertionPrisma.stateTransition.deleteMany({
    where: { workItemId: { in: createdWorkItemIds } },
  });
  await assertionPrisma.rcaRecord.deleteMany({ where: { workItemId: { in: createdWorkItemIds } } });
  await assertionPrisma.workItem.deleteMany({ where: { id: { in: createdWorkItemIds } } });
  await assertionPrisma.user.deleteMany({ where: { email: { in: createdEmails } } });
  await assertionPrisma.$disconnect();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await disconnectClients();
}, 30_000);

async function signupAndGetToken(): Promise<{ email: string; token: string }> {
  const email = `actor-audit-${randomUUID()}@example.com`;
  createdEmails.push(email);
  const res = await fetch(`${baseUrl}/api/v1/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "correct-horse-battery", name: "Actor Audit Test" }),
  });
  const body = (await res.json()) as { token: string };
  return { email, token: body.token };
}

async function createWorkItem(firstSignalAt: Date): Promise<string> {
  const id = randomUUID();
  createdWorkItemIds.push(id);
  await assertionPrisma.workItem.create({
    data: {
      id,
      componentId: `ACTOR_AUDIT_${id.slice(0, 8)}`,
      componentType: "API",
      severity: "P2",
      title: "actor audit test incident",
      firstSignalAt,
      signalCount: 1,
    },
  });
  return id;
}

describe("authenticated actor recorded in the audit trail", () => {
  it("records the authenticated user's email on a state transition, ignoring any client-supplied actor", async () => {
    const { email, token } = await signupAndGetToken();
    const workItemId = await createWorkItem(new Date());

    const res = await fetch(`${baseUrl}/api/v1/incidents/${workItemId}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      // A client-supplied actor here must be ignored — the server sources
      // it from the authenticated token, not this field.
      body: JSON.stringify({ toState: "INVESTIGATING", actor: "someone-else-entirely" }),
    });
    expect(res.status).toBe(200);

    const transitions = await assertionPrisma.stateTransition.findMany({ where: { workItemId } });
    expect(transitions).toHaveLength(1);
    expect(transitions[0]?.actor).toBe(email);
    expect(transitions[0]?.actor).not.toBe("someone-else-entirely");
  });

  it("records the authenticated user's email on an RCA submission, ignoring any client-supplied actor", async () => {
    const { email, token } = await signupAndGetToken();
    const firstSignalAt = new Date(Date.now() - 60_000);
    const workItemId = await createWorkItem(firstSignalAt);

    await fetch(`${baseUrl}/api/v1/incidents/${workItemId}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ toState: "INVESTIGATING" }),
    });
    await fetch(`${baseUrl}/api/v1/incidents/${workItemId}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ toState: "RESOLVED" }),
    });

    const rcaRes = await fetch(`${baseUrl}/api/v1/incidents/${workItemId}/rca`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        actor: "someone-else-entirely",
        incidentStartTime: firstSignalAt.toISOString(),
        incidentEndTime: new Date().toISOString(),
        rootCauseCategory: "CODE_DEFECT",
        rootCauseDescription: "A sufficiently detailed root cause description for this test.",
        fixApplied: "A sufficiently detailed description of the fix that was applied here.",
        preventionSteps: "A sufficiently detailed description of prevention steps taken here.",
      }),
    });
    expect(rcaRes.status).toBe(200);

    // The close transition (RESOLVED -> CLOSED) that submitRca performs
    // internally must also carry the authenticated actor.
    const closeTransition = await assertionPrisma.stateTransition.findFirst({
      where: { workItemId, toState: "CLOSED" },
    });
    expect(closeTransition?.actor).toBe(email);
    expect(closeTransition?.actor).not.toBe("someone-else-entirely");
  });
});
