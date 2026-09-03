export interface IdentifiedDefinition {
  id: string;
}

export function mergeDefinitionsById<T extends IdentifiedDefinition>(
  defaults: readonly T[],
  overrides: readonly T[] = [],
): T[] {
  const merged = new Map(
    defaults.map((definition) => [definition.id, definition]),
  );
  for (const override of overrides) merged.set(override.id, override);
  return [...merged.values()];
}
