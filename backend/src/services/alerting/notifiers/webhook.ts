import type { Alert, AlertContext } from "../../../domain/alerting/index.js";
import { NotifierDeliveryError, type Notifier } from "./types.js";

export type WebhookPayloadBuilder = (alert: Alert, context: AlertContext) => unknown;

export interface WebhookNotifierOptions {
  readonly url: string;
  readonly timeoutMs: number;
  readonly buildPayload?: WebhookPayloadBuilder;
}

function defaultPayload(alert: Alert, context: AlertContext): unknown {
  return {
    severity: alert.severity,
    title: alert.title,
    body: alert.body,
    componentId: context.componentId,
    componentType: context.componentType,
    channels: alert.channels,
  };
}

/**
 * POST with an AbortController-driven timeout — a hanging endpoint fails
 * fast (as a thrown NotifierDeliveryError) rather than stalling whatever
 * called it indefinitely. Shared by WebhookNotifier and SlackNotifier,
 * which differ only in payload shape.
 */
export async function postJson(notifierName: string, url: string, payload: unknown, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new NotifierDeliveryError(notifierName, `webhook responded with HTTP ${response.status}`);
    }
  } catch (error) {
    if (error instanceof NotifierDeliveryError) {
      throw error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new NotifierDeliveryError(notifierName, `request failed: ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generic HTTP POST notifier — configurable URL, no vendor-specific
 * payload shape. Used directly for the pagerduty and email channels
 * (neither has a dedicated client here; both are "some endpoint that
 * accepts a JSON POST").
 */
export class WebhookNotifier implements Notifier {
  constructor(
    readonly name: string,
    private readonly options: WebhookNotifierOptions,
  ) {}

  async send(alert: Alert, context: AlertContext): Promise<void> {
    const payload = (this.options.buildPayload ?? defaultPayload)(alert, context);
    await postJson(this.name, this.options.url, payload, this.options.timeoutMs);
  }
}
