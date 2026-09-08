/**
 * App-owned user experiments. Unlike feature flags, experiments are
 * user-controlled preferences and default to off until the user opts in.
 */
export interface ExperimentDefinition {
  key: string;
  displayName?: string;
  description?: string;
  /** Extra search terms such as product names or common aliases. */
  keywords?: string;
}

const registry = new Map<string, ExperimentDefinition>();

function normalizeDefinition(
  definition: ExperimentDefinition,
): ExperimentDefinition {
  const key = definition.key.trim();
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(key)) {
    throw new Error(
      "Experiment keys must be stable strings containing only letters, numbers, dots, underscores, or hyphens (1-64 characters).",
    );
  }
  return {
    key,
    ...(definition.displayName?.trim() && {
      displayName: definition.displayName.trim(),
    }),
    ...(definition.description?.trim() && {
      description: definition.description.trim(),
    }),
    ...(definition.keywords?.trim() && {
      keywords: definition.keywords.trim(),
    }),
  };
}

/** Define one app-owned experiment for registration at server startup. */
export function defineExperiment(
  definition: ExperimentDefinition,
): ExperimentDefinition {
  return Object.freeze(normalizeDefinition(definition));
}

/** Define a small app-owned experiment registry. */
export function defineExperiments(
  definitions: readonly ExperimentDefinition[],
): readonly ExperimentDefinition[] {
  const seen = new Set<string>();
  return Object.freeze(
    definitions.map((definition) => {
      const normalized = defineExperiment(definition);
      if (seen.has(normalized.key)) {
        throw new Error(`Duplicate experiment key: ${normalized.key}`);
      }
      seen.add(normalized.key);
      return normalized;
    }),
  );
}

/** Register definitions once at Nitro startup. Re-registering identical data is safe for HMR. */
export function registerExperiments(
  definitions: readonly ExperimentDefinition[],
): void {
  for (const rawDefinition of definitions) {
    const definition = defineExperiment(rawDefinition);
    const existing = registry.get(definition.key);
    if (!existing) {
      registry.set(definition.key, definition);
      continue;
    }
    if (
      existing.displayName !== definition.displayName ||
      existing.description !== definition.description ||
      existing.keywords !== definition.keywords
    ) {
      throw new Error(
        `Experiment ${definition.key} was registered with conflicting metadata.`,
      );
    }
  }
}

export function listExperiments(): readonly ExperimentDefinition[] {
  return [...registry.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function getExperimentDefinition(
  key: string,
): ExperimentDefinition | null {
  return registry.get(key) ?? null;
}

/** Test-only registry reset; not exported from package entrypoints. */
export function _resetExperimentRegistryForTests(): void {
  registry.clear();
}
