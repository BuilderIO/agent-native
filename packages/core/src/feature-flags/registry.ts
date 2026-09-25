/** Feature-flag definitions shared by the framework and individual apps. */
export interface FeatureFlagDefinition {
  key: string;
  /** Boolean flags are always default-off; explicit in operator metadata. */
  defaultValue?: false;
  displayName?: string;
  description?: string;
}

const FEATURE_FLAG_REGISTRY_SYMBOL = Symbol.for(
  "agent-native.feature-flags.registry",
);
const globalFeatureFlagRegistry = globalThis as typeof globalThis & {
  [FEATURE_FLAG_REGISTRY_SYMBOL]?: Map<string, FeatureFlagDefinition>;
};

// Dev servers can load app plugins from source while action registries resolve
// the built package. With a module-local map, `get-feature-flags` saw no
// definitions in local dev and every flag read as off. Keep both module
// instances on one process-wide registry, as the labs registry does.
const registry =
  globalFeatureFlagRegistry[FEATURE_FLAG_REGISTRY_SYMBOL] ??
  (globalFeatureFlagRegistry[FEATURE_FLAG_REGISTRY_SYMBOL] = new Map());

function normalizeDefinition(
  definition: FeatureFlagDefinition,
): FeatureFlagDefinition {
  const key = definition.key.trim();
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(key)) {
    throw new Error(
      "Feature flag keys must be stable strings containing only letters, numbers, dots, underscores, or hyphens (1-64 characters).",
    );
  }
  return {
    key,
    defaultValue: false,
    ...(definition.displayName?.trim() && {
      displayName: definition.displayName.trim(),
    }),
    ...(definition.description?.trim() && {
      description: definition.description.trim(),
    }),
  };
}

/** Define one app-local feature flag for registration at server startup. */
export function defineFeatureFlag(
  definition: FeatureFlagDefinition,
): FeatureFlagDefinition {
  return Object.freeze(normalizeDefinition(definition));
}

/** Framework-owned labs flag available to every app's feature-flag plugin. */
export const CONNECT_APPS_FLAG = defineFeatureFlag({
  key: "labs.connectApps",
  displayName: "Connect apps",
  description: "Show the experimental app connection surface.",
});

export const BUILDER_CREDIT_USAGE_REPORTING_FLAG = defineFeatureFlag({
  key: "billing.builder-credit-usage-reporting",
  displayName: "Builder credit usage reporting",
  description: "Use Builder-reported credit usage and account limits in Usage.",
});

/**
 * Presentation-only rollout of the redesigned Settings shell. Server actions
 * never read it; hiding a page is not the permission check.
 */
export const SETTINGS_REDESIGN_FLAG = defineFeatureFlag({
  key: "settings-redesign",
  displayName: "Settings redesign",
  description:
    "Show the redesigned Settings page with Account, Connections, Agent, Organization, and app groups.",
});

/** Define a small app-owned feature-flag registry. */
export function defineFeatureFlags(
  definitions: readonly FeatureFlagDefinition[],
): readonly FeatureFlagDefinition[] {
  const seen = new Set<string>();
  return Object.freeze(
    definitions.map((definition) => {
      const normalized = defineFeatureFlag(definition);
      if (seen.has(normalized.key)) {
        throw new Error(`Duplicate feature flag key: ${normalized.key}`);
      }
      seen.add(normalized.key);
      return normalized;
    }),
  );
}

/** Register definitions once at Nitro startup. Re-registering identical data is safe for HMR. */
export function registerFeatureFlags(
  definitions: readonly FeatureFlagDefinition[],
): void {
  for (const rawDefinition of definitions) {
    const definition = defineFeatureFlag(rawDefinition);
    const existing = registry.get(definition.key);
    if (!existing) {
      registry.set(definition.key, definition);
      continue;
    }
    if (
      existing.displayName !== definition.displayName ||
      existing.description !== definition.description
    ) {
      throw new Error(
        `Feature flag ${definition.key} was registered with conflicting metadata.`,
      );
    }
  }
}

export function listFeatureFlags(): readonly FeatureFlagDefinition[] {
  return [...registry.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function getFeatureFlagDefinition(
  key: string,
): FeatureFlagDefinition | null {
  return registry.get(key) ?? null;
}

/** Test-only registry reset; not exported from package entrypoints. */
export function _resetFeatureFlagRegistryForTests(): void {
  registry.clear();
}
