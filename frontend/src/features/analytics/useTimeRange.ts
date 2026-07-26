import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

// Relative presets, not absolute from/to, are what live in the URL — so a
// shared link always shows a fresh window ("last 6h") rather than a frozen
// one, and a refresh re-snapshots "now". All bucketing is still server-side;
// these only choose the window and the bucket width the API is asked for.
export const RANGE_OPTIONS = [
  { key: "15m", label: "Last 15m", seconds: 900 },
  { key: "1h", label: "Last 1h", seconds: 3_600 },
  { key: "6h", label: "Last 6h", seconds: 21_600 },
  { key: "24h", label: "Last 24h", seconds: 86_400 },
  { key: "7d", label: "Last 7d", seconds: 604_800 },
] as const;

export const INTERVAL_OPTIONS = [
  { key: "1m", label: "1m", seconds: 60 },
  { key: "5m", label: "5m", seconds: 300 },
  { key: "15m", label: "15m", seconds: 900 },
  { key: "1h", label: "1h", seconds: 3_600 },
  { key: "6h", label: "6h", seconds: 21_600 },
] as const;

export type RangeKey = (typeof RANGE_OPTIONS)[number]["key"];
export type IntervalKey = (typeof INTERVAL_OPTIONS)[number]["key"];

const DEFAULT_RANGE: RangeKey = "6h";

// A sensible bucket width per range, used when the URL doesn't pin one — keeps
// the bucket count reasonable (tens, not thousands) at every range.
const DEFAULT_INTERVAL_FOR_RANGE: Record<RangeKey, IntervalKey> = {
  "15m": "1m",
  "1h": "5m",
  "6h": "15m",
  "24h": "1h",
  "7d": "6h",
};

function isRangeKey(value: string | null): value is RangeKey {
  return RANGE_OPTIONS.some((option) => option.key === value);
}

function isIntervalKey(value: string | null): value is IntervalKey {
  return INTERVAL_OPTIONS.some((option) => option.key === value);
}

export interface TimeRange {
  readonly rangeKey: RangeKey;
  readonly intervalKey: IntervalKey;
  readonly fromIso: string;
  readonly toIso: string;
  readonly fromMs: number;
  readonly toMs: number;
  readonly intervalSeconds: number;
  readonly rangeSeconds: number;
  readonly setRange: (key: RangeKey) => void;
  readonly setInterval: (key: IntervalKey) => void;
  readonly refresh: () => void;
}

/**
 * Single source of truth for the shared range/interval across every analytics
 * panel, persisted in the URL query string so a view is shareable. from/to are
 * snapshotted from `now` and only change when the selection changes or the
 * user hits refresh (via `nonce`) — never every render — so downstream
 * fetch effects don't loop.
 */
export function useTimeRange(): TimeRange {
  const [searchParams, setSearchParams] = useSearchParams();
  const [nonce, setNonce] = useState(0);

  const rangeParam = searchParams.get("range");
  const rangeKey: RangeKey = isRangeKey(rangeParam) ? rangeParam : DEFAULT_RANGE;

  const intervalParam = searchParams.get("interval");
  const intervalKey: IntervalKey = isIntervalKey(intervalParam) ? intervalParam : DEFAULT_INTERVAL_FOR_RANGE[rangeKey];

  const rangeSeconds = RANGE_OPTIONS.find((option) => option.key === rangeKey)?.seconds ?? 21_600;
  const intervalSeconds = INTERVAL_OPTIONS.find((option) => option.key === intervalKey)?.seconds ?? 900;

  const { fromIso, toIso, fromMs, toMs } = useMemo(() => {
    const now = Date.now();
    const from = now - rangeSeconds * 1000;
    return {
      fromIso: new Date(from).toISOString(),
      toIso: new Date(now).toISOString(),
      fromMs: from,
      toMs: now,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-snapshot only on selection change or explicit refresh
  }, [rangeKey, intervalKey, rangeSeconds, nonce]);

  const setRange = useCallback(
    (key: RangeKey): void => {
      const next = new URLSearchParams(searchParams);
      next.set("range", key);
      // Drop an explicit interval so it follows the new range's default,
      // unless the user had pinned one deliberately.
      if (!isIntervalKey(next.get("interval"))) {
        next.delete("interval");
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const setInterval = useCallback(
    (key: IntervalKey): void => {
      const next = new URLSearchParams(searchParams);
      next.set("interval", key);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const refresh = useCallback((): void => setNonce((n) => n + 1), []);

  return {
    rangeKey,
    intervalKey,
    fromIso,
    toIso,
    fromMs,
    toMs,
    intervalSeconds,
    rangeSeconds,
    setRange,
    setInterval,
    refresh,
  };
}
