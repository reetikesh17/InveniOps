import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import { checkTokenBuckets, secondsUntilAvailable } from "../../../src/rateLimit/tokenBucket.js";
import { TEST_REDIS_URL } from "../testEnv.js";

const redis = new Redis(TEST_REDIS_URL);

let ipKey: string;
let globalKey: string;

beforeEach(() => {
  ipKey = `test:ratelimit:ip:${randomUUID()}`;
  globalKey = `test:ratelimit:global:${randomUUID()}`;
});

afterAll(async () => {
  await redis.quit();
});

describe("checkTokenBuckets", () => {
  it("allows a request within capacity and debits the cost from both buckets", async () => {
    const result = await checkTokenBuckets(redis, {
      ipKey,
      globalKey,
      ip: { capacity: 10, refillPerSecond: 1 },
      global: { capacity: 100, refillPerSecond: 10 },
      cost: 3,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(result.allowed).toBe(true);
    expect(result.ip.remaining).toBe(7);
    expect(result.global.remaining).toBe(97);
  });

  it("denies once the ip bucket is exhausted, without touching the global bucket's remaining beyond the attempt", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const first = await checkTokenBuckets(redis, {
      ipKey,
      globalKey,
      ip: { capacity: 5, refillPerSecond: 0 },
      global: { capacity: 1000, refillPerSecond: 0 },
      cost: 5,
      now,
    });
    expect(first.allowed).toBe(true);
    expect(first.ip.remaining).toBe(0);

    const second = await checkTokenBuckets(redis, {
      ipKey,
      globalKey,
      ip: { capacity: 5, refillPerSecond: 0 },
      global: { capacity: 1000, refillPerSecond: 0 },
      cost: 1,
      now,
    });

    expect(second.allowed).toBe(false);
    expect(second.limitedBy).toBe("ip");
    expect(second.ip.remaining).toBe(0);
  });

  it("denies based on the global bucket even when the ip bucket has room", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");

    await checkTokenBuckets(redis, {
      ipKey,
      globalKey,
      ip: { capacity: 1000, refillPerSecond: 0 },
      global: { capacity: 4, refillPerSecond: 0 },
      cost: 4,
      now,
    });

    const result = await checkTokenBuckets(redis, {
      ipKey,
      globalKey,
      ip: { capacity: 1000, refillPerSecond: 0 },
      global: { capacity: 4, refillPerSecond: 0 },
      cost: 1,
      now,
    });

    expect(result.allowed).toBe(false);
    expect(result.limitedBy).toBe("global");
    // The first call already cost 4 against the ip bucket too — both
    // buckets are debited by the same request cost on every allowed call.
    expect(result.ip.remaining).toBe(996);
  });

  it("does not debit either bucket when the request is denied", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    await checkTokenBuckets(redis, {
      ipKey,
      globalKey,
      ip: { capacity: 2, refillPerSecond: 0 },
      global: { capacity: 1000, refillPerSecond: 0 },
      cost: 2,
      now,
    });

    const denied = await checkTokenBuckets(redis, {
      ipKey,
      globalKey,
      ip: { capacity: 2, refillPerSecond: 0 },
      global: { capacity: 1000, refillPerSecond: 0 },
      cost: 1,
      now,
    });
    expect(denied.allowed).toBe(false);
    // The first call already cost 2 against the global bucket too (1000 -> 998);
    // the point of this test is that the denied call itself debits nothing further.
    expect(denied.global.remaining).toBe(998);

    const next = await checkTokenBuckets(redis, {
      ipKey,
      globalKey,
      ip: { capacity: 2, refillPerSecond: 0 },
      global: { capacity: 1000, refillPerSecond: 0 },
      cost: 1,
      now,
    });
    expect(next.allowed).toBe(false);
    expect(next.global.remaining).toBe(998);
  });

  it("refills tokens based on elapsed time between calls", async () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    await checkTokenBuckets(redis, {
      ipKey,
      globalKey,
      ip: { capacity: 10, refillPerSecond: 2 },
      global: { capacity: 1000, refillPerSecond: 0 },
      cost: 10,
      now: start,
    });

    const threeSecondsLater = new Date(start.getTime() + 3000);
    const result = await checkTokenBuckets(redis, {
      ipKey,
      globalKey,
      ip: { capacity: 10, refillPerSecond: 2 },
      global: { capacity: 1000, refillPerSecond: 0 },
      cost: 1,
      now: threeSecondsLater,
    });

    expect(result.allowed).toBe(true);
    // 3s * 2/s = 6 refilled, minus the 1 just spent
    expect(result.ip.remaining).toBe(5);
  });

  it("caps refill at capacity rather than accumulating unbounded credit", async () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    await checkTokenBuckets(redis, {
      ipKey,
      globalKey,
      ip: { capacity: 10, refillPerSecond: 5 },
      global: { capacity: 1000, refillPerSecond: 0 },
      cost: 10,
      now: start,
    });

    const muchLater = new Date(start.getTime() + 10 * 60 * 1000);
    const result = await checkTokenBuckets(redis, {
      ipKey,
      globalKey,
      ip: { capacity: 10, refillPerSecond: 5 },
      global: { capacity: 1000, refillPerSecond: 0 },
      cost: 10,
      now: muchLater,
    });

    expect(result.allowed).toBe(true);
    expect(result.ip.remaining).toBe(0);
  });

  it("under real concurrent requests, admits exactly `capacity` and rejects the rest — no race", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const capacity = 10;
    const attempts = 25;

    const results = await Promise.all(
      Array.from({ length: attempts }, () =>
        checkTokenBuckets(redis, {
          ipKey,
          globalKey,
          ip: { capacity, refillPerSecond: 0 },
          global: { capacity: 1_000_000, refillPerSecond: 0 },
          cost: 1,
          now,
        }),
      ),
    );

    const allowedCount = results.filter((result) => result.allowed).length;
    expect(allowedCount).toBe(capacity);

    const final = await checkTokenBuckets(redis, {
      ipKey,
      globalKey,
      ip: { capacity, refillPerSecond: 0 },
      global: { capacity: 1_000_000, refillPerSecond: 0 },
      cost: 1,
      now,
    });
    expect(final.allowed).toBe(false);
  });
});

describe("secondsUntilAvailable", () => {
  it("is zero when the bucket already has enough tokens", () => {
    expect(secondsUntilAvailable({ remaining: 5, capacity: 10 }, 1, 3)).toBe(0);
  });

  it("rounds up the time needed to accumulate the deficit", () => {
    expect(secondsUntilAvailable({ remaining: 0, capacity: 10 }, 2, 3)).toBe(2);
  });
});
