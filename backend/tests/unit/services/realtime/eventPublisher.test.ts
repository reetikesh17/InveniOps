import { describe, expect, it, vi } from "vitest";
import { ComponentType, Severity, WorkItemStatus, type WorkItem } from "@prisma/client";
import { IncidentEventPublisher, type PublishableRedis } from "../../../../src/services/realtime/eventPublisher.js";
import { INCIDENT_EVENTS_CHANNEL, type IncidentEvent } from "../../../../src/services/realtime/incidentEvents.js";

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: "wi-1",
    componentId: "CACHE_CLUSTER_01",
    componentType: ComponentType.CACHE,
    severity: Severity.P2,
    state: WorkItemStatus.OPEN,
    title: "test incident",
    firstSignalAt: now,
    resolvedAt: null,
    closedAt: null,
    signalCount: 3,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

type PublishMock = ReturnType<typeof vi.fn<[channel: string, message: string], Promise<number>>>;

function fakeRedis(): { readonly redis: PublishableRedis; readonly publish: PublishMock } {
  const publish = vi.fn<[channel: string, message: string], Promise<number>>().mockResolvedValue(1);
  return { redis: { publish }, publish };
}

describe("IncidentEventPublisher", () => {
  it("publishWorkItemCreated: publishes a work_item_created event to the incident events channel", async () => {
    const { redis, publish } = fakeRedis();
    const publisher = new IncidentEventPublisher(redis);

    await publisher.publishWorkItemCreated(makeWorkItem());

    expect(publish).toHaveBeenCalledTimes(1);
    const [channel, message] = publish.mock.calls[0]!;
    expect(channel).toBe(INCIDENT_EVENTS_CHANNEL);
    const event = JSON.parse(message) as IncidentEvent;
    expect(event.type).toBe("work_item_created");
    expect(event.incident.id).toBe("wi-1");
    expect(event.incident.componentId).toBe("CACHE_CLUSTER_01");
  });

  it("publishWorkItemStateChanged: publishes a work_item_state_changed event with from/to state", async () => {
    const { redis, publish } = fakeRedis();
    const publisher = new IncidentEventPublisher(redis);

    await publisher.publishWorkItemStateChanged(makeWorkItem({ state: WorkItemStatus.INVESTIGATING }), "OPEN", "INVESTIGATING");

    const [, message] = publish.mock.calls[0]!;
    const event = JSON.parse(message) as IncidentEvent;
    expect(event.type).toBe("work_item_state_changed");
    if (event.type === "work_item_state_changed") {
      expect(event.fromState).toBe("OPEN");
      expect(event.toState).toBe("INVESTIGATING");
    }
  });

  it("never throws when the underlying Redis publish fails — logs and drops instead", async () => {
    const redis: PublishableRedis = { publish: vi.fn().mockRejectedValue(new Error("redis down")) };
    const errorLog = vi.fn();
    const publisher = new IncidentEventPublisher(redis, { error: errorLog });

    await expect(publisher.publishWorkItemCreated(makeWorkItem())).resolves.toBeUndefined();
    await expect(publisher.publishWorkItemStateChanged(makeWorkItem(), "OPEN", "CLOSED")).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalledTimes(2);
  });
});
