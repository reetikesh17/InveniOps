export type MttrResult =
  | { readonly ok: true; readonly mttrSeconds: number }
  | { readonly ok: false; readonly reason: "clock_skew"; readonly message: string };

// start = first signal received, end = RCA submission, per the assignment
// spec. A negative duration (submission timestamped before the first
// signal) is a clock-skew / data-integrity anomaly, not a valid MTTR of
// zero-or-less — reported explicitly rather than silently clamped or
// returned as a negative number.
export function calculateMttr(firstSignalAt: Date, rcaSubmittedAt: Date): MttrResult {
  const diffMs = rcaSubmittedAt.getTime() - firstSignalAt.getTime();

  if (diffMs < 0) {
    return {
      ok: false,
      reason: "clock_skew",
      message: `rcaSubmittedAt (${rcaSubmittedAt.toISOString()}) is before firstSignalAt (${firstSignalAt.toISOString()}); refusing to report a negative MTTR.`,
    };
  }

  return { ok: true, mttrSeconds: Math.round(diffMs / 1000) };
}
