// Direct database connections for verifying what actually landed, bypassing
// the API — the same posture as tests/integration/, and necessary here
// specifically because "did the signal actually get persisted" can't be
// answered by the HTTP layer alone (202 means "accepted," not "persisted").
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

/** Minimal Prometheus text-exposition value lookup — just enough to read one gauge/counter sample by name+labels, not the full parser the load-test harness needs. */
export function readMetricValue(
  metricsText: string,
  name: string,
  labels: Readonly<Record<string, string>> = {},
): number {
  const labelPattern = Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(",");
  const linePrefix = labels && Object.keys(labels).length > 0 ? `${name}{` : `${name} `;
  for (const line of metricsText.split("\n")) {
    if (
      !line.startsWith(linePrefix) &&
      !(Object.keys(labels).length === 0 && line.startsWith(`${name} `))
    ) {
      continue;
    }
    if (Object.keys(labels).length > 0 && !line.includes(labelPattern)) {
      continue;
    }
    const match = line.match(/\s(-?[\d.]+(?:e[+-]?\d+)?)\s*$/i);
    if (match) {
      return Number(match[1]);
    }
  }
  return 0;
}
