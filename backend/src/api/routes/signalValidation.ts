import { ComponentType, Severity } from "@prisma/client";
import { z } from "zod";

// signalId is optional: most producers won't have one, and the ingestion
// route (signals.ts) assigns one at receipt time if absent. It's accepted
// when supplied so a source system's own event ID can be preserved as the
// canonical signalId for downstream idempotency/dedup.
export const signalInputSchema = z.object({
  signalId: z.string().min(1).max(200).optional(),
  componentId: z.string().min(1).max(200),
  componentType: z.nativeEnum(ComponentType),
  severity: z.nativeEnum(Severity),
  rawPayload: z.unknown(),
  occurredAt: z.coerce.date(),
});

export type SignalInput = z.infer<typeof signalInputSchema>;

export interface ValidationFieldError {
  readonly field: string;
  readonly message: string;
}

export type SignalBatchParseResult =
  | { readonly ok: true; readonly signals: readonly SignalInput[] }
  | { readonly ok: false; readonly reason: "empty_batch" | "batch_too_large"; readonly message: string }
  | { readonly ok: false; readonly reason: "validation_failed"; readonly errors: readonly ValidationFieldError[] };

/**
 * Accepts either a single signal object or a JSON array of them (the POST
 * body may be either), enforces the batch size cap before doing any
 * per-item validation work, then validates every item and reports
 * field-level errors annotated with the item's index in the batch.
 */
export function parseSignalBatch(body: unknown, maxBatchSize: number): SignalBatchParseResult {
  const items: unknown[] = Array.isArray(body) ? body : [body];

  if (items.length === 0) {
    return { ok: false, reason: "empty_batch", message: "batch must contain at least one signal" };
  }

  if (items.length > maxBatchSize) {
    return {
      ok: false,
      reason: "batch_too_large",
      message: `batch of ${items.length} exceeds maximum size of ${maxBatchSize}`,
    };
  }

  const errors: ValidationFieldError[] = [];
  const signals: SignalInput[] = [];
  const isBatch = Array.isArray(body);

  items.forEach((item, index) => {
    const result = signalInputSchema.safeParse(item);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const path = issue.path.join(".") || "(root)";
        errors.push({ field: isBatch ? `[${index}].${path}` : path, message: issue.message });
      }
      return;
    }
    signals.push(result.data);
  });

  if (errors.length > 0) {
    return { ok: false, reason: "validation_failed", errors };
  }

  return { ok: true, signals };
}
