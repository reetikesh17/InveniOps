#!/usr/bin/env node
// Companion to cascading-failure.ts: walks every "incident" work item that
// run produced through the full lifecycle — OPEN (already there) →
// INVESTIGATING → RESOLVED → a valid RCA, which closes it and computes a
// real MTTR. "baseline" work items are deliberately left untouched, so a
// reviewer opening the dashboard afterward sees both still-active
// incidents and closed ones with real MTTR values, not an empty analytics
// page and not everything closed either.
//
// Usage:
//   npm run cascading-failure         # first — produces .output/last-run.json
//   npm run replay-lifecycle          # then this
//
// See ../../README.md's "Sample Data" section for the full write-up.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ApiClient, type ComponentType } from "./helpers/apiClient.js";
import { banner, section, ok, fail, note, fmtDuration } from "./helpers/format.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface RunRecordWorkItem {
  readonly componentId: string;
  readonly componentType: ComponentType;
  readonly role: "baseline" | "incident";
  readonly workItemId: string;
  readonly severity: string;
  readonly signalCount: number;
}

interface RunRecord {
  readonly runAt: string;
  readonly apiUrl: string;
  readonly workItems: readonly RunRecordWorkItem[];
}

interface Args {
  readonly inputPath: string;
  readonly apiUrl: string;
  readonly actor: string;
}

function parseArgs(argv: readonly string[]): Args {
  const get = (flag: string, fallback: string): string => {
    const index = argv.indexOf(flag);
    return index === -1 || index === argv.length - 1 ? fallback : (argv[index + 1] as string);
  };
  return {
    inputPath: get("--input", path.join(__dirname, ".output", "last-run.json")),
    apiUrl: get("--api-url", process.env["API_BASE_URL"] ?? "http://localhost:3000"),
    actor: get("--actor", "demo-responder"),
  };
}

interface RcaTemplate {
  readonly rootCauseCategory: string;
  readonly rootCauseDescription: string;
  readonly fixApplied: string;
  readonly preventionSteps: string;
}

