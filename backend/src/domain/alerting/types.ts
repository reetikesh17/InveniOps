// Loose union, not closed: real callers get autocomplete for the known
// values (mirrors prisma/schema.prisma's ComponentType), but nothing in
// this module is structurally locked to them — registering a component
// type the schema doesn't even have yet is a valid, supported thing to
// do (see registry.ts).
// `string & {}` is the standard TS idiom for "autocomplete these literals,
// but accept any string" — a bare `string` in the union would collapse the
// literals and lose the autocomplete entirely. Not the "empty object"
// footgun the ban-types rule normally warns about.
// eslint-disable-next-line @typescript-eslint/ban-types
export type ComponentType = "API" | "MCP_HOST" | "CACHE" | "QUEUE" | "RDBMS" | "NOSQL" | (string & {});

export type Severity = "P0" | "P1" | "P2" | "P3";

export type NotificationChannel = "pagerduty" | "slack" | "email";

export interface AlertContext {
  readonly componentId: string;
  readonly componentType: ComponentType;
  /** What the triggering signal itself claimed — see severity.ts for how this gets reconciled against a strategy's floor. */
  readonly reportedSeverity: Severity;
  readonly signalCount: number;
  readonly firstSignalAt: Date;
}

export interface EscalationPolicy {
  readonly acknowledgeWithinMs: number;
  readonly escalateTo: NotificationChannel;
}

export interface Alert {
  /** Reconciled — see severity.ts. Never the raw context.reportedSeverity unmodified unless they happen to agree. */
  readonly severity: Severity;
  readonly channels: readonly NotificationChannel[];
  readonly escalation: EscalationPolicy;
  readonly title: string;
  readonly body: string;
}

/**
 * One implementation per component type. Owns severity-floor policy,
 * notification channels, and how to render an alert — nothing outside a
 * strategy class decides any of that for it. Pure: buildAlert must not
 * perform I/O, and nothing here imports from services/ or repositories/.
 */
export interface AlertStrategy {
  readonly componentType: string;
  readonly severityFloor: Severity;
  buildAlert(context: AlertContext): Alert;
}
