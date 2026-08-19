/**
 * Shared plumbing for the CRM list actions.
 *
 * Lists are Attio's workflow overlay: a list has its OWN attributes (stage,
 * owner, priority) whose values live on the ENTRY, not on the record. Entries
 * and entry values are local-authoritative on every backend — that is what lets
 * a pipeline work over a HubSpot or Salesforce mirror without a provider write.
 *
 * Entry attribute values are stored in `crm_record_fields` with `entryId` set;
 * `recordId` stays populated either way, so `entryId IS NULL` is the
 * record-vs-entry discriminator. Every value write goes through
 * `writeCrmRecordField`, which is what makes a stage change open a history row.
 */

import type { ActionRunContext } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import {
  aliasedTable,
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  sql,
  type SQL,
} from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  applyOneCrmStatusTransition,
  loadCrmStatusLifecycle,
} from "../server/lib/lifecycle.js";
import {
  CrmAttributeValueError,
  writeCrmRecordField,
  type CrmFieldWriteDb,
  type CrmWritableAttribute,
} from "../server/lib/record-fields.js";
import {
  ATTRIBUTE_TYPE_SPECS,
  storageColumnFor,
  type CrmAttributeStorageColumn,
  type CrmAttributeType,
} from "../shared/crm-attributes.js";
import type {
  CrmActorType,
  CrmAttributeOption,
  CrmValue,
} from "../shared/crm-contract.js";
import { crmInitiatedBy } from "./_crm-action-utils.js";

type CrmDb = ReturnType<typeof getDb>;

export const MAX_LIST_LIMIT = 100;
export const MAX_LIST_ENTRY_LIMIT = 100;
export const MAX_LIST_ENTRY_FILTERS = 6;
export const MAX_LIST_ENTRY_SORTS = 2;
export const MAX_LIST_ATTRIBUTES = 100;

/**
 * A list problem the caller must fix before retrying. Extends the attribute
 * writer's error so every "your input is wrong" failure out of the CRM write
 * path carries the same 422 contract.
 */
export class CrmListError extends CrmAttributeValueError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "CrmListError";
  }
}

export interface CrmOwnership {
  ownerEmail: string;
  orgId: string | null;
  visibility: "private" | "org" | "public";
}

/** Who is making the write, in `crm_record_fields.actor_type` terms. */
export function crmActorFrom(ctx?: ActionRunContext): {
  type: CrmActorType;
  id: string | null;
} {
  const initiator = crmInitiatedBy(ctx);
  const type: CrmActorType =
    initiator === "human"
      ? "user"
      : initiator === "agent"
        ? "agent"
        : "automation";
  return { type, id: ctx?.userEmail ?? null };
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export function crmApiSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return slug || "list";
}

/**
 * A slug that is free among the lists this caller can see. Uniqueness is
 * scoped, not global — the id is the key, `api_slug` is the stable human handle
 * and is immutable once assigned.
 */
export async function uniqueCrmListSlug(
  db: CrmDb,
  connectionId: string,
  base: string,
): Promise<string> {
  const rows = await db
    .select({ apiSlug: schema.crmLists.apiSlug })
    .from(schema.crmLists)
    .where(
      and(
        eq(schema.crmLists.connectionId, connectionId),
        like(schema.crmLists.apiSlug, `${base}%`),
        accessFilter(schema.crmLists, schema.crmListShares),
      ),
    )
    .limit(MAX_LIST_LIMIT);
  const taken = new Set(rows.map((row) => row.apiSlug));
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix <= MAX_LIST_LIMIT + 1; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new CrmListError(
    "crm-list-slug-exhausted",
    `Could not derive a free api_slug from "${base}". Rename the list.`,
  );
}

export type CrmListRow = typeof schema.crmLists.$inferSelect;

export async function requireCrmList(
  db: CrmDb,
  listId: string,
  minRole: "viewer" | "editor",
): Promise<CrmListRow> {
  const [list] = await db
    .select()
    .from(schema.crmLists)
    .where(
      and(
        eq(schema.crmLists.id, listId),
        accessFilter(schema.crmLists, schema.crmListShares, undefined, minRole),
      ),
    )
    .limit(1);
  if (!list) {
    throw new CrmListError(
      "crm-list-not-found",
      `CRM list "${listId}" was not found or you do not have ${minRole} access to it.`,
    );
  }
  return list;
}

