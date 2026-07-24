import { afterEach, describe, expect, it, vi } from "vitest";
import type { Alert, AlertContext } from "../../../../src/domain/alerting/index.js";
import { ConsoleNotifier } from "../../../../src/services/alerting/notifiers/console.js";
import { WebhookNotifier } from "../../../../src/services/alerting/notifiers/webhook.js";
import { SlackNotifier } from "../../../../src/services/alerting/notifiers/slack.js";
import { InMemoryNotifier } from "../../../../src/services/alerting/notifiers/inMemory.js";
import { NotifierDeliveryError } from "../../../../src/services/alerting/notifiers/types.js";

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    severity: "P1",
    channels: ["slack"],
    escalation: { acknowledgeWithinMs: 900_000, escalateTo: "slack" },
    title: "Test alert",
    body: "Test body",
    ...overrides,
  };
}

function makeContext(overrides: Partial<AlertContext> = {}): AlertContext {
  return {
    componentId: "comp-1",
    componentType: "CACHE",
    reportedSeverity: "P2",
    signalCount: 3,
    firstSignalAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("ConsoleNotifier", () => {
  it("logs and never throws", async () => {
    const info = vi.fn<(obj: unknown, message: string) => void>();
    const notifier = new ConsoleNotifier({ info, warn: vi.fn(), error: vi.fn() });

    await expect(notifier.send(makeAlert(), makeContext())).resolves.toBeUndefined();
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]?.[1]).toContain("Test alert");
  });
});

describe("WebhookNotifier", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves on a 2xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const notifier = new WebhookNotifier("pagerduty", { url: "https://example.test/hook", timeoutMs: 1000 });
    await expect(notifier.send(makeAlert(), makeContext())).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.test/hook");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body["severity"]).toBe("P1");
  });

  it("throws a NotifierDeliveryError on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));

    const notifier = new WebhookNotifier("pagerduty", { url: "https://example.test/hook", timeoutMs: 1000 });
    await expect(notifier.send(makeAlert(), makeContext())).rejects.toThrow(NotifierDeliveryError);
  });

  it("throws when the request errors (e.g. network failure)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const notifier = new WebhookNotifier("pagerduty", { url: "https://example.test/hook", timeoutMs: 1000 });
    await expect(notifier.send(makeAlert(), makeContext())).rejects.toThrow(NotifierDeliveryError);
  });

  it("aborts and throws once the timeout elapses, rather than hanging", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }),
    );

    const notifier = new WebhookNotifier("pagerduty", { url: "https://example.test/hook", timeoutMs: 20 });
    await expect(notifier.send(makeAlert(), makeContext())).rejects.toThrow(NotifierDeliveryError);
  });
});

describe("SlackNotifier", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts a Slack-compatible {text} payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const notifier = new SlackNotifier({ url: "https://hooks.slack.test/x", timeoutMs: 1000 });
    await notifier.send(makeAlert({ title: "RDBMS down" }), makeContext({ componentId: "RDBMS_01" }));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(typeof body["text"]).toBe("string");
    expect(body["text"]).toContain("RDBMS down");
    expect(body["text"]).toContain("RDBMS_01");
  });
});

describe("InMemoryNotifier", () => {
  it("records every delivery it accepts", async () => {
    const notifier = new InMemoryNotifier();
    const alert = makeAlert();
    const context = makeContext();

    await notifier.send(alert, context);

    expect(notifier.sent).toEqual([{ alert, context }]);
  });

  it("throws (and records nothing) when shouldFail returns true", async () => {
    const notifier = new InMemoryNotifier("in-memory", () => true);

    await expect(notifier.send(makeAlert(), makeContext())).rejects.toThrow(NotifierDeliveryError);
    expect(notifier.sent).toHaveLength(0);
  });
});
