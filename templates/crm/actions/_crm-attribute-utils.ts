/**
 * Shared plumbing for the CRM attribute (typed schema) actions.
 *
 * `crm_field_policies` IS the attribute table — there is no parallel one — so
 * every helper here reads and writes that table and translates it to the
 * `CrmAttributeDefinition` shape the contract publishes.
 */

import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, asc, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { CrmAttributeValueError } from "../server/lib/record-fields.js";
import {
  ATTRIBUTE_TYPE_SPECS,
  type CrmAttributeType,
} from "../shared/crm-attributes.js";
import type {
  CrmAttributeDefinition,
  CrmAttributeOption,
} from "../shared/crm-contract.js";

export type CrmAttributeRow = typeof schema.crmFieldPolicies.$inferSelect;
export type CrmAttributeOptionRow =
  typeof schema.crmAttributeOptions.$inferSelect;

/** Longest attribute slug we will mint; the column is untyped TEXT. */
const MAX_API_SLUG_LENGTH = 64;

// The single `attributeType -> value_type` mapping lives in
// `shared/crm-attributes.ts` so server-side writers (native adapter, mirror)
// can use it too without an actions/ -> server/ import.
export { legacyValueTypeFor } from "../shared/crm-attributes.js";

/**
 * Immutable snake_case slug for a title. Minted once at create time: the slug
 * is the `field_name` every stored value row is keyed by, so renaming it would
 * orphan history rather than rename anything.
 */
export function toApiSlug(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_API_SLUG_LENGTH)
    .replace(/_+$/g, "");
  if (!slug) {
    throw new CrmAttributeValueError(
      "crm-attribute-slug",
      `Cannot derive an attribute slug from the title "${title}". Use a title containing letters or digits.`,
    );
  }
  return slug;
}

export function requireAttributeType(type: CrmAttributeType): void {
  if (ATTRIBUTE_TYPE_SPECS[type].systemOnly) {
    throw new CrmAttributeValueError(
      "crm-attribute-system-type",
      `Attribute type "${type}" is created by the system only and cannot be authored. Use a different type.`,
    );
  }
}

/**
 * Stored JSON config, or a typed error. An unreadable blob is NOT silently
 * reported as an empty config — an attribute whose currency code cannot be read
 * must fail loudly, not render as "no currency configured".
 */
export function parseAttributeJson(
  attributeId: string,
  column: "config_json" | "fill_config_json",
  raw: string,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CrmAttributeValueError(
      "crm-attribute-config-unreadable",
      `Attribute ${attributeId} has an unreadable ${column}. Repair it before reading or editing this attribute.`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CrmAttributeValueError(
      "crm-attribute-config-unreadable",
      `Attribute ${attributeId} has a non-object ${column}. Repair it before reading or editing this attribute.`,
    );
  }
  return parsed as Record<string, unknown>;
}

export function toAttributeOption(
  row: CrmAttributeOptionRow,
): CrmAttributeOption {
  return {
    id: row.id,
    value: row.value,
    title: row.title,
    ...(row.color === null ? {} : { color: row.color }),
    position: row.position,
    archived: row.archived,
    targetDays: row.targetDays,
    celebrate: row.celebrate,
  };
}

export function toAttributeDefinition(
  row: CrmAttributeRow,
  options: CrmAttributeOption[] = [],
): CrmAttributeDefinition {
  return {
    id: row.id,
    connectionId: row.connectionId,
    target: row.target,
    // `object_type` is populated for every attribute, including list ones where
    // it mirrors `target_id`; `target_id` is null on rows written by adapters
    // that predate the typed surface.
    targetId: row.targetId ?? row.objectType,
    // Same relationship in reverse: `field_name` is the NOT NULL column the
    // value writer keys on, and the migration seeded `api_slug` from it.
    apiSlug: row.apiSlug ?? row.fieldName,
    label: row.label,
    ...(row.description === null ? {} : { description: row.description }),
    attributeType: row.attributeType,
    multi: row.multi,
    authority: row.authority,
    historyTracked: row.historyTracked,
    uniqueValue: row.uniqueValue,
    archived: row.archived,
    position: row.position,
    inverseAttributeId: row.inverseAttributeId,
    fillMode: row.fillMode,
    fillConfig: parseAttributeJson(
      row.id,
      "fill_config_json",
      row.fillConfigJson,
    ),
    config: parseAttributeJson(row.id, "config_json", row.configJson),
    options,
    storagePolicy: row.storagePolicy,
    sensitive: row.sensitive,
    readable: row.readable,
    createable: row.createable,
    updateable: row.updateable,
    required: row.required,
  };
}

/** Access-scoped options for a set of attributes, keyed by attribute id. */
export async function loadAttributeOptions(input: {
  attributeIds: string[];
  includeArchived: boolean;
}): Promise<Map<string, CrmAttributeOption[]>> {
  const byAttribute = new Map<string, CrmAttributeOption[]>();
  if (input.attributeIds.length === 0) return byAttribute;
  const rows = await getDb()
    .select()
    .from(schema.crmAttributeOptions)
    .where(
      and(
        inArray(schema.crmAttributeOptions.attributeId, input.attributeIds),
        ...(input.includeArchived
          ? []
          : [eq(schema.crmAttributeOptions.archived, false)]),
        accessFilter(
          schema.crmAttributeOptions,
          schema.crmAttributeOptionShares,
        ),
      ),
    )
    .orderBy(
      asc(schema.crmAttributeOptions.position),
      asc(schema.crmAttributeOptions.value),
    );
  for (const row of rows) {
    const list = byAttribute.get(row.attributeId) ?? [];
    list.push(toAttributeOption(row));
    byAttribute.set(row.attributeId, list);
  }
  return byAttribute;
}

/**
 * Load one attribute the caller may edit. `assertAccess` is the authority on
 * the decision; the row is re-read through `accessFilter` so a caller can never
 * observe a row the list surface would hide.
 */
export async function requireEditableAttribute(
  attributeId: string,
): Promise<CrmAttributeRow> {
  await assertAccess("crm-field-policy", attributeId, "editor");
  const [row] = await getDb()
    .select()
    .from(schema.crmFieldPolicies)
    .where(
      and(
        eq(schema.crmFieldPolicies.id, attributeId),
        accessFilter(
          schema.crmFieldPolicies,
          schema.crmFieldPolicyShares,
          undefined,
          "editor",
        ),
      ),
    )
    .limit(1);
  if (!row) {
    throw new CrmAttributeValueError(
      "crm-attribute-not-found",
      `CRM attribute ${attributeId} was not found.`,
    );
  }
  return row;
}

export { CrmAttributeValueError };
