export interface FeatureFlagDefinition {
  key: string;
  defaultValue?: false;
  displayName?: string;
  description?: string;
}

const registry = new Map<string, FeatureFlagDefinition>();

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

export function defineFeatureFlag(
  definition: FeatureFlagDefinition,
): FeatureFlagDefinition {
  return Object.freeze(normalizeDefinition(definition));
}

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

export function _resetFeatureFlagRegistryForTests(): void {
  registry.clear();
}
