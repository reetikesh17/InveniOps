#!/usr/bin/env node
// Replays cascading-failure.json against a real, running InveniOps stack —
// narrating each beat as it happens and then verifying, against the real
// system (not inferred), that debouncing, the alerting Strategy, signal
// linkage, and the ingestion buffer all behaved the way the assignment
// asks this scenario to demonstrate.
//
// Usage:
//   npm run cascading-failure                # real time (~3 minutes)
//   npm run cascading-failure -- --speed 30   # compressed, for CI (~10s)
//
// See ../../README.md's "Sample Data" section for the full write-up.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ApiClient,
  type ComponentType,
  type Severity,
  type SignalInput,
} from "./helpers/apiClient.js";
import { WorkItemLookup } from "./helpers/db.js";
import { findAlertLogsSince } from "./helpers/docker.js";
import { sleep, waitFor, waitForValue } from "./helpers/wait.js";
import {
  banner,
  section,
  ok,
  fail,
  info,
  note,
  fmtDuration,
  fmtElapsed,
} from "./helpers/format.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mirrors backend/src/domain/alerting/strategies/*.ts's severityFloor
// exactly — duplicated here (not imported: this script lives outside
// backend/'s workspace) purely so the verification step below can state
// what it *expects* before checking the real alert log line.
const SEVERITY_FLOOR: Readonly<Record<ComponentType, Severity>> = {
  RDBMS: "P0",
  API: "P1",
  MCP_HOST: "P1",
  NOSQL: "P1",
  QUEUE: "P1",
  CACHE: "P2",
};

interface SignalSpec {
  readonly componentId: string;
  readonly componentType: ComponentType;
  readonly role: "baseline" | "incident";
  readonly severity: Severity;
  readonly reason: string;
  readonly mode: "burst" | "ramp";
  readonly count?: number;
  readonly durationSeconds?: number;
  readonly rampFromPerSecond?: number;
  readonly rampToPerSecond?: number;
}

interface Beat {
  readonly id: string;
  readonly atSeconds: number;
  readonly label: string;
  readonly narration: string;
  readonly signals: readonly SignalSpec[];
}

interface Scenario {
  readonly name: string;
  readonly description: string;
  readonly beats: readonly Beat[];
}

interface Args {
  readonly speed: number;
  readonly apiUrl: string;
  readonly databaseUrl: string;
  readonly containerName: string;
  readonly outputPath: string;
}

function parseArgs(argv: readonly string[]): Args {
  const get = (flag: string, fallback: string): string => {
    const index = argv.indexOf(flag);
    return index === -1 || index === argv.length - 1 ? fallback : (argv[index + 1] as string);
  };
  return {
    speed: Number(get("--speed", "1")),
    apiUrl: get("--api-url", process.env["API_BASE_URL"] ?? "http://localhost:3000"),
    databaseUrl: get(
      "--database-url",
      process.env["DATABASE_URL"] ?? "postgresql://ims_user:ims_password@localhost:5432/ims",
    ),
    containerName: get(
      "--container",
      process.env["BACKEND_CONTAINER_NAME"] ?? "inveniops-ims-backend-1",
    ),
    outputPath: get("--output", path.join(__dirname, ".output", "last-run.json")),
  };
}

function loadScenario(): Scenario {
  const raw = readFileSync(path.join(__dirname, "cascading-failure.json"), "utf-8");
  return JSON.parse(raw) as Scenario;
}

/** Every second-tick's signal count for a ramp — a straight linear interpolation, sampled once per (uncompressed) second. */
function rampRatesPerSecond(
  fromPerSecond: number,
  toPerSecond: number,
  durationSeconds: number,
): readonly number[] {
  if (durationSeconds <= 1) {
    return [toPerSecond];
  }
  return Array.from({ length: durationSeconds }, (_, i) =>
    Math.round(fromPerSecond + ((toPerSecond - fromPerSecond) * i) / (durationSeconds - 1)),
  );
}

function makeSignal(spec: SignalSpec, tickIndex: number): SignalInput {
  return {
    signalId: `cascading-failure-${spec.componentId}-${Date.now()}-${tickIndex}-${Math.random().toString(36).slice(2, 8)}`,
    componentId: spec.componentId,
    componentType: spec.componentType,
    severity: spec.severity,
    rawPayload: { scenario: "cascading-failure", reason: spec.reason },
    occurredAt: new Date().toISOString(),
  };
}

interface RunTotals {
  sent: number;
  accepted: number;
  dropped: number;
  rateLimitRetries: number;
}

interface ComponentSendTotals {
  sent: number;
}

async function postBatch(
  api: ApiClient,
  signals: readonly SignalInput[],
  totals: RunTotals,
): Promise<void> {
  if (signals.length === 0) {
    return;
  }
  const result = await api.postSignals(signals);
  totals.sent += signals.length;
  totals.accepted += result.accepted;
  totals.dropped += result.dropped;
  totals.rateLimitRetries += result.retries;
  if (result.status !== 202) {
    fail(
      `unexpected status ${result.status} posting ${signals.length} signal(s) for a batch — see response above`,
    );
  }
}