export type CrmListEntryRow = typeof schema.crmListEntries.$inferSelect;

export async function requireCrmListEntry(
  db: CrmDb,
  entryId: string,
  minRole: "viewer" | "editor",
): Promise<CrmListEntryRow> {
  const [entry] = await db
    .select()
    .from(schema.crmListEntries)
    .where(
      and(
        eq(schema.crmListEntries.id, entryId),
        accessFilter(
          schema.crmListEntries,
          schema.crmListEntryShares,
          undefined,
          minRole,
        ),
      ),
    )
    .limit(1);
  if (!entry) {
    throw new CrmListError(
      "crm-list-entry-not-found",
      `CRM list entry "${entryId}" was not found or you do not have ${minRole} access to it.`,
    );
  }
  return entry;
}

// ---------------------------------------------------------------------------
// List attributes
// ---------------------------------------------------------------------------

export interface CrmListAttribute extends CrmWritableAttribute {
  label: string;
  description: string | null;
  position: number;
  required: boolean;
  options: CrmAttributeOption[];
}

/**
 * The list's own attributes. `target = "list"` with `target_id = listId`;
 * `object_type` mirrors `target_id` so the legacy
 * `(connection_id, object_type, field_name)` unique index keeps guarding one
 * attribute per list.
 */
export async function loadCrmListAttributes(
  db: CrmDb,
  listId: string,
): Promise<CrmListAttribute[]> {
  const rows = await db
    .select({
      id: schema.crmFieldPolicies.id,
      apiSlug: schema.crmFieldPolicies.apiSlug,
      fieldName: schema.crmFieldPolicies.fieldName,
      label: schema.crmFieldPolicies.label,
      description: schema.crmFieldPolicies.description,
      attributeType: schema.crmFieldPolicies.attributeType,
      multi: schema.crmFieldPolicies.multi,
      historyTracked: schema.crmFieldPolicies.historyTracked,
      valueType: schema.crmFieldPolicies.valueType,
      storagePolicy: schema.crmFieldPolicies.storagePolicy,
      position: schema.crmFieldPolicies.position,
      required: schema.crmFieldPolicies.required,
    })
    .from(schema.crmFieldPolicies)
    .where(
      and(
        eq(schema.crmFieldPolicies.target, "list"),
        eq(schema.crmFieldPolicies.targetId, listId),
        eq(schema.crmFieldPolicies.archived, false),
        accessFilter(schema.crmFieldPolicies, schema.crmFieldPolicyShares),
      ),
    )
    .limit(MAX_LIST_ATTRIBUTES);

  const attributeIds = rows.map((row) => row.id);
  const optionRows = attributeIds.length
    ? await db
        .select({
          id: schema.crmAttributeOptions.id,
          attributeId: schema.crmAttributeOptions.attributeId,
          value: schema.crmAttributeOptions.value,
          title: schema.crmAttributeOptions.title,
          color: schema.crmAttributeOptions.color,
          position: schema.crmAttributeOptions.position,
          archived: schema.crmAttributeOptions.archived,
          targetDays: schema.crmAttributeOptions.targetDays,
          celebrate: schema.crmAttributeOptions.celebrate,
        })
        .from(schema.crmAttributeOptions)
        .where(
          and(
            inArray(schema.crmAttributeOptions.attributeId, attributeIds),
            accessFilter(
              schema.crmAttributeOptions,
              schema.crmAttributeOptionShares,
            ),
          ),
        )
    : [];

  const optionsByAttribute = new Map<string, CrmAttributeOption[]>();
  for (const option of optionRows) {
    const bucket = optionsByAttribute.get(option.attributeId) ?? [];
    bucket.push({
      id: option.id,
      value: option.value,
      title: option.title,
      ...(option.color === null ? {} : { color: option.color }),
      position: option.position,
      archived: option.archived,
      targetDays: option.targetDays,
      celebrate: option.celebrate,
    });
    optionsByAttribute.set(option.attributeId, bucket);
  }

  return rows
    .map((row) => {
      // A list attribute is local-authoritative by construction. A provider
      // storage policy here means the row was mis-seeded, not that the value is
      // merely unwritable — say so instead of silently degrading the write.
      if (
        row.storagePolicy !== "local-authoritative" &&
        row.storagePolicy !== "derived-local" &&
        row.storagePolicy !== "mirrored"
      ) {
        throw new CrmListError(
          "crm-list-attribute-not-writable",
          `List attribute "${row.apiSlug ?? row.fieldName}" has storage policy "${row.storagePolicy}". List attributes are local-authoritative.`,
        );
      }
      return {
        id: row.id,
        apiSlug: row.apiSlug ?? row.fieldName,
        attributeType: row.attributeType,
        multi: row.multi,
        historyTracked: row.historyTracked,
        valueType: row.valueType,
        storagePolicy: row.storagePolicy,
        fieldPolicyId: row.id,
        label: row.label,
        description: row.description,
        position: row.position,
        required: row.required,
        options: (optionsByAttribute.get(row.id) ?? []).sort(
          (a, b) => a.position - b.position,
        ),
      } satisfies CrmListAttribute;
    })
    .sort(
      (a, b) => a.position - b.position || a.apiSlug.localeCompare(b.apiSlug),
    );
}