// One template per component type in the scenario — realistic enough to
// pass validateRca's real rules (>=10 chars, a real ROOT_CAUSE_CATEGORIES
// value), not placeholder text. See backend/src/domain/rca/validateRca.ts.
const RCA_TEMPLATES: Readonly<Record<ComponentType, RcaTemplate>> = {
  RDBMS: {
    rootCauseCategory: "CAPACITY_EXHAUSTION",
    rootCauseDescription:
      "Connection pool exhausted under sustained load, blocking new queries against the primary.",
    fixApplied: "Increased max pool size and recycled idle connections until pressure subsided.",
    preventionSteps:
      "Add pool-utilization alerting before exhaustion and enforce per-query timeouts.",
  },
  API: {
    rootCauseCategory: "EXTERNAL_DEPENDENCY",
    rootCauseDescription:
      "Upstream RDBMS timeouts cascaded into request failures for this service.",
    fixApplied: "Recovered automatically once the database connection pool was restored.",
    preventionSteps:
      "Add circuit breakers so this service fails fast instead of queuing against a degraded dependency.",
  },
  MCP_HOST: {
    rootCauseCategory: "EXTERNAL_DEPENDENCY",
    rootCauseDescription:
      "MCP host degraded as its downstream dependency chain became unavailable.",
    fixApplied: "Recovered automatically once the dependency chain stabilized.",
    preventionSteps:
      "Add independent health checks so MCP host failures are diagnosed separately from downstream causes.",
  },
  CACHE: {
    rootCauseCategory: "EXTERNAL_DEPENDENCY",
    rootCauseDescription:
      "Cache miss storm as requests fell back to the (then-failing) primary database.",
    fixApplied:
      "Miss rate returned to baseline once the database recovered and the cache repopulated naturally.",
    preventionSteps:
      "Add a stale-while-revalidate fallback so cache misses don't stampede a degraded backing store.",
  },
  QUEUE: {
    rootCauseCategory: "CAPACITY_EXHAUSTION",
    rootCauseDescription: "Consumer lag built up faster than the queue could drain it.",
    fixApplied: "Scaled consumers until the backlog cleared.",
    preventionSteps:
      "Alert on consumer lag crossing a threshold, not just on outright queue failure.",
  },
  NOSQL: {
    rootCauseCategory: "CAPACITY_EXHAUSTION",
    rootCauseDescription: "Write latency degraded under load on the document store.",
    fixApplied: "Latency returned to baseline once load subsided.",
    preventionSteps: "Add write-latency alerting independent of the relational store's own health.",
  },
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const api = new ApiClient({ baseUrl: args.apiUrl });

  const record = JSON.parse(readFileSync(args.inputPath, "utf-8")) as RunRecord;
  const incidents = record.workItems.filter((w) => w.role === "incident");
  const baseline = record.workItems.filter((w) => w.role === "baseline");

  banner(`Replaying lifecycle for ${incidents.length} incident(s) from ${record.runAt}`);
  note(`input: ${args.inputPath}  |  API: ${args.apiUrl}  |  actor: ${args.actor}`);

  const results: { componentId: string; workItemId: string; mttrSeconds: number }[] = [];

  for (const item of incidents) {
    section(`${item.componentId}  (${item.workItemId})`);

    const investigating = await api.transition(item.workItemId, "INVESTIGATING", args.actor);
    if (investigating.status !== 200) {
      fail(
        `transition to INVESTIGATING failed: ${investigating.status} ${JSON.stringify(investigating.body)}`,
      );
      continue;
    }
    ok(`OPEN → INVESTIGATING`);

    const resolved = await api.transition(item.workItemId, "RESOLVED", args.actor);
    if (resolved.status !== 200) {
      fail(`transition to RESOLVED failed: ${resolved.status} ${JSON.stringify(resolved.body)}`);
      continue;
    }
    ok(`INVESTIGATING → RESOLVED`);

    const template = RCA_TEMPLATES[item.componentType];
    const now = new Date();
    const rcaResult = await api.submitRca(item.workItemId, {
      actor: args.actor,
      // The work item's own firstSignalAt — RCA validation requires
      // incidentStartTime can't precede it (see validateRca.ts) — so the
      // resulting MTTR reflects the scenario's *real* timeline, not a
      // fabricated one.
      incidentStartTime: resolved.body.firstSignalAt,
      incidentEndTime: now.toISOString(),
      rootCauseCategory: template.rootCauseCategory,
      rootCauseDescription: template.rootCauseDescription,
      fixApplied: template.fixApplied,
      preventionSteps: template.preventionSteps,
    });

    if (rcaResult.status !== 200 || typeof rcaResult.body.mttrSeconds !== "number") {
      fail(`RCA submission failed: ${rcaResult.status} ${JSON.stringify(rcaResult.raw)}`);
      continue;
    }
    ok(`RESOLVED → CLOSED, RCA accepted, MTTR = ${fmtDuration(rcaResult.body.mttrSeconds)}`);
    results.push({
      componentId: item.componentId,
      workItemId: item.workItemId,
      mttrSeconds: rcaResult.body.mttrSeconds,
    });
  }

  banner("Summary");
  console.log(`  Closed with a real MTTR:`);
  for (const r of results) {
    console.log(
      `    ${r.componentId.padEnd(22)} ${r.workItemId}  MTTR ${fmtDuration(r.mttrSeconds)}`,
    );
  }
  console.log(
    `\n  Left OPEN (never part of the failure narrative — still active on the dashboard):`,
  );
  for (const b of baseline) {
    console.log(`    ${b.componentId.padEnd(22)} ${b.workItemId}`);
  }

  note(
    `\ndashboard: http://localhost:5173 — Live Feed shows the ${baseline.length} still-open item(s), analytics/MTTR now has ${results.length} closed incident(s) to compute from.`,
  );
}

main().catch((error: unknown) => {
  console.error("\nFATAL:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