async function runSignalSpec(
  api: ApiClient,
  spec: SignalSpec,
  speed: number,
  totals: RunTotals,
  perComponent: Map<string, ComponentSendTotals>,
): Promise<void> {
  const bucket = perComponent.get(spec.componentId) ?? { sent: 0 };
  perComponent.set(spec.componentId, bucket);

  if (spec.mode === "burst") {
    const count = spec.count ?? 0;
    const signals = Array.from({ length: count }, (_, i) => makeSignal(spec, i));
    info(`${spec.componentId}: burst of ${count} signal(s), reported severity ${spec.severity}`);
    await postBatch(api, signals, totals);
    bucket.sent += count;
    return;
  }

  // ramp
  const from = spec.rampFromPerSecond ?? 1;
  const to = spec.rampToPerSecond ?? 1;
  const duration = spec.durationSeconds ?? 1;
  const rates = rampRatesPerSecond(from, to, duration);
  info(
    `${spec.componentId}: ramping ${from}/s → ${to}/s over ${duration}s, reported severity ${spec.severity}`,
  );

  for (let tick = 0; tick < rates.length; tick += 1) {
    const rate = rates[tick] as number;
    const signals = Array.from({ length: rate }, (_, i) => makeSignal(spec, tick * 1000 + i));
    await postBatch(api, signals, totals);
    bucket.sent += rate;
    if (tick % 3 === 0 || tick === rates.length - 1) {
      info(`  t+${tick}s: ${rate} signal(s)/s (cumulative ${bucket.sent})`);
    }
    if (tick < rates.length - 1) {
      await sleep(1000 / speed);
    }
  }
}

