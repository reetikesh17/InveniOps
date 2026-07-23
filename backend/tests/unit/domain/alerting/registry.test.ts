import { describe, expect, it } from "vitest";
import {
  AlertStrategyRegistry,
  createDefaultAlertStrategyRegistry,
} from "../../../../src/domain/alerting/registry.js";
import { DefaultAlertStrategy } from "../../../../src/domain/alerting/strategies/defaultStrategy.js";
import type { Alert, AlertContext, AlertStrategy, Severity } from "../../../../src/domain/alerting/types.js";
import { reconcileSeverity } from "../../../../src/domain/alerting/severity.js";
import { getEscalationPolicy } from "../../../../src/domain/alerting/escalation.js";

const KNOWN_COMPONENT_TYPES = ["RDBMS", "NOSQL", "CACHE", "API", "MCP_HOST", "QUEUE"] as const;

describe("createDefaultAlertStrategyRegistry", () => {
  it.each(KNOWN_COMPONENT_TYPES)("resolves the correct strategy for %s", (componentType) => {
    const registry = createDefaultAlertStrategyRegistry();
    const strategy = registry.resolve(componentType);
    expect(strategy.componentType).toBe(componentType);
    expect(strategy).not.toBeInstanceOf(DefaultAlertStrategy);
  });

  it("falls back to the default strategy for an unrecognized component type", () => {
    const registry = createDefaultAlertStrategyRegistry();
    const strategy = registry.resolve("SOMETHING_NOBODY_REGISTERED");
    expect(strategy).toBeInstanceOf(DefaultAlertStrategy);
  });
});

describe("AlertStrategyRegistry runtime registration", () => {
  class GraphqlGatewayStrategy implements AlertStrategy {
    readonly componentType = "GRAPHQL_GATEWAY";
    readonly severityFloor: Severity = "P1";

    buildAlert(context: AlertContext): Alert {
      const severity = reconcileSeverity(this.severityFloor, context.reportedSeverity);
      return {
        severity,
        channels: ["slack"],
        escalation: getEscalationPolicy(severity),
        title: `gateway alert for ${context.componentId}`,
        body: "gateway body",
      };
    }
  }

  it("resolves a brand-new component type once registered, with zero changes to existing strategies or the registry class", () => {
    const registry = createDefaultAlertStrategyRegistry();

    // Not registered yet — falls back.
    expect(registry.resolve("GRAPHQL_GATEWAY")).toBeInstanceOf(DefaultAlertStrategy);

    registry.register(new GraphqlGatewayStrategy());

    const resolved = registry.resolve("GRAPHQL_GATEWAY");
    expect(resolved).toBeInstanceOf(GraphqlGatewayStrategy);
    expect(resolved.componentType).toBe("GRAPHQL_GATEWAY");

    // Existing, built-in strategies are unaffected by the new registration.
    for (const componentType of KNOWN_COMPONENT_TYPES) {
      expect(registry.resolve(componentType).componentType).toBe(componentType);
    }
  });

  it("a fresh registry never sees a registration made on a different instance", () => {
    const registryA = createDefaultAlertStrategyRegistry();
    registryA.register(new GraphqlGatewayStrategy());

    const registryB = createDefaultAlertStrategyRegistry();
    expect(registryB.resolve("GRAPHQL_GATEWAY")).toBeInstanceOf(DefaultAlertStrategy);
  });

  it("register() overwrites an existing entry for the same componentType rather than duplicating it", () => {
    class ReplacementCacheStrategy implements AlertStrategy {
      readonly componentType = "CACHE";
      readonly severityFloor: Severity = "P3";
      buildAlert(context: AlertContext): Alert {
        const severity = reconcileSeverity(this.severityFloor, context.reportedSeverity);
        return { severity, channels: ["email"], escalation: getEscalationPolicy(severity), title: "replaced", body: "replaced" };
      }
    }

    const registry = new AlertStrategyRegistry(new DefaultAlertStrategy());
    registry.register(new ReplacementCacheStrategy());
    expect(registry.resolve("CACHE")).toBeInstanceOf(ReplacementCacheStrategy);
  });
});
