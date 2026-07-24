import { Router, type Request, type Response } from "express";
import { signalBuffer } from "../../services/ingestion/signalBufferInstance.js";
import { getWorkerRuntimeRefs } from "../../services/observability/runtimeRefs.js";

export interface ReadyResponseBody {
  readonly ready: boolean;
  readonly checks: {
    readonly bufferDraining: boolean;
    readonly workerRunning: boolean;
  };
}

/**
 * Liveness (GET /health) vs readiness (GET /ready) — deliberately
 * different questions:
 *
 *  - /health answers "is this process alive and can it reach its
 *    dependencies." A liveness probe failing is the signal an
 *    orchestrator uses to decide "kill and restart this instance" — it
 *    should stay green through normal startup as long as the process
 *    itself hasn't wedged, even before it's doing any real work yet.
 *
 *  - /ready answers "should traffic actually be routed to this instance
 *    right now." During startup, dependencies can be reachable (so
 *    /health is already 200) before the buffer's drain loop and the
 *    BullMQ worker have actually started consuming — routing ingestion
 *    traffic in that window would accept signals nothing is yet
 *    processing. A readiness probe failing tells a load balancer to hold
 *    traffic without restarting anything; the instance isn't broken, it's
 *    just not finished starting (or has been deliberately paused).
 *
 * Both checks here are synchronous, in-memory reads (no I/O), same
 * "never block the request" posture as /health.
 */
function handleReadyCheck(res: Response<ReadyResponseBody>): void {
  const bufferDraining = signalBuffer.isDraining;
  const workerRunning = getWorkerRuntimeRefs()?.worker.isRunning() ?? false;
  const ready = bufferDraining && workerRunning;

  res.status(ready ? 200 : 503).json({ ready, checks: { bufferDraining, workerRunning } });
}

export const readyRouter = Router();

readyRouter.get("/", (_req: Request, res: Response<ReadyResponseBody>): void => {
  handleReadyCheck(res);
});
