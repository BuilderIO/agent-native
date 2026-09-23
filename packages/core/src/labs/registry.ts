/**
 * App-owned user labs. Users control each lab; apps can choose its initial
 * state when the user has not saved a preference.
 */
export interface LabDefinition {
  key: string;
  /** Initial state for users without a saved preference. Defaults to false. */
  defaultEnabled?: boolean;
  displayName?: string;
  description?: string;
  /** Extra search terms such as product names or common aliases. */
  keywords?: string;
}

const LABS_REGISTRY_SYMBOL = Symbol.for("agent-native.labs.registry");
const globalLabsRegistry = globalThis as typeof globalThis & {
  [LABS_REGISTRY_SYMBOL]?: Map<string, LabDefinition>;
};

// Dev servers can load app plugins from source while action registries resolve
// the built package. Keep both module instances on one process-wide registry.
const registry =
  globalLabsRegistry[LABS_REGISTRY_SYMBOL] ??
  (globalLabsRegistry[LABS_REGISTRY_SYMBOL] = new Map());

function normalizeDefinition(definition: LabDefinition): LabDefinition {
  const key = definition.key.trim();
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(key)) {
    throw new Error(
      "Lab keys must be stable strings containing only letters, numbers, dots, underscores, or hyphens (1-64 characters).",
    );
  }
  return {
    key,
    ...(definition.defaultEnabled !== undefined && {
      defaultEnabled: definition.defaultEnabled,
    }),
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
export function defineLab(definition: LabDefinition): LabDefinition {
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
export function registerLabs(definitions: readonly LabDefinition[]): void {
  for (const rawDefinition of definitions) {
    const definition = defineLab(rawDefinition);
    const existing = registry.get(definition.key);
    if (!existing) {
      registry.set(definition.key, definition);
      continue;
    }
    if (
      existing.defaultEnabled !== definition.defaultEnabled ||
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

export function getLabDefinition(key: string): LabDefinition | null {
  return registry.get(key) ?? null;
}

/** Test-only registry reset; not exported from package entrypoints. */
export function _resetLabRegistryForTests(): void {
  registry.clear();
}
