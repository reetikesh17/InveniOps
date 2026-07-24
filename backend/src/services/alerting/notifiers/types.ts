import type { Alert, AlertContext } from "../../../domain/alerting/index.js";

/**
 * One implementation per delivery mechanism. send() throws on any failure
 * (bad status, network error, timeout) — it never returns a "failed"
 * result silently — so the existing retry() wrapper (src/utils/retry.ts)
 * composes directly at the dispatcher, with zero adaptation.
 */
export interface Notifier {
  readonly name: string;
  send(alert: Alert, context: AlertContext): Promise<void>;
}

export class NotifierDeliveryError extends Error {
  constructor(notifierName: string, message: string) {
    super(`${notifierName}: ${message}`);
    this.name = "NotifierDeliveryError";
  }
}
