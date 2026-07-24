import type { Alert, AlertContext } from "../../../domain/alerting/index.js";
import { NotifierDeliveryError, type Notifier } from "./types.js";

export interface RecordedDelivery {
  readonly alert: Alert;
  readonly context: AlertContext;
}

/** Test double — records everything it was asked to send; shouldFail lets a test simulate one channel failing without touching the network. */
export class InMemoryNotifier implements Notifier {
  readonly sent: RecordedDelivery[] = [];

  constructor(
    readonly name: string = "in-memory",
    private readonly shouldFail: (alert: Alert, context: AlertContext) => boolean = () => false,
  ) {}

  send(alert: Alert, context: AlertContext): Promise<void> {
    if (this.shouldFail(alert, context)) {
      return Promise.reject(new NotifierDeliveryError(this.name, "simulated failure"));
    }
    this.sent.push({ alert, context });
    return Promise.resolve();
  }
}
