import { Severity } from "@prisma/client";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { SignalBuffer, noopSignalSink } from "./buffer.js";

// The process-wide, config-wired instance. Deliberately split out of
// buffer.ts, which stays free of any import of config/index.ts or
// utils/logger.ts so SignalBuffer itself is unit-testable with zero
// environment setup — only infra bootstrap code (index.ts, health.ts,
// signals.ts) should import from this file.
export const signalBuffer: SignalBuffer = new SignalBuffer({
  capacity: config.buffer.capacity,
  highWaterMarkFraction: config.buffer.highWaterMarkFraction,
  lowWaterMarkFraction: config.buffer.lowWaterMarkFraction,
  shedCeilingFractions: {
    [Severity.P1]: config.buffer.shedCeilingFractions.p1,
    [Severity.P2]: config.buffer.shedCeilingFractions.p2,
    [Severity.P3]: config.buffer.shedCeilingFractions.p3,
  },
  drainBatchSize: config.buffer.drainBatchSize,
  drainIntervalMs: config.buffer.drainIntervalMs,
  sink: noopSignalSink,
  logger,
});
