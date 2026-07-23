import type { AlertStrategy } from "./types.js";
import { RdbmsAlertStrategy } from "./strategies/rdbmsStrategy.js";
import { NosqlAlertStrategy } from "./strategies/nosqlStrategy.js";
import { CacheAlertStrategy } from "./strategies/cacheStrategy.js";
import { ApiAlertStrategy } from "./strategies/apiStrategy.js";
import { McpHostAlertStrategy } from "./strategies/mcpHostStrategy.js";
import { QueueAlertStrategy } from "./strategies/queueStrategy.js";
import { DefaultAlertStrategy } from "./strategies/defaultStrategy.js";

/**
 * componentType -> AlertStrategy, backed by a Map, not a branching
 * construct. Adding a new component type never requires editing this
 * class or any existing strategy — write a class implementing
 * AlertStrategy and call register() on it, at construction or later.
 */
export class AlertStrategyRegistry {
  private readonly strategies = new Map<string, AlertStrategy>();

  constructor(
    private readonly fallback: AlertStrategy,
    initial: readonly AlertStrategy[] = [],
  ) {
    for (const strategy of initial) {
      this.register(strategy);
    }
  }

  register(strategy: AlertStrategy): void {
    this.strategies.set(strategy.componentType, strategy);
  }

  resolve(componentType: string): AlertStrategy {
    return this.strategies.get(componentType) ?? this.fallback;
  }
}

/** The 6 built-in strategies + DefaultAlertStrategy as the fallback for anything unrecognized. */
export function createDefaultAlertStrategyRegistry(): AlertStrategyRegistry {
  return new AlertStrategyRegistry(new DefaultAlertStrategy(), [
    new RdbmsAlertStrategy(),
    new NosqlAlertStrategy(),
    new CacheAlertStrategy(),
    new ApiAlertStrategy(),
    new McpHostAlertStrategy(),
    new QueueAlertStrategy(),
  ]);
}
