import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { ComponentType, Severity, WorkItemStatus, type WorkItem } from "@prisma/client";
import { IncidentEventPublisher } from "../../../src/services/realtime/eventPublisher.js";
import { IncidentEventSubscriber } from "../../../src/services/realtime/eventSubscriber.js";
import type { IncidentEvent } from "../../../src/services/realtime/incidentEvents.js";
import { TEST_REDIS_URL } from "../testEnv.js";

const publishRedis = new Redis(TEST_REDIS_URL);
const noopLogger = { info: (): void => {}, error: (): void => {} };
const activeSubscribers: IncidentEventSubscriber[] = [];

afterEach(async () => {
  await Promise.all(activeSubscribers.map((s) => s.stop()));
  activeSubscribers.length = 0;
});

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  const now = new Date();
  return {
    id: randomUUID(),
    componentId: "CACHE_CLUSTER_01",
    componentType: ComponentType.CACHE,
    severity: Severity.P2,
    state: WorkItemStatus.OPEN,
    title: "test incident",
    firstSignalAt: now,
    resolvedAt: null,
    closedAt: null,
    signalCount: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function newSubscriber(): IncidentEventSubscriber {
  const subscriber = new IncidentEventSubscriber(TEST_REDIS_URL, noopLogger);
  activeSubscribers.push(subscriber);
  return subscriber;
}

function waitForEvent(subscriber: IncidentEventSubscriber, timeoutMs = 2000): Promise<IncidentEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for incident event")), timeoutMs);
    const unsubscribe = subscriber.subscribe((event) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(event);
    });
  });
}

describe("incident event bus (Redis pub/sub)", () => {
  it("delivers a published event to a subscriber over real Redis", async () => {
    const subscriber = newSubscriber();
    await subscriber.start();
    const publisher = new IncidentEventPublisher(publishRedis, noopLogger);

    const workItem = makeWorkItem();
    const received = waitForEvent(subscriber);
    await publisher.publishWorkItemCreated(workItem);

    const event = await received;
    expect(event.type).toBe("work_item_created");
    expect(event.incident.id).toBe(workItem.id);
  });

  it("fans out one publish to multiple listeners on the same subscriber (multiple SSE connections, one process)", async () => {
    const subscriber = newSubscriber();
    await subscriber.start();
    const publisher = new IncidentEventPublisher(publishRedis, noopLogger);

    const workItem = makeWorkItem();
    const [eventA, eventB] = await Promise.all([
      waitForEvent(subscriber),
      waitForEvent(subscriber),
      publisher.publishWorkItemCreated(workItem),
    ]);

    expect(eventA.incident.id).toBe(workItem.id);
    expect(eventB.incident.id).toBe(workItem.id);
  });

  it("delivers to independent subscribers sharing one Redis — simulates cross-replica delivery", async () => {
    const replicaASubscriber = newSubscriber();
    const replicaBSubscriber = newSubscriber();
    await Promise.all([replicaASubscriber.start(), replicaBSubscriber.start()]);
    // Simulates the mutation being handled by a third replica, distinct
    // from either subscriber — proves delivery doesn't depend on the
    // publisher and a subscriber being the same process.
    const publisher = new IncidentEventPublisher(publishRedis, noopLogger);

    const workItem = makeWorkItem({ state: WorkItemStatus.INVESTIGATING });
    const [eventOnA, eventOnB] = await Promise.all([
      waitForEvent(replicaASubscriber),
      waitForEvent(replicaBSubscriber),
      publisher.publishWorkItemStateChanged(workItem, "OPEN", "INVESTIGATING"),
    ]);

    expect(eventOnA).toMatchObject({ type: "work_item_state_changed", fromState: "OPEN", toState: "INVESTIGATING" });
    expect(eventOnB).toMatchObject({ type: "work_item_state_changed", fromState: "OPEN", toState: "INVESTIGATING" });
  });

  it("unsubscribe() stops delivery to that listener without affecting others", async () => {
    const subscriber = newSubscriber();
    await subscriber.start();
    const publisher = new IncidentEventPublisher(publishRedis, noopLogger);

    const calls: IncidentEvent[] = [];
    const unsubscribe = subscriber.subscribe((event) => calls.push(event));
    unsubscribe();

    const stillListening = waitForEvent(subscriber);
    await publisher.publishWorkItemCreated(makeWorkItem());
    await stillListening;

    expect(calls).toHaveLength(0);
  });
});