export function indexAttributes(
  attributes: CrmListAttribute[],
): Map<string, CrmListAttribute> {
  return new Map(attributes.map((attribute) => [attribute.apiSlug, attribute]));
}

// ---------------------------------------------------------------------------
// Seeding a list from its parent object, and the one-time copy that gives a
// new entry its first values.
//
// A list attribute is the list's OWN field: it is seeded from a record
// attribute and each entry's first value is copied from the record once, at
// insert. Nothing re-reads the record afterwards and nothing writes back — that
// separation is what lets a pipeline run over a HubSpot or Salesforce mirror
// without a provider write.
// ---------------------------------------------------------------------------

/** A parent-object attribute a list can seed from. Single-valued only: a
 * list's stage, amount, and date are single by construction, and a multi
 * source would not fit the seeded attribute's storage column. */
export interface CrmObjectAttribute {
  id: string;
  apiSlug: string;
  label: string;
  attributeType: CrmAttributeType;
  /** Raw `config_json`, copied verbatim so a currency keeps its code. */
  configJson: string;
  position: number;
}

export async function loadCrmObjectAttributes(
  db: CrmDb,
  connectionId: string,
  objectType: string,
): Promise<CrmObjectAttribute[]> {
  const rows = await db
    .select({
      id: schema.crmFieldPolicies.id,
      apiSlug: schema.crmFieldPolicies.apiSlug,
      fieldName: schema.crmFieldPolicies.fieldName,
      label: schema.crmFieldPolicies.label,
      attributeType: schema.crmFieldPolicies.attributeType,
      configJson: schema.crmFieldPolicies.configJson,
      position: schema.crmFieldPolicies.position,
    })
    .from(schema.crmFieldPolicies)
    .where(
      and(
        eq(schema.crmFieldPolicies.target, "object"),
        eq(schema.crmFieldPolicies.objectType, objectType),
        eq(schema.crmFieldPolicies.connectionId, connectionId),
        eq(schema.crmFieldPolicies.archived, false),
        eq(schema.crmFieldPolicies.multi, false),
        accessFilter(schema.crmFieldPolicies, schema.crmFieldPolicyShares),
      ),
    )
    .limit(MAX_LIST_ATTRIBUTES);

  return rows
    .map((row) => ({
      id: row.id,
      // `api_slug` is null on rows written by the adapters, which predate the
      // typed surface; `field_name` is what their values are keyed by.
      apiSlug: row.apiSlug ?? row.fieldName,
      label: row.label,
      attributeType: row.attributeType,
      configJson: row.configJson,
      position: row.position,
    }))
    .sort(
      (a, b) => a.position - b.position || a.apiSlug.localeCompare(b.apiSlug),
    );
}

/** What one attribute's initial value did, per entry. `applied: false` is
 * reported rather than dropped: "the record had no value" and "the record's
 * value does not fit this list" are different facts about an empty card. */
export interface CrmEntryInitialValue {
  attribute: string;
  /** The record attribute the value was read from. */
  from: string;
  applied: boolean;
  reason?: string;
}

