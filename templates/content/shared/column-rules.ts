import {
  isPrimaryBlocksField,
  normalizePropertyValueWithOptions,
  type BlocksFieldFreezeRule,
  type DocumentPropertyOption,
  type DocumentPropertyOptions,
  type DocumentPropertyType,
} from "./properties.js";

/**
 * Column rules are checks a collection makes before a save, set on a column by
 * someone who manages the collection. The first kind freezes a tab (a Blocks
 * field other than the page body) while the row's status is one of chosen
 * values, for people and agents alike.
 */
export const COLUMN_RULE_FROZEN = "COLUMN_RULE_FROZEN";

/** The columns a freeze can key on: one value per row, picked from options. */
export const FREEZE_RULE_KEY_TYPES: readonly DocumentPropertyType[] = [
  "status",
  "select",
];

export interface ColumnRuleDefinition {
  id: string;
  name: string;
  type: string;
  options: DocumentPropertyOptions;
}

export interface FrozenBlocksField {
  propertyId: string;
  fieldName: string;
  keyPropertyId: string;
  keyPropertyName: string;
  optionId: string;
  optionName: string;
}

/** The tab's freeze rule, or null. The page body can't carry one. */
export function freezeRuleOf(
  definition: ColumnRuleDefinition,
): BlocksFieldFreezeRule | null {
  if (definition.type !== "blocks") return null;
  if (isPrimaryBlocksField(definition.options)) return null;
  return definition.options.blocks?.freezeWhen ?? null;
}

export function isFreezeRuleKeyType(type: string) {
  return (FREEZE_RULE_KEY_TYPES as readonly string[]).includes(type);
}

/**
 * The option IDs each column's rules name, by column. A rule whose column is
 * gone or can't key a freeze names nothing.
 */
export function freezeRuleKeys(
  definitions: readonly ColumnRuleDefinition[],
): Map<string, Set<string>> {
  const keys = new Map<string, Set<string>>();
  for (const definition of definitions) {
    const rule = freezeRuleOf(definition);
    if (!rule) continue;
    const ids = keys.get(rule.propertyId) ?? new Set<string>();
    for (const id of rule.optionIds) ids.add(id);
    keys.set(rule.propertyId, ids);
  }
  return keys;
}

/**
 * A column's options as a source rewrites them, plus any option a rule names
 * that the source left out. A person removing one is refused; a source isn't
 * asked, so the option stays and the rule keeps matching its rows.
 */
export function keepRuledOptions(
  definitions: readonly ColumnRuleDefinition[],
  propertyId: string,
  current: readonly DocumentPropertyOption[] | undefined,
  next: readonly DocumentPropertyOption[],
): DocumentPropertyOption[] {
  const named = freezeRuleKeys(definitions).get(propertyId);
  if (!named) return [...next];
  const kept = new Set(next.map((option) => option.id));
  return [
    ...next,
    ...(current ?? []).filter(
      (option) => named.has(option.id) && !kept.has(option.id),
    ),
  ];
}

/** The ruled tabs that use this column as their key. */
export function tabsFrozenBy(
  definitions: readonly ColumnRuleDefinition[],
  keyPropertyId: string,
): ColumnRuleDefinition[] {
  return definitions.filter(
    (definition) => freezeRuleOf(definition)?.propertyId === keyPropertyId,
  );
}

/**
 * Which of a row's tabs are frozen now, from its collection's definitions and
 * the row's stored values by property ID.
 */
export function frozenBlocksFields(
  definitions: readonly ColumnRuleDefinition[],
  valueOf: (propertyId: string) => unknown,
): FrozenBlocksField[] {
  const frozen: FrozenBlocksField[] = [];
  for (const definition of definitions) {
    const rule = freezeRuleOf(definition);
    if (!rule) continue;
    const key = definitions.find(
      (candidate) =>
        candidate.id === rule.propertyId && isFreezeRuleKeyType(candidate.type),
    );
    if (!key) continue;
    const optionId = normalizePropertyValueWithOptions(
      key.type as DocumentPropertyType,
      valueOf(key.id),
      key.options,
    );
    if (typeof optionId !== "string" || !rule.optionIds.includes(optionId)) {
      continue;
    }
    frozen.push({
      propertyId: definition.id,
      fieldName: definition.name,
      keyPropertyId: key.id,
      keyPropertyName: key.name,
      optionId,
      optionName:
        key.options.options?.find((option) => option.id === optionId)?.name ??
        optionId,
    });
  }
  return frozen;
}

/** What an agent or person reads when a save to a frozen tab is refused. */
export function frozenBlocksFieldMessage(field: FrozenBlocksField) {
  return `The ${field.fieldName} tab can't change while ${field.keyPropertyName} is ${field.optionName}: a rule on this collection freezes it. Move ${field.keyPropertyName} off ${field.optionName} to edit it, or comment on the page instead.`;
}

/**
 * The rule after one option of a key column is checked or unchecked in a tab's
 * menu. Checking an option of another column starts a rule on that column, and
 * unchecking the last option clears the rule.
 */
export function toggledFreezeRule(
  current: BlocksFieldFreezeRule | null | undefined,
  keyPropertyId: string,
  optionId: string,
  checked: boolean,
): BlocksFieldFreezeRule | null {
  const kept =
    current?.propertyId === keyPropertyId
      ? current.optionIds
      : ([] as string[]);
  const optionIds = checked
    ? [...new Set([...kept, optionId])]
    : kept.filter((id) => id !== optionId);
  return optionIds.length > 0 ? { propertyId: keyPropertyId, optionIds } : null;
}