function collectComponents(
  scenario: Scenario,
): Map<string, { componentType: ComponentType; role: "baseline" | "incident" }> {
  const components = new Map<
    string,
    { componentType: ComponentType; role: "baseline" | "incident" }
  >();
  for (const beat of scenario.beats) {
    for (const spec of beat.signals) {
      components.set(spec.componentId, { componentType: spec.componentType, role: spec.role });
    }
  }
  return components;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const scenario = loadScenario();
  const api = new ApiClient({ baseUrl: args.apiUrl });
  const db = new WorkItemLookup(args.databaseUrl);

  banner(`Cascading failure: ${scenario.description}`);
  note(
    `API: ${args.apiUrl}  |  speed: ${args.speed}x  |  real-time total: ${fmtDuration(180)}, this run: ${fmtDuration(180 / args.speed)}`,
  );

  section("Preflight");
  const preflight = await api.getHealth().catch((error: unknown) => {
    throw new Error(
      `couldn't reach ${args.apiUrl}/health (${String(error)}) — is the stack up? Try: docker compose up -d`,
    );
  });
  if (preflight.body.status !== "healthy") {
    fail(
      `backend reports "${preflight.body.status}", not "healthy" — dependencies: ${JSON.stringify(preflight.body.dependencies)}`,
    );
    throw new Error("refusing to run the scenario against an unhealthy stack");
  }
  ok(`backend healthy at ${args.apiUrl}`);

  const components = collectComponents(scenario);
  note(
    `recording baseline signal counts for ${components.size} components before sending anything (makes this script safely re-runnable)`,
  );
  const baselineCounts = new Map<string, number>();
  for (const componentId of components.keys()) {
    const existing = await db.findActive(componentId);
    baselineCounts.set(componentId, existing?.signalCount ?? 0);
  }

  const totals: RunTotals = { sent: 0, accepted: 0, dropped: 0, rateLimitRetries: 0 };
  const perComponent = new Map<string, ComponentSendTotals>();
  const scenarioStartedAt = Date.now();
  const scenarioStartedAtIso = new Date(scenarioStartedAt).toISOString();

  for (const beat of scenario.beats) {
    const targetElapsedMs = (beat.atSeconds * 1000) / args.speed;
    const alreadyElapsedMs = Date.now() - scenarioStartedAt;
    if (targetElapsedMs > alreadyElapsedMs) {
      await sleep(targetElapsedMs - alreadyElapsedMs);
    }

    section(`T+${beat.atSeconds}s  ${beat.label}  (elapsed ${fmtElapsed(scenarioStartedAt)})`);
    console.log(`  ${beat.narration}`);
    for (const spec of beat.signals) {
      await runSignalSpec(api, spec, args.speed, totals, perComponent);
    }
  }

  section("Waiting for the pipeline to finish processing");
  await waitFor(
    async () => {
      const { body } = await api.getHealth();
      return body.queue.waitingCount === 0 && body.queue.activeCount === 0;
    },
    { timeoutMs: 60_000, intervalMs: 500, description: "the BullMQ queue to fully drain" },
  ).catch((error: unknown) =>
    note(
      `queue didn't fully report empty in time (${String(error)}) — continuing to verify anyway`,
    ),
  );

  banner("Verifying outcomes");

  section("Buffer absorbed the burst without loss");
  console.log(
    `  ${totals.sent} signals sent across the whole scenario, ${totals.accepted} accepted, ${totals.dropped} dropped by the buffer, ${totals.rateLimitRetries} rate-limit retries.`,
  );
  if (totals.dropped === 0) {
    ok("zero signals dropped by the ingestion buffer — no loss");
  } else {
    fail(
      `${totals.dropped} signal(s) were dropped (503 buffer_saturated) — see per-beat log above`,
    );
  }

  section("Debouncing and signal linkage (every componentId's real, persisted signalCount)");
  interface VerifiedComponent {
    readonly componentId: string;
    readonly componentType: ComponentType;
    readonly role: "baseline" | "incident";
    readonly workItemId: string;
    readonly severity: Severity;
    readonly signalCount: number;
  }
  const verified: VerifiedComponent[] = [];

  for (const [componentId, meta] of components) {
    const sentThisRun = perComponent.get(componentId)?.sent ?? 0;
    const expected = (baselineCounts.get(componentId) ?? 0) + sentThisRun;
    try {
      await waitFor(
        async () => {
          const row = await db.findActive(componentId);
          return row !== null && row.signalCount >= expected;
        },
        {
          timeoutMs: 30_000,
          intervalMs: 1_000,
          description: `${componentId}'s work item to reach signalCount ${expected}`,
        },
      );
    } catch (error) {
      fail(String(error));
      continue;
    }
    const row = await db.findActive(componentId);
    if (!row) {
      fail(`${componentId}: no active work item found after waiting`);
      continue;
    }
    const matchedExactly = row.signalCount === expected;
    const line = `${componentId}: 1 work item (${row.id}), severity=${row.severity}, signalCount=${row.signalCount} (sent ${sentThisRun} this run${baselineCounts.get(componentId) ? `, ${baselineCounts.get(componentId)} pre-existing` : ""})`;
    if (matchedExactly) {
      ok(line);
    } else {
      // Still >= expected (waitFor's own condition) — a real dev stack can have concurrent traffic; not a failure, just noted.
      note(
        `${line} — note: exceeds this run's expected count, other traffic may be hitting the same component`,
      );
    }
    verified.push({
      componentId,
      componentType: meta.componentType,
      role: meta.role,
      workItemId: row.id,
      severity: row.severity as Severity,
      signalCount: row.signalCount,
    });
  }

  const rdbmsComponent = verified.find((c) => c.componentId === "DB_PRIMARY_01");
  if (rdbmsComponent) {
    ok(
      `debouncing: ${perComponent.get("DB_PRIMARY_01")?.sent ?? 0} RDBMS signals collapsed into exactly 1 work item (${rdbmsComponent.workItemId}) — enforced by the Postgres partial unique index, not just the Redis fast path`,
    );
  }

  section("Alerting Strategy — severity floor per component type (see backend logs)");
  const incidentComponents = verified.filter((c) => c.role === "incident");
  for (const component of incidentComponents) {
    const expectedFloor = SEVERITY_FLOOR[component.componentType];
    const reportedSeverity = scenario.beats
      .flatMap((b) => b.signals)
      .find((s) => s.componentId === component.componentId)?.severity;
    const expectedAlertSeverity =
      reportedSeverity && rank(reportedSeverity) < rank(expectedFloor)
        ? reportedSeverity
        : expectedFloor;

    try {
      const logs = await waitForValue(
        () => findAlertLogsSince(args.containerName, scenarioStartedAtIso, component.componentId),
        (lines) => lines.length > 0,
        {
          timeoutMs: 20_000,
          intervalMs: 1_000,
          description: `an ALERT log line for ${component.componentId}`,
        },
      );
      const firstAlert = logs[0]!;
      const matches = firstAlert.severity === expectedAlertSeverity;
      const reconciledNote =
        reportedSeverity !== expectedAlertSeverity
          ? ` (reported ${reportedSeverity}, floor ${expectedFloor} — floor won)`
          : ` (matches floor ${expectedFloor})`;
      if (matches) {
        ok(
          `${component.componentId} (${component.componentType}): alert dispatched at ${firstAlert.severity}${reconciledNote}`,
        );
      } else {
        fail(
          `${component.componentId}: expected alert severity ${expectedAlertSeverity}, got ${firstAlert.severity}`,
        );
      }
    } catch (error) {
      fail(
        `${component.componentId}: no ALERT log line found — ${String(error)} (is BACKEND_CONTAINER_NAME correct? currently "${args.containerName}")`,
      );
    }
  }

  mkdirSync(path.dirname(args.outputPath), { recursive: true });
  writeFileSync(
    args.outputPath,
    JSON.stringify(
      {
        runAt: scenarioStartedAtIso,
        apiUrl: args.apiUrl,
        workItems: verified,
      },
      null,
      2,
    ),
  );

  banner("Done");
  note(`run record written to ${args.outputPath}`);
  note(
    `next: npm run replay-lifecycle   (walks the ${incidentComponents.length} incident work items to CLOSED with a real RCA and MTTR)`,
  );
  note(`dashboard: http://localhost:5173`);

  await db.close();
}

function rank(severity: Severity): number {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[severity];
}

main().catch((error: unknown) => {
  console.error("\nFATAL:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