/**
 * The values a BRAND-NEW entry starts with, copied once from the record's own
 * attributes that share the list attribute's slug and type.
 *
 * This is a snapshot at insert, not a binding. Nothing reads the record again,
 * and `update-crm-list-entry` never writes it back, so an entry and its record
 * diverge from here on — deliberately, because the record may be provider-owned
 * and a pipeline must never need a provider write.
 */
export async function initialCrmEntryValues(input: {
  db: CrmDb;
  connectionId: string;
  record: { id: string; objectType: string };
  attributes: Map<string, CrmListAttribute>;
  /** Slugs the caller set explicitly. Neither copied nor reported: a value the
   * caller chose was not initialized from anything. */
  supplied?: ReadonlySet<string>;
}): Promise<{
  values: Record<string, CrmValue>;
  initialValues: CrmEntryInitialValue[];
}> {
  if (input.attributes.size === 0) return { values: {}, initialValues: [] };

  const sources = (
    await loadCrmObjectAttributes(
      input.db,
      input.connectionId,
      input.record.objectType,
    )
  ).filter((source) => {
    if (input.supplied?.has(source.apiSlug)) return false;
    const attribute = input.attributes.get(source.apiSlug);
    // Same slug is not enough: a text `amount` on the object must not be copied
    // into a currency `amount` on the list.
    return (
      !!attribute &&
      !attribute.multi &&
      attribute.attributeType === source.attributeType
    );
  });
  if (sources.length === 0) return { values: {}, initialValues: [] };

  const rows = await input.db
    .select({
      fieldName: schema.crmRecordFields.fieldName,
      stringValue: schema.crmRecordFields.stringValue,
      numberValue: schema.crmRecordFields.numberValue,
      booleanValue: schema.crmRecordFields.booleanValue,
      jsonValue: schema.crmRecordFields.jsonValue,
    })
    .from(schema.crmRecordFields)
    .where(
      and(
        eq(schema.crmRecordFields.recordId, input.record.id),
        // `entry_id IS NULL` is the record-vs-entry discriminator: another
        // entry's value must never seed this one.
        isNull(schema.crmRecordFields.entryId),
        isNull(schema.crmRecordFields.activeUntil),
        inArray(
          schema.crmRecordFields.fieldName,
          sources.map((source) => source.apiSlug),
        ),
        accessFilter(schema.crmRecordFields, schema.crmRecordFieldShares),
      ),
    );

  const values: Record<string, CrmValue> = {};
  const initialValues: CrmEntryInitialValue[] = [];
  for (const row of rows) {
    const attribute = input.attributes.get(row.fieldName);
    if (!attribute) continue;
    const value = decodeCrmAttributeValue(attribute, row);
    // Nothing to copy is not a failure and is not reported as one.
    if (value === null) continue;
    if (ATTRIBUTE_TYPE_SPECS[attribute.attributeType].usesOptions) {
      const enterable = attribute.options.some(
        (option) => !option.archived && option.value === value,
      );
      if (!enterable) {
        initialValues.push({
          attribute: attribute.apiSlug,
          from: row.fieldName,
          applied: false,
          reason: `The record's "${String(value)}" is not a live option of this list's "${attribute.label}". Add the option, or set the entry's value explicitly.`,
        });
        continue;
      }
    }
    values[attribute.apiSlug] = value;
    initialValues.push({
      attribute: attribute.apiSlug,
      from: row.fieldName,
      applied: true,
    });
  }
  return { values, initialValues };
}

// ---------------------------------------------------------------------------
// Entry attribute values
// ---------------------------------------------------------------------------

interface StoredValueRow {
  stringValue: string | null;
  numberValue: number | null;
  booleanValue: boolean | null;
  jsonValue: string | null;
}

/**
 * Decode a stored value using the attribute's declared storage column rather
 * than guessing from which column is non-null — a `false` checkbox and an empty
 * text field are otherwise indistinguishable.
 */
export function decodeCrmAttributeValue(
  attribute: CrmListAttribute,
  row: StoredValueRow,
): CrmValue {
  const column = storageColumnFor(attribute.attributeType, attribute.multi);
  if (column === "numberValue") return row.numberValue;
  if (column === "booleanValue") return row.booleanValue;
  if (column === "jsonValue") {
    if (row.jsonValue === null) return null;
    try {
      return JSON.parse(row.jsonValue) as CrmValue;
    } catch {
      throw new CrmListError(
        "crm-attribute-value-unreadable",
        `Stored value for "${attribute.apiSlug}" is not readable JSON. It was written outside the attribute writer.`,
      );
    }
  }
  return row.stringValue;
}

