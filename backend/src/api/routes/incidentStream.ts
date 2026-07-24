import { Router, type Request, type Response } from "express";
import { config } from "../../config/index.js";
import { incidentEventSubscriber } from "../../services/realtime/realtimeInstance.js";
import type { IncidentEvent } from "../../services/realtime/incidentEvents.js";

function writeEvent(res: Response, event: IncidentEvent): void {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * One long-lived HTTP response per connected client, held open until the
 * client disconnects. Backed by incidentEventSubscriber (see
 * services/realtime/eventSubscriber.ts) — a single process-wide Redis
 * subscription fanned out to every connection here, not one Redis
 * SUBSCRIBE per client. Cross-replica delivery (an event published by
 * whichever replica handled the mutation) comes from that subscriber's own
 * design, not from anything in this handler.
 */
function handleStream(req: Request, res: Response): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Disables response buffering on nginx-family reverse proxies, which
    // would otherwise hold the first chunk until enough data accumulates —
    // defeating the point of a push channel. A no-op, not a risk, for any
    // proxy that doesn't recognize the header.
    "X-Accel-Buffering": "no",
  });

  // A comment line — SSE comments (lines starting with `:`) are never
  // dispatched as an event by EventSource, so this only confirms the
  // connection is open and flushes the response headers through any
  // buffering proxy immediately, rather than waiting for the first real
  // event (which, for a quiet system, could be minutes away).
  res.write(": connected\n\n");

  const unsubscribe = incidentEventSubscriber.subscribe((event) => {
    writeEvent(res, event);
  });

  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, config.sse.heartbeatIntervalMs);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

export const incidentStreamRouter = Router();

incidentStreamRouter.get("/stream", (req: Request, res: Response): void => {
  handleStream(req, res);
});
