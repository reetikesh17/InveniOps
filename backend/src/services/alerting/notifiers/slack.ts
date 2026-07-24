import type { Alert, AlertContext } from "../../../domain/alerting/index.js";
import type { Notifier } from "./types.js";
import { postJson } from "./webhook.js";

export interface SlackNotifierOptions {
  readonly url: string;
  readonly timeoutMs: number;
}

/** Slack incoming-webhook payload shape ({text}) — distinct from WebhookNotifier's generic JSON envelope, sharing only the POST-with-timeout mechanics. */
export class SlackNotifier implements Notifier {
  readonly name = "slack";

  constructor(private readonly options: SlackNotifierOptions) {}

  async send(alert: Alert, context: AlertContext): Promise<void> {
    const payload = {
      text: `*[${alert.severity}] ${alert.title}*\n${alert.body}\n_Component: ${context.componentId} (${context.componentType})_`,
    };
    await postJson(this.name, this.options.url, payload, this.options.timeoutMs);
  }
}