export interface CrmEntryValues {
  values: Record<string, CrmValue>;
  /** `activeFrom` of the current value — what a stage SLA is measured from. */
  valuesSince: Record<string, string>;
}

export async function loadCrmEntryValues(
  db: CrmDb,
  entryIds: string[],
  attributes: Map<string, CrmListAttribute>,
): Promise<Map<string, CrmEntryValues>> {
  const byEntry = new Map<string, CrmEntryValues>();
  for (const entryId of entryIds) {
    byEntry.set(entryId, { values: {}, valuesSince: {} });
  }
  if (entryIds.length === 0) return byEntry;

  const rows = await db
    .select({
      entryId: schema.crmRecordFields.entryId,
      fieldName: schema.crmRecordFields.fieldName,
      stringValue: schema.crmRecordFields.stringValue,
      numberValue: schema.crmRecordFields.numberValue,
      booleanValue: schema.crmRecordFields.booleanValue,
      jsonValue: schema.crmRecordFields.jsonValue,
      activeFrom: schema.crmRecordFields.activeFrom,
    })
    .from(schema.crmRecordFields)
    .where(
      and(
        inArray(schema.crmRecordFields.entryId, entryIds),
        isNull(schema.crmRecordFields.activeUntil),
        accessFilter(schema.crmRecordFields, schema.crmRecordFieldShares),
      ),
    );

  for (const row of rows) {
    if (!row.entryId) continue;
    const attribute = attributes.get(row.fieldName);
    const bucket = byEntry.get(row.entryId);
    if (!attribute || !bucket) continue;
    bucket.values[attribute.apiSlug] = decodeCrmAttributeValue(attribute, row);
    bucket.valuesSince[attribute.apiSlug] = row.activeFrom;
  }
  return byEntry;
}

export interface CrmEntryValueWrite {
  attribute: string;
  changed: boolean;
  mode?: "insert" | "close-and-insert" | "update-in-place";
}

/**
 * Write entry attribute values through the bitemporal writer. A stage move is
 * exactly this call — the row it closes and the row it opens ARE the stage
 * history the board reports time-in-stage from.
 *
 * A `status` value is routed through the lifecycle rather than written
 * directly: the enterable set comes from the attribute's own options, and the
 * move is claimed against the value the decision was made from, so a stage
 * somebody else moved in between is refused instead of clobbered. Clearing a
 * status (`null`) is not a transition into anything and stays an ordinary
 * write — the way out of a retired stage must not itself be blocked.
 */
export async function writeCrmListEntryValues(input: {
  db: CrmFieldWriteDb;
  recordId: string;
  entryId: string;
  attributes: Map<string, CrmListAttribute>;
  values: Record<string, unknown>;
  actor: { type: CrmActorType; id?: string | null };
  ownership: CrmOwnership;
  now: string;
}): Promise<CrmEntryValueWrite[]> {
  const writes: CrmEntryValueWrite[] = [];
  for (const [slug, value] of Object.entries(input.values)) {
    const attribute = input.attributes.get(slug);
    if (!attribute) {
      const known = [...input.attributes.keys()];
      throw new CrmListError(
        "crm-list-attribute-unknown",
        `"${slug}" is not an attribute of this list. Known attributes: ${
          known.length ? known.join(", ") : "(none)"
        }.`,
      );
    }
    if (attribute.attributeType === "status" && typeof value === "string") {
      const moved = await applyOneCrmStatusTransition({
        db: input.db,
        lifecycle: await loadCrmStatusLifecycle(input.db, attribute.id),
        target: { recordId: input.recordId, entryId: input.entryId },
        to: value,
        actor: input.actor,
        ownership: input.ownership,
        now: input.now,
      });
      writes.push({
        attribute: slug,
        changed: moved.changed,
        ...(moved.mode ? { mode: moved.mode } : {}),
      });
      continue;
    }

    const result = await writeCrmRecordField({
      db: input.db,
      target: { recordId: input.recordId, entryId: input.entryId },
      attribute,
      value: value as CrmValue,
      actor: input.actor,
      ownership: input.ownership,
      now: input.now,
    });
    writes.push({
      attribute: slug,
      changed: result.changed,
      ...(result.changed ? { mode: result.mode } : {}),
    });
  }
  return writes;
}

