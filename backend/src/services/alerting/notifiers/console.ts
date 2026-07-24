import type { Logger } from "pino";
import type { Alert, AlertContext } from "../../../domain/alerting/index.js";
import type { Notifier } from "./types.js";

/**
 * Always on — no config, never disabled by createNotifierRegistry. Every
 * alert this system fires is guaranteed to be visible somewhere even with
 * zero external integrations configured (a fresh local checkout with no
 * Slack/PagerDuty credentials still shows every alert in the logs).
 */
export class ConsoleNotifier implements Notifier {
  readonly name = "console";

  constructor(private readonly logger: Pick<Logger, "info" | "warn" | "error">) {}

  send(alert: Alert, context: AlertContext): Promise<void> {
    this.logger.info(
      { severity: alert.severity, title: alert.title, body: alert.body, componentId: context.componentId },
      `ALERT [${alert.severity}] ${alert.title}`,
    );
    return Promise.resolve();
  }
}
