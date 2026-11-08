import { ActionContractError } from "@agent-native/core";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { firstRow } from "../server/lib/first-row.js";
import {
  COLUMN_RULE_FROZEN,
  freezeRuleKeys,
  freezeRuleOf,
  frozenBlocksFieldMessage,
  frozenBlocksFields,
  tabsFrozenBy,
  type ColumnRuleDefinition,
} from "../shared/column-rules.js";
import {
  parsePropertyOptions,
  parsePropertyValue,
  type DocumentPropertyOption,
} from "../shared/properties.js";

type Db = Pick<ReturnType<typeof getDb>, "select">;

export async function columnRuleDefinitions(
  db: Db,
  databaseId: string,
): Promise<ColumnRuleDefinition[]> {
  // guard:allow-unscoped — callers have checked access to the collection; this reads its column settings.
  const rows = await db
    .select({
      id: schema.documentPropertyDefinitions.id,
      name: schema.documentPropertyDefinitions.name,
      type: schema.documentPropertyDefinitions.type,
      optionsJson: schema.documentPropertyDefinitions.optionsJson,
    })
    .from(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.databaseId, databaseId));
  return rows.map(toColumnRuleDefinition);
}

/** A stored column definition, read for its rules. */
export function toColumnRuleDefinition(row: {
  id: string;
  name: string;
  type: string;
  optionsJson: string | null;
}): ColumnRuleDefinition {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    options: parsePropertyOptions(row.optionsJson),
  };
}

/**
 * Refuses a save to a tab that its collection's rule has frozen, for people and
 * agents alike. Call it under the page's row lock: a change to the rule's
 * column takes the same lock, so the value read here is the one this save
 * commits against, and a save that started before the row reached a frozen
 * status but finishes after is refused.
 */
export async function assertBlocksFieldNotFrozen(
  db: Db,
  target: { databaseId: string; documentId: string; propertyId: string },
) {
  const definitions = await columnRuleDefinitions(db, target.databaseId);
  const field = definitions.find(
    (definition) => definition.id === target.propertyId,
  );
  const rule = field ? freezeRuleOf(field) : null;
  if (!field || !rule) return;
  // guard:allow-unscoped — callers have checked access to the page; this reads the rule's one value.
  const stored = firstRow(
    await db
      .select({ valueJson: schema.documentPropertyValues.valueJson })
      .from(schema.documentPropertyValues)
      .where(
        and(
          eq(schema.documentPropertyValues.documentId, target.documentId),
          eq(schema.documentPropertyValues.propertyId, rule.propertyId),
        ),
      ),
  );
  const frozen = frozenBlocksFields(definitions, (propertyId) =>
    propertyId === rule.propertyId && stored
      ? parsePropertyValue(stored.valueJson)
      : null,
  ).find((candidate) => candidate.propertyId === field.id);
  if (!frozen) return;
  throw new ActionContractError(frozenBlocksFieldMessage(frozen), {
    errorCode: COLUMN_RULE_FROZEN,
    statusCode: 403,
    details: {
      databaseId: target.databaseId,
      documentId: target.documentId,
      propertyId: frozen.propertyId,
      keyPropertyId: frozen.keyPropertyId,
      optionId: frozen.optionId,
    },
  });
}

export function isColumnRuleRefusal(
  error: unknown,
): error is ActionContractError {
  return (
    error instanceof ActionContractError &&
    error.errorCode === COLUMN_RULE_FROZEN
  );
}

/** Whether a change to this column has to take the page row a frozen tab's save takes. */
export function keysAFreezeRule(
  definitions: readonly ColumnRuleDefinition[],
  propertyId: string,
) {
  return freezeRuleKeys(definitions).has(propertyId);
}

function ruleInUseError(message: string, details: Record<string, unknown>) {
  return new ActionContractError(message, {
    errorCode: "COLUMN_RULE_IN_USE",
    statusCode: 409,
    details,
  });
}

/**
 * A column that carries a rule, or that a rule keys on, can't be deleted or
 * change type until someone who manages the collection removes the rule.
 * Otherwise anyone who can edit the collection's columns could lift it.
 */
export function assertNoColumnRuleOn(
  definitions: readonly ColumnRuleDefinition[],
  propertyId: string,
  change: "delete" | "type",
) {
  const action = change === "delete" ? "can't be deleted" : "can't change type";
  const field = definitions.find((definition) => definition.id === propertyId);
  if (field && freezeRuleOf(field)) {
    throw ruleInUseError(
      `The ${field.name} tab has a rule that freezes it, so it ${action}. Someone with full access to the collection can remove the rule from the tab's menu first.`,
      { propertyId },
    );
  }
  const frozenTab = firstRow(tabsFrozenBy(definitions, propertyId));
  if (field && frozenTab) {
    throw ruleInUseError(
      `A rule freezes the ${frozenTab.name} tab while ${field.name} has certain values, so ${field.name} ${action}. Someone with full access to the collection can remove the rule from that tab's menu first.`,
      { propertyId, ruledPropertyId: frozenTab.id },
    );
  }
}

/** An option a rule names can't be removed while the rule stands. */
export function assertKeepsRuledOptions(
  definitions: readonly ColumnRuleDefinition[],
  propertyId: string,
  nextOptions: readonly DocumentPropertyOption[] | undefined,
) {
  const named = freezeRuleKeys(definitions).get(propertyId);
  if (!named) return;
  const kept = new Set((nextOptions ?? []).map((option) => option.id));
  const field = definitions.find((definition) => definition.id === propertyId);
  for (const optionId of named) {
    if (kept.has(optionId)) continue;
    const name =
      field?.options.options?.find((option) => option.id === optionId)?.name ??
      optionId;
    const frozenTab = firstRow(tabsFrozenBy(definitions, propertyId));
    throw ruleInUseError(
      `A rule freezes the ${frozenTab?.name ?? "a"} tab while ${field?.name ?? "this column"} is ${name}, so ${name} can't be removed. Someone with full access to the collection can change the rule from that tab's menu first.`,
      { propertyId, optionId, ruledPropertyId: frozenTab?.id ?? null },
    );
  }
}