// ---------------------------------------------------------------------------
// Server-side filter / sort over entries
//
// Filters and sorts are pushed into SQL, never applied after the page is cut —
// a client-side filter over one page silently returns the wrong rows.
// ---------------------------------------------------------------------------

export const CRM_ENTRY_FILTER_OPERATORS = [
  "eq",
  "neq",
  "contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "is-empty",
  "is-not-empty",
] as const;

export type CrmEntryFilterOperator =
  (typeof CRM_ENTRY_FILTER_OPERATORS)[number];

export type CrmEntryFilterValue =
  | string
  | number
  | boolean
  | null
  | Array<string | number | boolean>;

export interface CrmEntryFilter {
  attribute: string;
  operator: CrmEntryFilterOperator;
  value?: CrmEntryFilterValue;
}

export interface CrmEntrySort {
  attribute: string;
  direction: "asc" | "desc";
}

type FieldKind = "text" | "number" | "boolean" | "json";

interface ResolvedField {
  /** Drizzle column reference, possibly on a joined `crm_record_fields` alias. */
  column: any;
  kind: FieldKind;
}

const RECORD_FIELDS: Record<string, () => ResolvedField> = {
  "record.displayName": () => ({
    column: schema.crmRecords.displayName,
    kind: "text",
  }),
  "record.kind": () => ({ column: schema.crmRecords.kind, kind: "text" }),
  "record.stage": () => ({ column: schema.crmRecords.stage, kind: "text" }),
  "record.ownerName": () => ({
    column: schema.crmRecords.ownerName,
    kind: "text",
  }),
  "record.domain": () => ({ column: schema.crmRecords.domain, kind: "text" }),
  "record.primaryEmail": () => ({
    column: schema.crmRecords.primaryEmail,
    kind: "text",
  }),
  "record.amount": () => ({ column: schema.crmRecords.amount, kind: "number" }),
  "record.closeDate": () => ({
    column: schema.crmRecords.closeDate,
    kind: "text",
  }),
  "record.updatedAt": () => ({
    column: schema.crmRecords.updatedAt,
    kind: "text",
  }),
  "entry.position": () => ({
    column: schema.crmListEntries.position,
    kind: "number",
  }),
  "entry.createdAt": () => ({
    column: schema.crmListEntries.createdAt,
    kind: "text",
  }),
};

export const CRM_ENTRY_BUILTIN_FIELDS = Object.keys(RECORD_FIELDS);

const STORAGE_KIND: Record<CrmAttributeStorageColumn, FieldKind> = {
  stringValue: "text",
  numberValue: "number",
  booleanValue: "boolean",
  jsonValue: "json",
};

export interface EntryJoin {
  table: any;
  on: SQL;
}

/**
 * Resolves a filter/sort field name to a column, adding one LEFT JOIN per
 * referenced list attribute. Bounded by the filter/sort caps, so the join count
 * is bounded too.
 */
export class CrmEntryFieldResolver {
  readonly joins: EntryJoin[] = [];
  private readonly cache = new Map<string, ResolvedField>();

  constructor(private readonly attributes: Map<string, CrmListAttribute>) {}

  resolve(name: string): ResolvedField {
    const cached = this.cache.get(name);
    if (cached) return cached;

    const builtin = RECORD_FIELDS[name];
    if (builtin) {
      const field = builtin();
      this.cache.set(name, field);
      return field;
    }

    const attribute = this.attributes.get(name);
    if (!attribute) {
      throw new CrmListError(
        "crm-list-field-unknown",
        `"${name}" is neither a list attribute nor one of: ${CRM_ENTRY_BUILTIN_FIELDS.join(", ")}.`,
      );
    }

    const alias = aliasedTable(
      schema.crmRecordFields,
      `crm_entry_field_${this.joins.length}`,
    );
    this.joins.push({
      table: alias,
      on: and(
        eq(alias.entryId, schema.crmListEntries.id),
        eq(alias.fieldName, attribute.apiSlug),
        isNull(alias.activeUntil),
        accessFilter(alias, schema.crmRecordFieldShares),
      ) as SQL,
    });

    const field: ResolvedField = {
      column: alias[storageColumnFor(attribute.attributeType, attribute.multi)],
      kind: STORAGE_KIND[
        storageColumnFor(attribute.attributeType, attribute.multi)
      ],
    };
    this.cache.set(name, field);
    return field;
  }
}

