import { EventEmitter } from "node:events";
import { Redis } from "ioredis";
import type { Logger } from "pino";
import { INCIDENT_EVENTS_CHANNEL, isIncidentEvent, type IncidentEvent } from "./incidentEvents.js";

const EVENT_NAME = "incident-event";

/**
 * One dedicated Redis connection in subscribe mode for the whole process,
 * fanned out in-process to every open SSE connection via a plain
 * EventEmitter — a subscribe-mode ioredis connection can only issue
 * subscribe/unsubscribe/ping commands, so it can't be the shared
 * general-purpose `redis` client (same reasoning as workers/connection.ts's
 * dedicated BullMQ connection). This is what makes the stream work across
 * replicas: whichever replica actually handled the mutation publishes once,
 * and every replica's subscriber (each independently subscribed to the same
 * channel) receives it and fans it out to its own locally-connected clients.
 */
export class IncidentEventSubscriber {
  private readonly emitter = new EventEmitter();
  private connection: Redis | undefined;

  constructor(
    private readonly redisUrl: string,
    private readonly logger?: Pick<Logger, "info" | "error">,
  ) {
    // Fan-out to every concurrently-open SSE connection, not a fixed small
    // number of listeners — EventEmitter's default max-listener warning
    // exists to catch accidental leaks, not this legitimate high-fanout use.
    this.emitter.setMaxListeners(0);
  }

  async start(): Promise<void> {
    if (this.connection) {
      return;
    }
    const connection = new Redis(this.redisUrl, { lazyConnect: true });
    connection.on("message", (_channel: string, message: string) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(message);
      } catch (error) {
        this.logger?.error({ error }, "incident event message was not valid JSON — dropped");
        return;
      }
      if (!isIncidentEvent(parsed)) {
        this.logger?.error({ parsed }, "incident event message had an unrecognized shape — dropped");
        return;
      }
      this.emitter.emit(EVENT_NAME, parsed);
    });
    await connection.connect();
    await connection.subscribe(INCIDENT_EVENTS_CHANNEL);
    this.connection = connection;
    this.logger?.info({ channel: INCIDENT_EVENTS_CHANNEL }, "subscribed to incident events");
  }

  async stop(): Promise<void> {
    this.emitter.removeAllListeners(EVENT_NAME);
    await this.connection?.quit();
    this.connection = undefined;
  }

  /** Returns an unsubscribe function — call it on SSE connection close. */
  subscribe(listener: (event: IncidentEvent) => void): () => void {
    this.emitter.on(EVENT_NAME, listener);
    return () => this.emitter.off(EVENT_NAME, listener);
  }
}
