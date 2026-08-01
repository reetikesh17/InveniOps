// Reads backend container logs to verify the alerting Strategy's severity
// reconciliation — the reconciled severity only ever shows up in the
// dispatched alert (see backend/src/services/alerting/dispatcher.ts and
// notifiers/console.ts), never in the persisted work item row, which
// stores whatever the triggering signal itself reported. Read-only: unlike
// backend/tests/chaos/helpers/docker.ts, nothing here pauses, stops, or
// kills anything — this is a log query, not a disruption.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface AlertLogLine {
  readonly severity: string;
  readonly title: string;
  readonly componentId: string;
}

/**
 * Every line the ConsoleNotifier emits is a pino JSON line with
 * `msg: "ALERT [<severity>] <title>"` and a structured `severity` /
 * `componentId` field (see backend/src/services/alerting/notifiers/console.ts)
 * — parsed as JSON, not regexed out of the message text, since the
 * structured fields are the actual contract and the message text is just
 * for human eyes.
 */
export async function findAlertLogsSince(
  containerName: string,
  sinceIso: string,
  componentId: string,
): Promise<AlertLogLine[]> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("docker", ["logs", containerName, "--since", sinceIso], {
      maxBuffer: 32 * 1024 * 1024,
    }));
  } catch (error) {
    throw new Error(
      `couldn't read logs from container "${containerName}" — is the stack running under that name? (${String(error)})`,
    );
  }

  const matches: AlertLogLine[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.includes('"componentId":"' + componentId + '"') || !line.includes('"msg":"ALERT [')) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as {
        severity?: string;
        title?: string;
        componentId?: string;
        msg?: string;
      };
      if (
        parsed.componentId === componentId &&
        typeof parsed.msg === "string" &&
        parsed.msg.startsWith("ALERT [")
      ) {
        matches.push({
          severity: parsed.severity ?? "unknown",
          title: parsed.title ?? "",
          componentId,
        });
      }
    } catch {
      // Not a JSON log line (e.g. a raw stack trace) — not what we're looking for, skip it.
    }
  }
  return matches;
}
