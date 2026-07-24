import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient, ComponentType, Severity, WorkItemStatus } from "@prisma/client";
import { Redis } from "ioredis";
import { PostgresWorkItemRepository } from "../../../src/repositories/postgres/workItemRepository.js";
import { createDefaultAlertStrategyRegistry, getEscalationPolicy } from "../../../src/domain/alerting/index.js";
import { NotifierRegistry } from "../../../src/services/alerting/notifierRegistry.js";
import { InMemoryNotifier } from "../../../src/services/alerting/notifiers/inMemory.js";
import { ConsoleNotifier } from "../../../src/services/alerting/notifiers/console.js";
import { AlertDispatcher } from "../../../src/services/alerting/dispatcher.js";
import { EscalationScheduler } from "../../../src/services/alerting/escalationScheduler.js";
import { TEST_DATABASE_URL, TEST_REDIS_URL } from "../testEnv.js";

const COMPONENT_PREFIX = "ESCALATION_TEST_";
const noopLogger = { info: (): void => {}, warn: (): void => {}, error: (): void => {} };

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const redis = new Redis(TEST_REDIS_URL);
const workItemStore = new PostgresWorkItemRepository(prisma);

afterAll(async () => {
  await prisma.stateTransition.deleteMany({ where: { workItem: { componentId: { startsWith: COMPONENT_PREFIX } } } });
  await prisma.workItem.deleteMany({ where: { componentId: { startsWith: COMPONENT_PREFIX } } });
  await prisma.$disconnect();
  await redis.quit();
});

function freshComponentId(label: string): string {
  return `${COMPONENT_PREFIX}${label}_${randomUUID()}`;
}

interface Harness {
  readonly scheduler: EscalationScheduler;
  readonly pagerduty: InMemoryNotifier;
  readonly email: InMemoryNotifier;
}

function buildHarness(): Harness {
  const pagerduty = new InMemoryNotifier("pagerduty");
  const email = new InMemoryNotifier("email");
  const notifierRegistry = new NotifierRegistry(new ConsoleNotifier(noopLogger));
  notifierRegistry.register("pagerduty", pagerduty);
  notifierRegistry.register("email", email);

  const strategyRegistry = createDefaultAlertStrategyRegistry();
  const dispatcher = new AlertDispatcher(
    strategyRegistry,
    notifierRegistry,
    redis,
    { maxAttempts: 1, backoffDelayMs: 5, suppressionWindowSeconds: 60 },
    undefined,
    noopLogger,
  );
  const scheduler = new EscalationScheduler(workItemStore, strategyRegistry, dispatcher, { checkIntervalMs: 60_000 }, noopLogger);

  return { scheduler, pagerduty, email };
}

const P0_DELAY_MS = getEscalationPolicy("P0").acknowledgeWithinMs;

describe("EscalationScheduler", () => {
  it("escalates an OPEN work item once its severity's delay has passed, and records it on the audit trail", async () => {
    const { scheduler, pagerduty } = buildHarness();
    const created = await workItemStore.createWorkItem({
      componentId: freshComponentId("overdue"),
      componentType: ComponentType.RDBMS, // floor P0 -> escalateTo pagerduty
      severity: Severity.P2,
      title: "test",
      firstSignalAt: new Date(Date.now() - P0_DELAY_MS - 60_000),
    });

    await scheduler.tick();

    expect(pagerduty.sent).toHaveLength(1);

    const transitions = await prisma.stateTransition.findMany({ where: { workItemId: created.id } });
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      actor: "system:escalation",
      fromState: WorkItemStatus.OPEN,
      toState: WorkItemStatus.OPEN,
    });
  });

  it("escalates at most once — a second tick does not escalate again or double up the audit trail", async () => {
    const { scheduler, pagerduty } = buildHarness();
    const created = await workItemStore.createWorkItem({
      componentId: freshComponentId("once_only"),
      componentType: ComponentType.RDBMS,
      severity: Severity.P0,
      title: "test",
      firstSignalAt: new Date(Date.now() - P0_DELAY_MS - 60_000),
    });

    await scheduler.tick();
    await scheduler.tick();
    await scheduler.tick();

    expect(pagerduty.sent).toHaveLength(1);
    const transitions = await prisma.stateTransition.findMany({ where: { workItemId: created.id } });
    expect(transitions).toHaveLength(1);
  });

  it("does not escalate a work item that isn't overdue yet", async () => {
    const { scheduler, pagerduty } = buildHarness();
    await workItemStore.createWorkItem({
      componentId: freshComponentId("fresh"),
      componentType: ComponentType.RDBMS,
      severity: Severity.P0,
      title: "test",
      firstSignalAt: new Date(), // just created — nowhere near P0's delay
    });

    await scheduler.tick();

    expect(pagerduty.sent).toHaveLength(0);
  });

  it("stops escalating once the work item leaves OPEN", async () => {
    const { scheduler, pagerduty } = buildHarness();
    const created = await workItemStore.createWorkItem({
      componentId: freshComponentId("acknowledged"),
      componentType: ComponentType.RDBMS,
      severity: Severity.P0,
      title: "test",
      firstSignalAt: new Date(Date.now() - P0_DELAY_MS - 60_000),
    });

    await workItemStore.transitionState({
      workItemId: created.id,
      fromState: WorkItemStatus.OPEN,
      toState: WorkItemStatus.INVESTIGATING,
      actor: "alice",
    });

    await scheduler.tick();

    expect(pagerduty.sent).toHaveLength(0);
  });

  it("respects each work item's own (reconciled) severity delay, not just the widened candidate-query cutoff", async () => {
    const { scheduler, pagerduty, email } = buildHarness();
    // CACHE's floor is P2 (60-minute delay, escalates to email) — this is
    // past P0's much shorter delay (used only to widen the Postgres
    // candidate query) but nowhere near its own actual delay.
    await workItemStore.createWorkItem({
      componentId: freshComponentId("wrong_delay"),
      componentType: ComponentType.CACHE,
      severity: Severity.P2,
      title: "test",
      firstSignalAt: new Date(Date.now() - P0_DELAY_MS - 60_000),
    });

    await scheduler.tick();

    expect(pagerduty.sent).toHaveLength(0);
    expect(email.sent).toHaveLength(0);
  });
});
