import { describe, expect, it, vi } from "vitest";
import { createNotifierRegistry } from "../../../../src/services/alerting/notifierRegistry.js";
import { WebhookNotifier } from "../../../../src/services/alerting/notifiers/webhook.js";
import { SlackNotifier } from "../../../../src/services/alerting/notifiers/slack.js";

function fakeLogger(): { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("createNotifierRegistry", () => {
  it("never throws when no channel config is set — boots with only console available", () => {
    const logger = fakeLogger();

    expect(() =>
      createNotifierRegistry(
        {
          slackWebhookUrl: undefined,
          pagerdutyWebhookUrl: undefined,
          emailWebhookUrl: undefined,
          channelTimeoutMs: 1000,
        },
        logger,
      ),
    ).not.toThrow();

    const registry = createNotifierRegistry(
      { slackWebhookUrl: undefined, pagerdutyWebhookUrl: undefined, emailWebhookUrl: undefined, channelTimeoutMs: 1000 },
      logger,
    );

    expect(registry.console).toBeDefined();
    expect(registry.resolve("slack")).toBeUndefined();
    expect(registry.resolve("pagerduty")).toBeUndefined();
    expect(registry.resolve("email")).toBeUndefined();
  });

  it("logs a startup warning (not an error, not a throw) for each unconfigured channel", () => {
    const logger = fakeLogger();
    createNotifierRegistry(
      { slackWebhookUrl: undefined, pagerdutyWebhookUrl: undefined, emailWebhookUrl: undefined, channelTimeoutMs: 1000 },
      logger,
    );

    expect(logger.warn).toHaveBeenCalledTimes(3);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("registers a channel once its URL is configured, and only that one", () => {
    const logger = fakeLogger();
    const registry = createNotifierRegistry(
      {
        slackWebhookUrl: "https://hooks.slack.test/x",
        pagerdutyWebhookUrl: undefined,
        emailWebhookUrl: undefined,
        channelTimeoutMs: 1000,
      },
      logger,
    );

    expect(registry.resolve("slack")).toBeInstanceOf(SlackNotifier);
    expect(registry.resolve("pagerduty")).toBeUndefined();
    expect(registry.resolve("email")).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(2); // pagerduty, email
  });

  it("registers all three channels when all three URLs are configured", () => {
    const registry = createNotifierRegistry(
      {
        slackWebhookUrl: "https://hooks.slack.test/x",
        pagerdutyWebhookUrl: "https://events.pagerduty.test/x",
        emailWebhookUrl: "https://email-gateway.test/x",
        channelTimeoutMs: 1000,
      },
      fakeLogger(),
    );

    expect(registry.resolve("slack")).toBeInstanceOf(SlackNotifier);
    expect(registry.resolve("pagerduty")).toBeInstanceOf(WebhookNotifier);
    expect(registry.resolve("email")).toBeInstanceOf(WebhookNotifier);
  });
});
