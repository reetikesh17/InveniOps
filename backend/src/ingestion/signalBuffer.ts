import type { ComponentType, Severity } from "@prisma/client";

// The normalized shape a validated signal takes once it leaves the API
// layer, before it's actually buffered. Distinct from
// repositories/mongo/signalRepository.ts's SignalDocument — that's the
// persistence shape written by the (not-yet-built) buffer flush, and the
// two will be reconciled when that flush is implemented.
export interface IngestionSignal {
  readonly signalId: string;
  readonly componentId: string;
  readonly componentType: ComponentType;
  readonly severity: Severity;
  readonly rawPayload: unknown;
  readonly occurredAt: Date;
  readonly receivedAt: Date;
}

export type BufferResult =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: "buffer_saturated" };

/**
 * TODO(next prompt): back this with a real bounded in-memory buffer that
 * flushes to Mongo and feeds the debouncer on a timer/size threshold, and
 * sheds load (accepted: false) once saturated so ingestion never blocks on
 * a slow persistence layer. For now every signal is accepted unconditionally
 * — nothing is actually buffered, debounced, or persisted yet.
 */
export function bufferSignal(signal: IngestionSignal): BufferResult {
  void signal;
  return { accepted: true };
}
