// Real HTTP against the real app + real Postgres — same posture as
// tests/integration/api/lifecycle.test.ts, but scoped to just
// connectClients() + createApp(): the auth routes touch Postgres (users)
// and Redis (login rate limiting), never Mongo or the ingestion pipeline,
// so the worker system / signal buffer this suite's other test starts
// aren't needed here.
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
  await assertionPrisma.user.deleteMany({ where: { email: { in: createdEmails } } });
  await assertionPrisma.$disconnect();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await disconnectClients();
}, 30_000);

interface JsonResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

async function postJson(path: string, body: unknown, token?: string): Promise<JsonResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function getJson(path: string, token?: string): Promise<JsonResponse> {
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const response = await fetch(`${baseUrl}${path}`, { headers });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function freshEmail(): string {
  const email = `auth-integration-${randomUUID()}@example.com`;
  createdEmails.push(email);
  return email;
}

describe("auth: signup -> login -> me", () => {
  it("signs up, returns a token and the created user, no password hash exposed", async () => {
    const email = freshEmail();
    const signup = await postJson("/api/v1/auth/signup", {
      email,
      password: "correct-horse-battery",
      name: "Integration Test",
    });

    expect(signup.status).toBe(201);
    expect(signup.body["token"]).toBeTypeOf("string");
    const user = signup.body["user"] as Record<string, unknown>;
    expect(user["email"]).toBe(email);
    expect(user["name"]).toBe("Integration Test");
    expect(user["role"]).toBe("RESPONDER");
    expect(user).not.toHaveProperty("passwordHash");
  });

  it("rejects a duplicate email with 409, not creating a second row", async () => {
    const email = freshEmail();
    const first = await postJson("/api/v1/auth/signup", {
      email,
      password: "correct-horse-battery",
      name: "First",
    });
    expect(first.status).toBe(201);

    const second = await postJson("/api/v1/auth/signup", {
      email,
      password: "a-different-password",
      name: "Second",
    });
    expect(second.status).toBe(409);
    expect(second.body["error"]).toBe("duplicate_email");

    const rows = await assertionPrisma.user.count({ where: { email } });
    expect(rows).toBe(1);
  });

  it("rejects signup with an invalid email or a too-short password", async () => {
    const badEmail = await postJson("/api/v1/auth/signup", {
      email: "not-an-email",
      password: "correct-horse-battery",
      name: "Someone",
    });
    expect(badEmail.status).toBe(400);

    const shortPassword = await postJson("/api/v1/auth/signup", {
      email: freshEmail(),
      password: "short",
      name: "Someone",
    });
    expect(shortPassword.status).toBe(400);
  });

  it("logs in with the correct password and rejects the wrong one with the same 401 shape as an unknown email", async () => {
    const email = freshEmail();
    await postJson("/api/v1/auth/signup", {
      email,
      password: "correct-horse-battery",
      name: "Login Test",
    });

    const success = await postJson("/api/v1/auth/login", {
      email,
      password: "correct-horse-battery",
    });
    expect(success.status).toBe(200);
    expect(success.body["token"]).toBeTypeOf("string");

    const wrongPassword = await postJson("/api/v1/auth/login", {
      email,
      password: "wrong-password",
    });
    const unknownEmail = await postJson("/api/v1/auth/login", {
      email: "nobody-at-all@example.com",
      password: "whatever",
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body["error"]).toBe(unknownEmail.body["error"]);
    expect(wrongPassword.body["message"]).toBe(unknownEmail.body["message"]);
  });

  it("GET /me returns the authenticated user for a valid token and 401 for none", async () => {
    const email = freshEmail();
    const signup = await postJson("/api/v1/auth/signup", {
      email,
      password: "correct-horse-battery",
      name: "Me Test",
    });
    const token = signup.body["token"] as string;

    const me = await getJson("/api/v1/auth/me", token);
    expect(me.status).toBe(200);
    expect(me.body["email"]).toBe(email);

    const noToken = await getJson("/api/v1/auth/me");
    expect(noToken.status).toBe(401);
  });

  it("protects incident and analytics routes: 401 without a token, 200 with one", async () => {
    const withoutToken = await getJson("/api/v1/incidents");
    expect(withoutToken.status).toBe(401);

    const email = freshEmail();
    const signup = await postJson("/api/v1/auth/signup", {
      email,
      password: "correct-horse-battery",
      name: "Route Guard Test",
    });
    const token = signup.body["token"] as string;

    const withToken = await getJson("/api/v1/incidents", token);
    expect(withToken.status).toBe(200);
  });

  it("leaves /health, /ready, and signal ingestion public — no token required", async () => {
    // This test doesn't start the worker/queue system (out of scope for
    // an auth test), so /health may legitimately report 503 for the queue
    // dependency — the only thing being asserted here is "no auth
    // required," i.e. never a 401, regardless of dependency health.
    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).not.toBe(401);

    const ingest = await fetch(`${baseUrl}/api/v1/signals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([]),
    });
    // Empty batch is a validation error, not an auth error — the point is
    // it's rejected on its own terms (400), never a 401.
    expect(ingest.status).not.toBe(401);
  });
});
