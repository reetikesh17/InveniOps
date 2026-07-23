import type { Redis } from "ioredis";

// Refills and (if both buckets have enough tokens) debits an IP-scoped and
// a global bucket in one round trip. A Lua script is the only way to make
// "read current tokens, refill, maybe debit, write back" atomic across
// concurrent requests hitting Redis — a read-then-write from Node would
// race under load and let more through than the configured capacity.
//
// Token counts are threaded through the reply as strings (tostring), not
// left as native Lua numbers: Redis converts numeric Lua replies to
// integers, which would silently floor the fractional tokens a bucket
// accumulates between refills.
const TOKEN_BUCKET_SCRIPT = `
local function refill(key, capacity, refill_per_sec, now_ms)
  local bucket = redis.call("HMGET", key, "tokens", "ts")
  local tokens = tonumber(bucket[1])
  local ts = tonumber(bucket[2])
  if tokens == nil then
    tokens = capacity
    ts = now_ms
  end
  local elapsed = math.max(0, now_ms - ts)
  return math.min(capacity, tokens + (elapsed / 1000.0) * refill_per_sec)
end

local ip_key = KEYS[1]
local global_key = KEYS[2]

local ip_capacity = tonumber(ARGV[1])
local ip_refill_per_sec = tonumber(ARGV[2])
local global_capacity = tonumber(ARGV[3])
local global_refill_per_sec = tonumber(ARGV[4])
local now_ms = tonumber(ARGV[5])
local cost = tonumber(ARGV[6])
local ttl_seconds = tonumber(ARGV[7])

local ip_tokens = refill(ip_key, ip_capacity, ip_refill_per_sec, now_ms)
local global_tokens = refill(global_key, global_capacity, global_refill_per_sec, now_ms)

local allowed = 1
local limited_by = ""

if ip_tokens < cost then
  allowed = 0
  limited_by = "ip"
elseif global_tokens < cost then
  allowed = 0
  limited_by = "global"
end

if allowed == 1 then
  ip_tokens = ip_tokens - cost
  global_tokens = global_tokens - cost
end

redis.call("HMSET", ip_key, "tokens", tostring(ip_tokens), "ts", now_ms)
redis.call("EXPIRE", ip_key, ttl_seconds)
redis.call("HMSET", global_key, "tokens", tostring(global_tokens), "ts", now_ms)
redis.call("EXPIRE", global_key, ttl_seconds)

return { allowed, limited_by, tostring(ip_tokens), tostring(global_tokens) }
`;

export interface TokenBucketConfig {
  readonly capacity: number;
  readonly refillPerSecond: number;
}

export interface TokenBucketCheckParams {
  readonly ipKey: string;
  readonly globalKey: string;
  readonly ip: TokenBucketConfig;
  readonly global: TokenBucketConfig;
  /** Tokens this request consumes from both buckets — batch size for the signals endpoint. */
  readonly cost: number;
  readonly now?: Date;
  /** Key TTL in Redis; just needs to outlive the time to fully refill so idle buckets don't linger forever. */
  readonly ttlSeconds?: number;
}

export interface TokenBucketResult {
  readonly allowed: boolean;
  readonly limitedBy: "ip" | "global" | null;
  readonly ip: { readonly remaining: number; readonly capacity: number };
  readonly global: { readonly remaining: number; readonly capacity: number };
}

export async function checkTokenBuckets(
  redis: Redis,
  params: TokenBucketCheckParams,
): Promise<TokenBucketResult> {
  const now = params.now ?? new Date();
  const ttlSeconds = params.ttlSeconds ?? 3600;

  const reply = (await redis.eval(
    TOKEN_BUCKET_SCRIPT,
    2,
    params.ipKey,
    params.globalKey,
    params.ip.capacity,
    params.ip.refillPerSecond,
    params.global.capacity,
    params.global.refillPerSecond,
    now.getTime(),
    params.cost,
    ttlSeconds,
  )) as [number, string, string, string];

  const [allowedFlag, limitedByRaw, ipTokensRaw, globalTokensRaw] = reply;

  return {
    allowed: allowedFlag === 1,
    limitedBy: limitedByRaw === "ip" || limitedByRaw === "global" ? limitedByRaw : null,
    ip: { remaining: Number(ipTokensRaw), capacity: params.ip.capacity },
    global: { remaining: Number(globalTokensRaw), capacity: params.global.capacity },
  };
}

/** Seconds until the given bucket has enough tokens for `cost` more, rounded up. */
export function secondsUntilAvailable(
  bucket: { readonly remaining: number; readonly capacity: number },
  refillPerSecond: number,
  cost: number,
): number {
  const deficit = cost - bucket.remaining;
  if (deficit <= 0) {
    return 0;
  }
  return Math.ceil(deficit / refillPerSecond);
}
