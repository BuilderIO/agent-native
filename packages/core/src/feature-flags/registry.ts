/**
 * App-owned feature-flag definitions. Core intentionally starts with an empty
 * registry: a flag key is part of an app's stable contract, not framework
 * configuration that Core should guess at.
 */
export interface FeatureFlagDefinition {
  key: string;
  /** Boolean flags are always default-off; explicit in operator metadata. */
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

/** Define one app-local feature flag for registration at server startup. */
export function defineFeatureFlag(
  definition: FeatureFlagDefinition,
): FeatureFlagDefinition {
  return Object.freeze(normalizeDefinition(definition));
}

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
