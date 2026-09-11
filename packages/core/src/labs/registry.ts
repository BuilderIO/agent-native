/**
 * App-owned user labs. Unlike feature flags, labs are
 * user-controlled preferences and default to off until the user opts in.
 */
export interface LabDefinition {
  key: string;
  displayName?: string;
  description?: string;
  /** Extra search terms such as product names or common aliases. */
  keywords?: string;
}

const registry = new Map<string, LabDefinition>();

function normalizeDefinition(
  definition: LabDefinition,
): LabDefinition {
  const key = definition.key.trim();
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(key)) {
    throw new Error(
      "Lab keys must be stable strings containing only letters, numbers, dots, underscores, or hyphens (1-64 characters).",
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

/** Define one app-owned lab for registration at server startup. */
export function defineLab(
  definition: LabDefinition,
): LabDefinition {
  return Object.freeze(normalizeDefinition(definition));
}

/** Define a small app-owned lab registry. */
export function defineLabs(
  definitions: readonly LabDefinition[],
): readonly LabDefinition[] {
  const seen = new Set<string>();
  return Object.freeze(
    definitions.map((definition) => {
      const normalized = defineLab(definition);
      if (seen.has(normalized.key)) {
        throw new Error(`Duplicate lab key: ${normalized.key}`);
      }
      seen.add(normalized.key);
      return normalized;
    }),
  );
}

/** Register definitions once at Nitro startup. Re-registering identical data is safe for HMR. */
export function registerLabs(
  definitions: readonly LabDefinition[],
): void {
  for (const rawDefinition of definitions) {
    const definition = defineLab(rawDefinition);
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
        `Lab ${definition.key} was registered with conflicting metadata.`,
      );
    }
  }
}

export function listLabs(): readonly LabDefinition[] {
  return [...registry.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function getLabDefinition(
  key: string,
): LabDefinition | null {
  return registry.get(key) ?? null;
}

/** Test-only registry reset; not exported from package entrypoints. */
export function _resetLabRegistryForTests(): void {
  registry.clear();
}