function coerceScalar(
  name: string,
  kind: FieldKind,
  value: CrmEntryFilterValue | undefined,
): string | number | boolean {
  if (kind === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new CrmListError(
        "crm-list-filter-value",
        `Filter on "${name}" expects a finite number.`,
      );
    }
    return value;
  }
  if (kind === "boolean") {
    if (typeof value !== "boolean") {
      throw new CrmListError(
        "crm-list-filter-value",
        `Filter on "${name}" expects a boolean.`,
      );
    }
    return value;
  }
  if (typeof value !== "string") {
    throw new CrmListError(
      "crm-list-filter-value",
      `Filter on "${name}" expects a string.`,
    );
  }
  return value;
}

export function buildEntryFilter(
  resolver: CrmEntryFieldResolver,
  filter: CrmEntryFilter,
): SQL {
  const field = resolver.resolve(filter.attribute);
  const { column, kind } = field;

  if (filter.operator === "is-empty") return isNull(column);
  if (filter.operator === "is-not-empty") return isNotNull(column);

  if (kind === "json" && filter.operator !== "contains") {
    throw new CrmListError(
      "crm-list-filter-operator",
      `"${filter.attribute}" is stored as a structured value; only contains, is-empty, and is-not-empty apply.`,
    );
  }

  if (filter.operator === "contains") {
    if (typeof filter.value !== "string") {
      throw new CrmListError(
        "crm-list-filter-value",
        `Filter "contains" on "${filter.attribute}" expects a string.`,
      );
    }
    // `lower(...)` on both sides: SQLite LIKE folds ASCII case, Postgres LIKE
    // does not, and a filter that silently differs by dialect is a bug.
    // A structured value is matched on its quoted JSON token so `won` cannot
    // match `unwon` inside a multi-value array.
    const needle =
      kind === "json"
        ? `%"${filter.value.toLowerCase()}"%`
        : `%${filter.value.toLowerCase()}%`;
    return like(sql`lower(${column})`, needle);
  }

  if (filter.operator === "in") {
    if (!Array.isArray(filter.value) || filter.value.length === 0) {
      throw new CrmListError(
        "crm-list-filter-value",
        `Filter "in" on "${filter.attribute}" expects a non-empty array.`,
      );
    }
    return inArray(
      column,
      filter.value.map((entry) => coerceScalar(filter.attribute, kind, entry)),
    );
  }

  const value = coerceScalar(filter.attribute, kind, filter.value);
  if (filter.operator === "eq") return eq(column, value);
  if (filter.operator === "neq") return ne(column, value);
  if (filter.operator === "gt") return gt(column, value);
  if (filter.operator === "gte") return gte(column, value);
  if (filter.operator === "lt") return lt(column, value);
  return lte(column, value);
}

/**
 * ORDER BY terms for one sort key. The leading `(col is null)` term places
 * empty values last in both dialects — SQLite sorts NULLs first and Postgres
 * sorts them last, and pagination over a page boundary must not depend on that.
 */
export function buildEntryOrder(
  resolver: CrmEntryFieldResolver,
  sort: CrmEntrySort,
): SQL[] {
  const { column } = resolver.resolve(sort.attribute);
  return [
    sql`(${column} is null)`,
    sort.direction === "desc" ? desc(column) : asc(column),
  ];
}

export function decodeCrmCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const value = Number.parseInt(cursor, 10);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function attributeSummary(attribute: CrmListAttribute) {
  return {
    id: attribute.id,
    apiSlug: attribute.apiSlug,
    label: attribute.label,
    description: attribute.description,
    attributeType: attribute.attributeType,
    multi: attribute.multi,
    required: attribute.required,
    position: attribute.position,
    usesOptions: ATTRIBUTE_TYPE_SPECS[attribute.attributeType].usesOptions,
    options: attribute.options,
  };
}
