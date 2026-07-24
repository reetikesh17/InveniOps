import type { Logger } from "pino";
import type { NotificationChannel } from "../../domain/alerting/index.js";
import type { Notifier } from "./notifiers/types.js";
import { ConsoleNotifier } from "./notifiers/console.js";
import { WebhookNotifier } from "./notifiers/webhook.js";
import { SlackNotifier } from "./notifiers/slack.js";

export interface NotifierRegistryConfig {
  readonly slackWebhookUrl: string | undefined;
  readonly pagerdutyWebhookUrl: string | undefined;
  readonly emailWebhookUrl: string | undefined;
  readonly channelTimeoutMs: number;
}

/**
 * Maps a logical NotificationChannel ("pagerduty" | "slack" | "email") to
 * a configured Notifier instance. console is unconditional and separate
 * from this map — see ConsoleNotifier's own comment.
 */
export class NotifierRegistry {
  private readonly channelNotifiers = new Map<NotificationChannel, Notifier>();

  constructor(readonly console: ConsoleNotifier) {}

  register(channel: NotificationChannel, notifier: Notifier): void {
    this.channelNotifiers.set(channel, notifier);
  }

  /** Undefined means the channel has no configured notifier — disabled, already warned about at startup. Callers skip it, never treat it as a failure. */
  resolve(channel: NotificationChannel): Notifier | undefined {
    return this.channelNotifiers.get(channel);
  }
}

/**
 * Builds the registry from env config. A channel whose URL isn't set is
 * simply never registered — resolve() returns undefined for it and the
 * dispatcher skips it. Logged once here as a startup warning; this never
 * throws, so a bare checkout with zero alerting credentials still boots.
 */
export function createNotifierRegistry(
  config: NotifierRegistryConfig,
  logger: Pick<Logger, "info" | "warn" | "error">,
): NotifierRegistry {
  const registry = new NotifierRegistry(new ConsoleNotifier(logger));

  if (config.slackWebhookUrl) {
    registry.register(
      "slack",
      new SlackNotifier({ url: config.slackWebhookUrl, timeoutMs: config.channelTimeoutMs }),
    );
  } else {
    logger.warn({ channel: "slack" }, "ALERT_SLACK_WEBHOOK_URL not configured — slack alert channel disabled");
  }

  if (config.pagerdutyWebhookUrl) {
    registry.register(
      "pagerduty",
      new WebhookNotifier("pagerduty", { url: config.pagerdutyWebhookUrl, timeoutMs: config.channelTimeoutMs }),
    );
  } else {
    logger.warn(
      { channel: "pagerduty" },
      "ALERT_PAGERDUTY_WEBHOOK_URL not configured — pagerduty alert channel disabled",
    );
  }

  if (config.emailWebhookUrl) {
    registry.register(
      "email",
      new WebhookNotifier("email", { url: config.emailWebhookUrl, timeoutMs: config.channelTimeoutMs }),
    );
  } else {
    logger.warn({ channel: "email" }, "ALERT_EMAIL_WEBHOOK_URL not configured — email alert channel disabled");
  }

  return registry;
}
