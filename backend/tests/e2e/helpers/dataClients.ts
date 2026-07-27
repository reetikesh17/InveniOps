// Direct database connections for verifying what actually landed, bypassing
// the API — same posture as tests/chaos/helpers/dataClients.ts and
// tests/integration/. Necessary here specifically because "did the signal
// actually persist with the right workItemId" and "does the cache agree
// with Postgres" can't be answered by the HTTP layer alone.
import { PrismaClient } from "@prisma/client";
import { MongoClient, type Db } from "mongodb";
import { Redis } from "ioredis";
import { DATABASE_URL, MONGODB_URI, REDIS_URL } from "./testEnv.js";

export function makePrismaClient(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
}

export async function makeMongoDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  return { db: client.db(), close: () => client.close() };
}

export function makeRedisClient(): Redis {
  return new Redis(REDIS_URL);
}
