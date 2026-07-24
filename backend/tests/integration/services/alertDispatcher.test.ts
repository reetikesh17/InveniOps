import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { ComponentType, Severity, WorkItemStatus, type WorkItem } from "@prisma/client";
import { createDefaultAlertStrategyRegistry } from "../../../src/domain/alerting/index.js";
import { NotifierRegistry } from "../../../src/services/alerting/notifierRegistry.js";
import { InMemoryNotifier } from "../../../src/services/alerting/notifiers/inMemory.js";
import { ConsoleNotifier } from "../../../src/services/alerting/notifiers/console.js";
import { AlertDispatcher, type AlertDispatcherOptions } from "../../../src/services/alerting/dispatcher.js";
import { createAlertMetricsRecorder } from "../../../src/utils/metrics.js";
import { TEST_REDIS_URL } from "../testEnv.js";

const redis = new Redis(TEST_REDIS_URL);
const noopLogger = { info: (): void => {}, warn: (): void => {}, error: (): void => {} };

afterAll(async () => {
  await redis.quit();
});

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  const now = new Date();
  return {
    id: randomUUID(),
    componentId: `COMPONENT_${randomUUID()}`,
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

interface Channels {
  readonly registry: NotifierRegistry;
  readonly slack: InMemoryNotifier;
  readonly pagerduty: InMemoryNotifier;
  readonly email: InMemoryNotifier;
}

function buildChannels(shouldFail: (name: string) => boolean = () => false): Channels {
  const slack = new InMemoryNotifier("slack", () => shouldFail("slack"));
  const pagerduty = new InMemoryNotifier("pagerduty", () => shouldFail("pagerduty"));
  const email = new InMemoryNotifier("email", () => shouldFail("email"));
  const registry = new NotifierRegistry(new ConsoleNotifier(noopLogger));
  registry.register("slack", slack);
  registry.register("pagerduty", pagerduty);
  registry.register("email", email);
  return { registry, slack, pagerduty, email };
}

const DEFAULT_OPTIONS: AlertDispatcherOptions = { maxAttempts: 2, backoffDelayMs: 5, suppressionWindowSeconds: 60 };

function buildDispatcher(channels: Channels, options: AlertDispatcherOptions = DEFAULT_OPTIONS): AlertDispatcher {
  return new AlertDispatcher(
    createDefaultAlertStrategyRegistry(),
    channels.registry,
    redis,
    options,
    createAlertMetricsRecorder(),
    noopLogger,
  );
}

describe("AlertDispatcher", () => {
  it("sends exactly one alert per work item creation, regardless of how many times dispatch is invoked for it", async () => {
    const channels = buildChannels();
    const dispatcher = buildDispatcher(channels);
    const workItem = makeWorkItem({ componentType: ComponentType.CACHE });

    // Simulates a batch resolving `created: true` for the same work item
    // more than once (shouldn't happen in practice, but the guarantee is
    // Redis's, not the caller's discipline).
    await Promise.all(Array.from({ length: 20 }, () => dispatcher.dispatch(workItem, "created")));

    expect(channels.slack.sent).toHaveLength(1);
  });

  it("routes to the correct channels per component type", async () => {
    const cases: ReadonlyArray<{ componentType: ComponentType; expectSlack: boolean; expectPagerduty: boolean; expectEmail: boolean }> = [
      { componentType: ComponentType.RDBMS, expectSlack: true, expectPagerduty: true, expectEmail: false },
      { componentType: ComponentType.NOSQL, expectSlack: true, expectPagerduty: true, expectEmail: false },
      { componentType: ComponentType.CACHE, expectSlack: true, expectPagerduty: false, expectEmail: false },
      { componentType: ComponentType.API, expectSlack: true, expectPagerduty: true, expectEmail: false },
      { componentType: ComponentType.MCP_HOST, expectSlack: true, expectPagerduty: false, expectEmail: true },
      { componentType: ComponentType.QUEUE, expectSlack: true, expectPagerduty: false, expectEmail: false },
    ];

    for (const testCase of cases) {
      const channels = buildChannels();
      const dispatcher = buildDispatcher(channels);
      const workItem = makeWorkItem({ componentType: testCase.componentType });

      await dispatcher.dispatch(workItem, "created");

      expect(channels.slack.sent.length > 0).toBe(testCase.expectSlack);
      expect(channels.pagerduty.sent.length > 0).toBe(testCase.expectPagerduty);
      expect(channels.email.sent.length > 0).toBe(testCase.expectEmail);
    }
  });

  it("a failing channel does not affect the others or reject the dispatch call", async () => {
    const channels = buildChannels((name) => name === "slack");
    const dispatcher = buildDispatcher(channels);
    const workItem = makeWorkItem({ componentType: ComponentType.API }); // channels: pagerduty, slack

    await expect(dispatcher.dispatch(workItem, "created")).resolves.toBeUndefined();

    expect(channels.pagerduty.sent).toHaveLength(1);
    expect(channels.slack.sent).toHaveLength(0); // failed every attempt, never recorded a success
  });

  it("console always receives the alert, even when every configured channel is disabled", async () => {
    const sentToConsole: string[] = [];
    const registry = new NotifierRegistry(
      new ConsoleNotifier({
        info: (_obj: unknown, msg: string): void => {
          sentToConsole.push(msg);
        },
        warn: (): void => {},
        error: (): void => {},
      }),
    );
    const dispatcher = new AlertDispatcher(
      createDefaultAlertStrategyRegistry(),
      registry,
      redis,
      DEFAULT_OPTIONS,
      createAlertMetricsRecorder(),
      noopLogger,
    );

    await dispatcher.dispatch(makeWorkItem(), "created");

    expect(sentToConsole).toHaveLength(1);
  });

  it("produces a distinct message per transition type, not the same text repeated", async () => {
    const channels = buildChannels();
    const dispatcher = buildDispatcher(channels);
    const workItem = makeWorkItem({ componentType: ComponentType.CACHE });

    await dispatcher.dispatch(workItem, "created");
    await dispatcher.dispatch(workItem, "INVESTIGATING");
    await dispatcher.dispatch(workItem, "RESOLVED");
    await dispatcher.dispatch(workItem, "CLOSED");

    const titles = channels.slack.sent.map((delivery) => delivery.alert.title);
    expect(new Set(titles).size).toBe(4);
  });

  it("suppression prevents duplicate delivery across simulated replicas sharing the same Redis", async () => {
    const channels = buildChannels();
    const replicaA = buildDispatcher(channels);
    const replicaB = buildDispatcher(channels);
    const workItem = makeWorkItem({ componentType: ComponentType.CACHE });

    await Promise.all([
      ...Array.from({ length: 10 }, () => replicaA.dispatch(workItem, "created")),
      ...Array.from({ length: 10 }, () => replicaB.dispatch(workItem, "created")),
    ]);

    expect(channels.slack.sent).toHaveLength(1);
  });

  describe("dispatchEscalation", () => {
    it("escalates at most once — a second call for the same work item is a no-op", async () => {
      const channels = buildChannels();
      const dispatcher = buildDispatcher(channels);
      const workItem = makeWorkItem({ componentType: ComponentType.RDBMS }); // floor P0 -> escalateTo pagerduty

      const first = await dispatcher.dispatchEscalation(workItem);
      const second = await dispatcher.dispatchEscalation(workItem);

      expect(first).toBe(true);
      expect(second).toBe(false);
      expect(channels.pagerduty.sent).toHaveLength(1);
    });

    it("targets only the severity's escalation channel, not the strategy's full channel list", async () => {
      const channels = buildChannels();
      const dispatcher = buildDispatcher(channels);
      // API's normal channels are [pagerduty, slack]; P1's escalation channel is slack only.
      const workItem = makeWorkItem({ componentType: ComponentType.API, severity: Severity.P1 });

      await dispatcher.dispatchEscalation(workItem);

      expect(channels.slack.sent).toHaveLength(1);
      expect(channels.pagerduty.sent).toHaveLength(0);
    });
  });
});
