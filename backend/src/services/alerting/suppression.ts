import type { Redis } from "ioredis";

function deliveryKey(workItemId: string, eventType: string): string {
  return `alert:sent:${workItemId}:${eventType}`;
}

function escalationKey(workItemId: string): string {
  return `alert:escalated:${workItemId}`;
}

/**
 * SET NX EX — same "first writer wins" primitive as the debouncer's
 * creation lock and the rate limiter's token bucket. Returns true if this
 * call is the one that should actually send (the key didn't exist yet);
 * false if a prior attempt or a different replica already claimed it.
 * This, not the "created" flag on the debounce result, is what actually
 * guarantees a restart or a second replica can't double-send.
 */
export async function claimAlertDelivery(
  redis: Redis,
  workItemId: string,
  eventType: string,
  windowSeconds: number,
): Promise<boolean> {
  const result = await redis.set(deliveryKey(workItemId, eventType), "1", "EX", windowSeconds, "NX");
  return result === "OK";
}

/**
 * SADD is naturally idempotent — the return value tells you whether this
 * call was the one that actually added the member. Tracked as a set of
 * level numbers (not a single flag) so a future multi-tier escalation
 * policy can reuse this without a redesign; today only level 1 exists.
 * The TTL is a safety net, same posture as the dashboard cache's
 * per-incident hash — not the primary mechanism (the SADD result is).
 */
export async function claimEscalationLevel(
  redis: Redis,
  workItemId: string,
  level: number,
  windowSeconds: number,
): Promise<boolean> {
  const key = escalationKey(workItemId);
  const added = await redis.sadd(key, String(level));
  await redis.expire(key, windowSeconds);
  return added === 1;
}
