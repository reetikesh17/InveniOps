// Read-only log access — verifies the alerting Strategy dispatched exactly
// one alert per work item CREATION (see src/workers/processBatch.ts's own
// comment: alert dispatch fires once per work item created, never per
// signal), which is only observable in the dispatched alert's log line
// (src/services/alerting/notifiers/console.ts), not in any persisted row.
// Same posture as tests/chaos/helpers/docker.ts, kept as its own (much
// smaller — nothing here disrupts a container) copy.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface AlertLogLine {
  readonly severity: string;
  readonly title: string;
  readonly componentId: string;
  readonly msg: string;
}

/**
 * Every alert the ConsoleNotifier sends is a pino JSON line with
 * `msg: "ALERT [<severity>] <title>"` and structured `severity` /
 * `componentId` fields — parsed as JSON, not regexed out of the message
 * text, since the structured fields are the actual contract.
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
    if (!line.includes(`"componentId":"${componentId}"`) || !line.includes('"msg":"ALERT [')) {
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
          msg: parsed.msg,
        });
      }
    } catch {
      // Not a JSON log line (e.g. a raw stack trace) — skip it.
    }
  }
  return matches;
}
