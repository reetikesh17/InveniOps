import { EYEBROW_CLASSES, MONO_MICRO_CLASSES } from "../../components/typography";

interface Metric {
  readonly value: string;
  readonly label: string;
  readonly detail: string;
}

// Every figure here is quoted from docs/performance.md, not rounded up or
// smoothed across trials — see that file for the full methodology
// (scripts/loadtest/orchestrator/{run.js,bulkStress.js}) and both raw trial
// numbers behind each median.
const METRICS: readonly Metric[] = [
  {
    value: "2,664/s",
    label: "baseline persisted/sec",
    detail: "Median of 2 trials (2,729.4/s, 2,599.0/s), rate limiter bypassed via the bulk-test path.",
  },
  {
    value: "~14,081/s",
    label: "persisted/sec after tuning",
    detail:
      "Median of 3 trials (14,080.7 / 3,991.4 / 15,261.9/s) — 2 of 3 landed near 5× baseline, one at 1.5×. Reported with the spread, not smoothed.",
  },
  {
    value: "88–91/s",
    label: "sustained through the real HTTP path",
    detail:
      "k6, through the per-IP rate limiter — this ceiling is the limiter's, not the pipeline's. Buffer fill stayed at 0.0%.",
  },
];

export function MeasuredNumbers(): JSX.Element {
  return (
    <section className="border-t border-border py-16 md:py-section" aria-labelledby="measured-heading">
      <div className="mx-auto max-w-content px-4 sm:px-6">
        <h2 id="measured-heading" className={`${EYEBROW_CLASSES} tracking-widest`}>
          Measured
        </h2>
        <p className="mt-3 max-w-2xl font-body text-lede text-ink-muted">
          Not a claim of 10,000 signals/sec — the assignment&rsquo;s target, never cleanly reproduced.
          What follows is what was actually measured, trial variance included.
        </p>

        <div className="mt-8 grid gap-8 sm:grid-cols-3 sm:gap-6">
          {METRICS.map((m) => (
            <div key={m.label} className="border-t border-border-strong pt-4">
              <p className="font-mono text-stat font-medium tabular-nums text-ink">{m.value}</p>
              <p className={`${MONO_MICRO_CLASSES} mt-1 uppercase tracking-wider`}>{m.label}</p>
              <p className="mt-2 font-body text-prose text-ink-muted">{m.detail}</p>
            </div>
          ))}
        </div>

        <p className="mt-8 max-w-2xl font-body text-prose text-ink-muted">
          All figures measured on one shared developer machine — load generator, Postgres, Mongo,
          Redis, and the backend competing for the same cores, not isolated hosts. The CI regression
          gate is set to 30 persisted/sec, well under even the noisiest trial, deliberately
          conservative rather than tuned to this machine. Full methodology:{" "}
          <span className="font-mono text-mono-micro text-ink-muted">docs/performance.md</span>.
        </p>
      </div>
    </section>
  );
}
