/**
 * The CRM grid's server-side query: a typed filter/sort tree compiled into one
 * dialect-agnostic Drizzle statement.
 *
 * Two rules shape everything here.
 *
 * 1. A filter that cannot be compiled is an ERROR, never a dropped condition.
 *    Silently ignoring an unknown attribute returns a full unfiltered page that
 *    looks exactly like a correct answer, which is the failure mode the root
 *    CLAUDE.md forbids.
 * 2. Attribute values live in `crm_record_fields`, one bitemporal row per
 *    attribute with `active_until IS NULL` for the current value. Filtering is
 *    therefore EXISTS/NOT EXISTS against that table, and sorting is a correlated
 *    scalar subquery — never `json_extract`, which diverges across dialects.
 */

import { accessFilter } from "@agent-native/core/sharing";
import {
  and,
  eq,
  exists,
  inArray,
  isNull,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";

import {
  ATTRIBUTE_TYPE_SPECS,
  type CrmAttributeType,
} from "../../shared/crm-attributes.js";
import {
  CRM_CURRENT_USER_TOKEN,
  type CrmAccessScope,
  type CrmObjectKind,
} from "../../shared/crm-contract.js";
import {
  createConnectedCrmAdapter,
  isConnectedCrmProvider,
} from "../crm/adapter.js";
import { resolveNativeCrmAccessScope } from "../crm/native-adapter.js";
import {
  parseCrmAccessScope,
  scopesAreCompatible,
} from "../crm/read-through.js";
import { getDb, schema } from "../db/index.js";

const MAX_RECORD_LIMIT = 100;
const MAX_SCOPE_VALIDATIONS = 20;

/** A filter the caller must fix before retrying — surfaces as HTTP 422. */
export class CrmFilterError extends Error {
  readonly statusCode = 422;
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CrmFilterError";
    this.code = code;
  }
}

/** A cursor that does not belong to this query — surfaces as HTTP 400. */
export class CrmCursorError extends Error {
  readonly statusCode = 400;
  readonly code = "crm-cursor-mismatch";

  constructor(message: string) {
    super(message);
    this.name = "CrmCursorError";
  }
}

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

export const CRM_FILTER_CONDITIONS = [
  "is",
  "is-not",
  "contains",
  "not-contains",
  "starts-with",
  "ends-with",
  "is-empty",
  "is-not-empty",
  "=",
  "!=",
  ">",
  ">=",
  "<",
  "<=",
  "between",
  "before",
  "after",
  "is-any-of",
  "is-none-of",
] as const;

export type CrmFilterCondition = (typeof CRM_FILTER_CONDITIONS)[number];

const filterValueSchema = z.union([
  z.string().max(2_000),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string().max(2_000), z.number(), z.boolean()])).max(50),
]);

const leafSchema = z.object({
  /** Attribute id, `api_slug`, or `field_name` on `crm_field_policies`. */
  attributeId: z.string().trim().min(1).max(128).optional(),
  /** A column on `crm_records` — see RECORD_COLUMNS. */
  field: z.string().trim().min(1).max(64).optional(),
  condition: z.enum(CRM_FILTER_CONDITIONS),
  value: filterValueSchema.optional(),
});

const groupSchema = z.object({
  op: z.enum(["and", "or"]).default("and"),
  conditions: z.array(leafSchema).min(1).max(30),
});

/**
 * One level of nesting, spelled out rather than recursive: an unbounded tree is
 * an unbounded number of correlated subqueries in one statement.
 */
export const crmFilterSchema = z.object({
  op: z.enum(["and", "or"]).default("and"),
  conditions: z.array(z.union([groupSchema, leafSchema])).max(30),
});

export const crmSortSchema = z
  .array(
    z.object({
      attributeId: z.string().trim().min(1).max(128).optional(),
      field: z.string().trim().min(1).max(64).optional(),
      direction: z.enum(["asc", "desc"]).default("asc"),
    }),
  )
  .max(4);

export type CrmFilterLeaf = z.infer<typeof leafSchema>;
export type CrmFilterGroup = z.infer<typeof groupSchema>;
export type CrmFilter = z.infer<typeof crmFilterSchema>;
export type CrmSort = z.infer<typeof crmSortSchema>;

/**
 * The tree the compiler walks. Input is capped at one level of nesting by the
 * schema; this shape lets the query builder wrap an already-parsed filter in
 * another group without re-typing it.
 */
export interface CrmFilterNode {
  op: "and" | "or";
  conditions: Array<CrmFilterLeaf | CrmFilterNode>;
}

// ---------------------------------------------------------------------------
// Targets: an attribute value or a `crm_records` column
// ---------------------------------------------------------------------------

/**
 * The condition vocabulary a target accepts. Derived from the attribute-type
 * registry so a new attribute type inherits a family instead of needing a new
 * branch at every call site.
 */
type ConditionFamily =
  | "text"
  | "number"
  | "date"
  | "boolean"
  | "option"
  | "reference"
  | "json";

const FAMILY_CONDITIONS: Record<
  ConditionFamily,
  readonly CrmFilterCondition[]
> = {
  text: [
    "is",
    "is-not",
    "contains",
    "not-contains",
    "starts-with",
    "ends-with",
    "is-empty",
    "is-not-empty",
  ],
  number: [
    "=",
    "!=",
    ">",
    ">=",
    "<",
    "<=",
    "between",
    "is-empty",
    "is-not-empty",
  ],
  date: ["is", "before", "after", "between", "is-empty", "is-not-empty"],
  boolean: ["is"],
  option: ["is", "is-any-of", "is-none-of", "is-empty", "is-not-empty"],
  reference: ["is", "is-any-of", "is-empty", "is-not-empty"],
  json: ["is-empty", "is-not-empty"],
};

function conditionFamily(type: CrmAttributeType): ConditionFamily {
  const spec = ATTRIBUTE_TYPE_SPECS[type];
  if (spec.usesOptions) return "option";
  if (type === "date" || type === "timestamp") return "date";
  if (type === "record-reference" || type === "actor-reference") {
    return "reference";
  }
  if (spec.storageColumn === "numberValue") return "number";
  if (spec.storageColumn === "booleanValue") return "boolean";
  if (spec.storageColumn === "jsonValue") return "json";
  return "text";
}

interface RecordColumnSpec {
  column: SQL;
  family: ConditionFamily;
  /** Compared case-insensitively and eligible for `@currentUser`. */
  actor?: boolean;
}

/**
 * Filterable/sortable columns on `crm_records`. An allow-list, not a lookup by
 * string: an unlisted name is a typed error, so a filter can never reach a
 * column the summary does not expose.
 */
const RECORD_COLUMNS: Record<string, RecordColumnSpec> = {
  displayName: {
    column: sql`${schema.crmRecords.displayName}`,
    family: "text",
  },
  kind: { column: sql`${schema.crmRecords.kind}`, family: "text" },
  objectType: { column: sql`${schema.crmRecords.objectType}`, family: "text" },
  provider: { column: sql`${schema.crmRecords.provider}`, family: "text" },
  connectionId: {
    column: sql`${schema.crmRecords.connectionId}`,
    family: "text",
  },
  primaryEmail: {
    column: sql`${schema.crmRecords.primaryEmail}`,
    family: "text",
  },
  domain: { column: sql`${schema.crmRecords.domain}`, family: "text" },
  stage: { column: sql`${schema.crmRecords.stage}`, family: "text" },
  pipelineName: {
    column: sql`${schema.crmRecords.pipelineName}`,
    family: "text",
  },
  ownerName: { column: sql`${schema.crmRecords.ownerName}`, family: "text" },
  ownerRemoteId: {
    column: sql`${schema.crmRecords.ownerRemoteId}`,
    family: "text",
  },
  ownerEmail: {
    column: sql`${schema.crmRecords.ownerEmail}`,
    family: "text",
    actor: true,
  },
  amount: { column: sql`${schema.crmRecords.amount}`, family: "number" },
  currencyCode: {
    column: sql`${schema.crmRecords.currencyCode}`,
    family: "text",
  },
  desiredCadenceDays: {
    column: sql`${schema.crmRecords.desiredCadenceDays}`,
    family: "number",
  },
  closeDate: { column: sql`${schema.crmRecords.closeDate}`, family: "date" },
  nextContactAt: {
    column: sql`${schema.crmRecords.nextContactAt}`,
    family: "date",
  },
  lastMeaningfulInteractionAt: {
    column: sql`${schema.crmRecords.lastMeaningfulInteractionAt}`,
    family: "date",
  },
  remoteUpdatedAt: {
    column: sql`${schema.crmRecords.remoteUpdatedAt}`,
    family: "date",
  },
  createdAt: { column: sql`${schema.crmRecords.createdAt}`, family: "date" },
  updatedAt: { column: sql`${schema.crmRecords.updatedAt}`, family: "date" },
};

interface ResolvedAttribute {
  id: string;
  apiSlug: string;
  attributeType: CrmAttributeType;
  multi: boolean;
  family: ConditionFamily;
}

type ResolvedTarget =
  | { kind: "attribute"; label: string; attribute: ResolvedAttribute }
  | { kind: "column"; label: string; spec: RecordColumnSpec };

function targetFamily(target: ResolvedTarget): ConditionFamily {
  return target.kind === "attribute"
    ? target.attribute.family
    : target.spec.family;
}

function isActorTarget(target: ResolvedTarget): boolean {
  return target.kind === "attribute"
    ? target.attribute.attributeType === "actor-reference"
    : target.spec.actor === true;
}

// ---------------------------------------------------------------------------
// Attribute resolution — one query for every reference in the tree
// ---------------------------------------------------------------------------

interface AttributeRow {
  id: string;
  fieldName: string;
  apiSlug: string | null;
  attributeType: CrmAttributeType;
  multi: boolean;
  archived: boolean;
}

function collectRefs(node: CrmFilterNode, refs: Set<string>): void {
  for (const entry of node.conditions) {
    if ("conditions" in entry) collectRefs(entry, refs);
    else if (entry.attributeId) refs.add(entry.attributeId);
  }
}

function attributeRefs(
  filter: CrmFilterNode | undefined,
  sort: CrmSort,
): string[] {
  const refs = new Set<string>();
  if (filter) collectRefs(filter, refs);
  for (const entry of sort) {
    if (entry.attributeId) refs.add(entry.attributeId);
  }
  return Array.from(refs);
}

/**
 * Resolve every attribute reference in one pass. A reference may name the
 * attribute id, its `api_slug`, or its legacy `field_name`; unknown, archived,
 * and ambiguous references are all typed errors that name the reference.
 */
async function resolveAttributes(
  refs: string[],
): Promise<Map<string, ResolvedAttribute>> {
  const resolved = new Map<string, ResolvedAttribute>();
  if (refs.length === 0) return resolved;

  const rows: AttributeRow[] = await getDb()
    .select({
      id: schema.crmFieldPolicies.id,
      fieldName: schema.crmFieldPolicies.fieldName,
      apiSlug: schema.crmFieldPolicies.apiSlug,
      attributeType: schema.crmFieldPolicies.attributeType,
      multi: schema.crmFieldPolicies.multi,
      archived: schema.crmFieldPolicies.archived,
    })
    .from(schema.crmFieldPolicies)
    .where(
      and(
        or(
          inArray(schema.crmFieldPolicies.id, refs),
          inArray(schema.crmFieldPolicies.apiSlug, refs),
          inArray(schema.crmFieldPolicies.fieldName, refs),
        ),
        accessFilter(schema.crmFieldPolicies, schema.crmFieldPolicyShares),
      ),
    );

  for (const ref of refs) {
    const matches = rows.filter(
      (row) => row.id === ref || row.apiSlug === ref || row.fieldName === ref,
    );
    if (matches.length === 0) {
      throw new CrmFilterError(
        "crm-filter-unknown-attribute",
        `Filter references unknown attribute "${ref}".`,
      );
    }
    const live = matches.filter((row) => !row.archived);
    if (live.length === 0) {
      throw new CrmFilterError(
        "crm-filter-archived-attribute",
        `Filter references archived attribute "${ref}".`,
      );
    }
    // The same slug can exist on several objects/connections. That is fine as
    // long as they agree on how the value is stored — the predicate keys on the
    // slug, not on one row's id.
    const shapes = new Set(
      live.map((row) => `${row.attributeType}:${row.multi ? 1 : 0}`),
    );
    if (shapes.size > 1) {
      throw new CrmFilterError(
        "crm-filter-ambiguous-attribute",
        `Attribute "${ref}" resolves to more than one attribute type; filter by attribute id instead.`,
      );
    }
    const first = live[0]!;
    resolved.set(ref, {
      id: first.id,
      apiSlug: first.apiSlug ?? first.fieldName,
      attributeType: first.attributeType,
      multi: first.multi,
      family: conditionFamily(first.attributeType),
    });
  }
  return resolved;
}

function resolveTarget(
  ref: { attributeId?: string; field?: string },
  attributes: Map<string, ResolvedAttribute>,
): ResolvedTarget {
  if (ref.attributeId && ref.field) {
    throw new CrmFilterError(
      "crm-filter-target",
      `Filter entry sets both attributeId "${ref.attributeId}" and field "${ref.field}"; pick one.`,
    );
  }
  if (ref.attributeId) {
    const attribute = attributes.get(ref.attributeId);
    if (!attribute) {
      throw new CrmFilterError(
        "crm-filter-unknown-attribute",
        `Filter references unknown attribute "${ref.attributeId}".`,
      );
    }
    return { kind: "attribute", label: ref.attributeId, attribute };
  }
  if (ref.field) {
    const spec = RECORD_COLUMNS[ref.field];
    if (!spec) {
      throw new CrmFilterError(
        "crm-filter-unknown-field",
        `Filter references unknown record field "${ref.field}". Known fields: ${Object.keys(
          RECORD_COLUMNS,
        ).join(", ")}.`,
      );
    }
    return { kind: "column", label: ref.field, spec };
  }
  throw new CrmFilterError(
    "crm-filter-target",
    "Every filter and sort entry needs either an attributeId or a field.",
  );
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

type Scalar = string | number | boolean;

/**
 * `@currentUser` is resolved here and nowhere else. Resolving it on the client
 * would make one shared view render the author's rows for everybody.
 */
function resolveToken(
  value: Scalar,
  target: ResolvedTarget,
  actorEmail: string | null,
): Scalar {
  if (value !== CRM_CURRENT_USER_TOKEN) return value;
  if (!isActorTarget(target)) {
    throw new CrmFilterError(
      "crm-filter-current-user-target",
      `"${CRM_CURRENT_USER_TOKEN}" only resolves on an actor-reference attribute or an owner field, not on "${target.label}".`,
    );
  }
  if (!actorEmail) {
    throw new CrmFilterError(
      "crm-filter-no-actor",
      `"${CRM_CURRENT_USER_TOKEN}" cannot be resolved without a signed-in caller.`,
    );
  }
  return actorEmail.toLowerCase();
}

function requireValue(
  leaf: CrmFilterLeaf,
  target: ResolvedTarget,
  actorEmail: string | null,
): Scalar {
  const value = leaf.value;
  if (value === undefined || value === null || Array.isArray(value)) {
    throw new CrmFilterError(
      "crm-filter-value",
      `Condition "${leaf.condition}" on "${target.label}" needs a single value.`,
    );
  }
  return resolveToken(value, target, actorEmail);
}

function requireValues(
  leaf: CrmFilterLeaf,
  target: ResolvedTarget,
  actorEmail: string | null,
): Scalar[] {
  const value = leaf.value;
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  if (list.length === 0) {
    throw new CrmFilterError(
      "crm-filter-value",
      `Condition "${leaf.condition}" on "${target.label}" needs at least one value.`,
    );
  }
  return list.map((entry) => resolveToken(entry, target, actorEmail));
}

function requireRange(
  leaf: CrmFilterLeaf,
  target: ResolvedTarget,
): [Scalar, Scalar] {
  const value = leaf.value;
  if (!Array.isArray(value) || value.length !== 2) {
    throw new CrmFilterError(
      "crm-filter-value",
      `Condition "between" on "${target.label}" needs a two-element [from, to] value.`,
    );
  }
  return [value[0]!, value[1]!];
}

function requireNumber(value: Scalar, target: ResolvedTarget): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new CrmFilterError(
      "crm-filter-value",
      `"${target.label}" is numeric; "${String(value)}" is not a number.`,
    );
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Relative dates
//
// Boundaries are emitted as bare `YYYY-MM-DD`, which compares correctly against
// both a `date` value ("2026-07-26") and a `timestamp` value
// ("2026-07-26T13:00:00.000Z") under lexicographic ordering. Days are UTC: the
// server has no caller timezone, and inventing one would silently shift every
// "today" filter for half the world.
// ---------------------------------------------------------------------------

const RELATIVE_DAYS = /^(last|next)-(\d{1,3})-days$/;

function isoDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

const DAY_MS = 86_400_000;

export function resolveRelativeDateToken(
  token: string,
  now: Date,
): { from: string; to: string } | null {
  const startOfDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  if (token === "today") {
    return { from: isoDay(startOfDay), to: isoDay(startOfDay + DAY_MS) };
  }
  if (token === "this-week") {
    // ISO weeks start Monday; getUTCDay() is 0 for Sunday.
    const weekday = (new Date(startOfDay).getUTCDay() + 6) % 7;
    const start = startOfDay - weekday * DAY_MS;
    return { from: isoDay(start), to: isoDay(start + 7 * DAY_MS) };
  }
  const match = RELATIVE_DAYS.exec(token);
  if (!match) return null;
  const days = Number.parseInt(match[2]!, 10);
  if (days < 1) {
    throw new CrmFilterError(
      "crm-filter-value",
      `Relative date "${token}" needs a positive day count.`,
    );
  }
  return match[1] === "last"
    ? {
        from: isoDay(startOfDay - (days - 1) * DAY_MS),
        to: isoDay(startOfDay + DAY_MS),
      }
    : { from: isoDay(startOfDay), to: isoDay(startOfDay + days * DAY_MS) };
}

// ---------------------------------------------------------------------------
// Predicate compilation
// ---------------------------------------------------------------------------

function likePattern(value: Scalar, mode: "contains" | "prefix" | "suffix") {
  const escaped = String(value).replace(/([\\%_])/g, "\\$1");
  if (mode === "prefix") return `${escaped}%`;
  if (mode === "suffix") return `%${escaped}`;
  return `%${escaped}%`;
}

// LIKE is case-insensitive in SQLite and case-sensitive in PostgreSQL. Lowering
// both sides is the only portable way to make "contains" mean the same thing.
function likeSql(column: SQL, pattern: string): SQL {
  return sql`lower(${column}) like lower(${pattern}) escape '\\'`;
}

/**
 * Membership in a multi-valued attribute, whose set is stored as one canonical
 * JSON array in `json_value`.
 *
 * The delimiters matter: an element is JSON-encoded, so its own quotes are
 * escaped as `\"`. Searching for `,"acme",` (with the surrounding separator)
 * therefore cannot match inside another element, while a bare `%"acme"%` could.
 *
 * ponytail: a text scan, not an index probe. Fine at CRM row counts; if a
 * workspace ever filters millions of rows on a multi attribute, normalize the
 * set into its own value rows instead of widening this.
 */
function jsonArrayContains(value: Scalar): SQL {
  const encoded = JSON.stringify(String(value));
  const column = sql`${schema.crmRecordFields.jsonValue}`;
  return or(
    likeSql(column, likePattern(`[${encoded},`, "contains")),
    likeSql(column, likePattern(`,${encoded},`, "contains")),
    likeSql(column, likePattern(`,${encoded}]`, "contains")),
    likeSql(column, likePattern(`[${encoded}]`, "contains")),
  )!;
}

/** The `crm_record_fields` column a target's values live in. */
function valueColumnFor(attribute: ResolvedAttribute): SQL {
  if (attribute.multi) return sql`${schema.crmRecordFields.jsonValue}`;
  const storage = ATTRIBUTE_TYPE_SPECS[attribute.attributeType].storageColumn;
  if (storage === "numberValue")
    return sql`${schema.crmRecordFields.numberValue}`;
  if (storage === "booleanValue") {
    return sql`${schema.crmRecordFields.booleanValue}`;
  }
  if (storage === "jsonValue") return sql`${schema.crmRecordFields.jsonValue}`;
  return sql`${schema.crmRecordFields.stringValue}`;
}

function assertConditionSupported(
  target: ResolvedTarget,
  condition: CrmFilterCondition,
): void {
  const family = targetFamily(target);
  if (!FAMILY_CONDITIONS[family].includes(condition)) {
    throw new CrmFilterError(
      "crm-filter-condition",
      `Condition "${condition}" is not available on "${target.label}" (${family}). Available: ${FAMILY_CONDITIONS[
        family
      ].join(", ")}.`,
    );
  }
  if (
    target.kind === "attribute" &&
    target.attribute.multi &&
    !MULTI_CONDITIONS.includes(condition)
  ) {
    throw new CrmFilterError(
      "crm-filter-multi-condition",
      `"${target.label}" is multi-valued; condition "${condition}" would compare against the whole set. Available: ${MULTI_CONDITIONS.join(", ")}.`,
    );
  }
}

const MULTI_CONDITIONS: readonly CrmFilterCondition[] = [
  "is",
  "is-not",
  "is-any-of",
  "is-none-of",
  "is-empty",
  "is-not-empty",
];

interface CompileContext {
  attributes: Map<string, ResolvedAttribute>;
  actorEmail: string | null;
  now: Date;
}

/**
 * A positive predicate over one value column, plus whether the caller must
 * negate the surrounding EXISTS. `is-not` means "has no such value", which
 * includes records that have no value at all — so it is NOT EXISTS of the
 * positive test, not EXISTS of an inequality.
 */
interface Predicate {
  sql: SQL;
  negate: boolean;
}

function comparePredicate(
  column: SQL,
  target: ResolvedTarget,
  leaf: CrmFilterLeaf,
  ctx: CompileContext,
): Predicate {
  const family = targetFamily(target);
  const condition = leaf.condition;
  const multi = target.kind === "attribute" ? target.attribute.multi : false;

  if (condition === "is-empty") {
    return { sql: sql`${column} is not null`, negate: true };
  }
  if (condition === "is-not-empty") {
    return { sql: sql`${column} is not null`, negate: false };
  }

  if (multi) {
    if (condition === "is" || condition === "is-not") {
      const value = requireValue(leaf, target, ctx.actorEmail);
      return { sql: jsonArrayContains(value), negate: condition === "is-not" };
    }
    const values = requireValues(leaf, target, ctx.actorEmail);
    return {
      sql: or(...values.map((value) => jsonArrayContains(value)))!,
      negate: condition === "is-none-of",
    };
  }

  if (family === "boolean") {
    const value = requireValue(leaf, target, ctx.actorEmail);
    const wanted =
      typeof value === "boolean" ? value : value === "true" || value === 1;
    // `portableBoolean` is an INTEGER column in both dialects, and a raw `sql`
    // fragment bypasses the column codec that would have converted this.
    return { sql: sql`${column} = ${wanted ? 1 : 0}`, negate: false };
  }

  if (family === "number") {
    if (condition === "between") {
      const [from, to] = requireRange(leaf, target);
      return {
        sql: and(
          sql`${column} >= ${requireNumber(from, target)}`,
          sql`${column} <= ${requireNumber(to, target)}`,
        )!,
        negate: false,
      };
    }
    const value = requireNumber(
      requireValue(leaf, target, ctx.actorEmail),
      target,
    );
    if (condition === "=")
      return { sql: sql`${column} = ${value}`, negate: false };
    if (condition === "!=")
      return { sql: sql`${column} = ${value}`, negate: true };
    if (condition === ">")
      return { sql: sql`${column} > ${value}`, negate: false };
    if (condition === ">=")
      return { sql: sql`${column} >= ${value}`, negate: false };
    if (condition === "<")
      return { sql: sql`${column} < ${value}`, negate: false };
    return { sql: sql`${column} <= ${value}`, negate: false };
  }

  if (family === "date") {
    return datePredicate(column, target, leaf, ctx);
  }

  // text / option / reference
  if (condition === "is" || condition === "is-not") {
    const value = requireValue(leaf, target, ctx.actorEmail);
    return {
      sql: isActorTarget(target)
        ? sql`lower(${column}) = lower(${String(value)})`
        : sql`${column} = ${value}`,
      negate: condition === "is-not",
    };
  }
  if (condition === "is-any-of" || condition === "is-none-of") {
    const values = requireValues(leaf, target, ctx.actorEmail);
    const comparisons = values.map((value) =>
      isActorTarget(target)
        ? sql`lower(${column}) = lower(${String(value)})`
        : sql`${column} = ${value}`,
    );
    return { sql: or(...comparisons)!, negate: condition === "is-none-of" };
  }
  const value = requireValue(leaf, target, ctx.actorEmail);
  if (condition === "starts-with") {
    return {
      sql: likeSql(column, likePattern(value, "prefix")),
      negate: false,
    };
  }
  if (condition === "ends-with") {
    return {
      sql: likeSql(column, likePattern(value, "suffix")),
      negate: false,
    };
  }
  return {
    sql: likeSql(column, likePattern(value, "contains")),
    negate: condition === "not-contains",
  };
}

function datePredicate(
  column: SQL,
  target: ResolvedTarget,
  leaf: CrmFilterLeaf,
  ctx: CompileContext,
): Predicate {
  const condition = leaf.condition;
  if (condition === "between") {
    const [from, to] = requireRange(leaf, target);
    const range = resolveRelativeDateToken(String(from), ctx.now);
    if (range) {
      return {
        sql: and(
          sql`${column} >= ${range.from}`,
          sql`${column} < ${range.to}`,
        )!,
        negate: false,
      };
    }
    return {
      sql: and(
        sql`${column} >= ${String(from)}`,
        sql`${column} <= ${String(to)}`,
      )!,
      negate: false,
    };
  }
  const raw = String(requireValue(leaf, target, ctx.actorEmail));
  const range = resolveRelativeDateToken(raw, ctx.now);
  if (range) {
    if (condition === "before") {
      return { sql: sql`${column} < ${range.from}`, negate: false };
    }
    if (condition === "after") {
      return { sql: sql`${column} >= ${range.to}`, negate: false };
    }
    return {
      sql: and(sql`${column} >= ${range.from}`, sql`${column} < ${range.to}`)!,
      negate: false,
    };
  }
  if (condition === "before")
    return { sql: sql`${column} < ${raw}`, negate: false };
  if (condition === "after")
    return { sql: sql`${column} > ${raw}`, negate: false };
  return { sql: sql`${column} = ${raw}`, negate: false };
}

/** Correlated current-value rows for one attribute of the outer record. */
function currentValueRows(attribute: ResolvedAttribute, predicate?: SQL) {
  const conditions = [
    eq(schema.crmRecordFields.recordId, schema.crmRecords.id),
    isNull(schema.crmRecordFields.entryId),
    eq(schema.crmRecordFields.fieldName, attribute.apiSlug),
    isNull(schema.crmRecordFields.activeUntil),
    accessFilter(schema.crmRecordFields, schema.crmRecordFieldShares),
  ];
  if (predicate) conditions.push(predicate);
  return getDb()
    .select({ id: schema.crmRecordFields.id })
    .from(schema.crmRecordFields)
    .where(and(...conditions));
}

function compileLeaf(leaf: CrmFilterLeaf, ctx: CompileContext): SQL {
  const target = resolveTarget(leaf, ctx.attributes);
  assertConditionSupported(target, leaf.condition);

  if (target.kind === "column") {
    const predicate = comparePredicate(target.spec.column, target, leaf, ctx);
    return predicate.negate ? sql`not (${predicate.sql})` : predicate.sql;
  }

  const column = valueColumnFor(target.attribute);
  const predicate = comparePredicate(column, target, leaf, ctx);
  const rows = currentValueRows(target.attribute, predicate.sql);
  return predicate.negate ? notExists(rows) : exists(rows);
}

function compileNode(
  node: CrmFilterNode,
  ctx: CompileContext,
): SQL | undefined {
  const parts = node.conditions.map((entry) =>
    "conditions" in entry ? compileNode(entry, ctx) : compileLeaf(entry, ctx),
  );
  const kept = parts.filter((part): part is SQL => part !== undefined);
  if (kept.length === 0) return undefined;
  return node.op === "or" ? or(...kept)! : and(...kept)!;
}

export async function compileCrmFilter(input: {
  filter: CrmFilter;
  actorEmail: string | null;
  now?: Date;
}): Promise<SQL | undefined> {
  const attributes = await resolveAttributes(attributeRefs(input.filter, []));
  return compileNode(input.filter, {
    attributes,
    actorEmail: input.actorEmail,
    now: input.now ?? new Date(),
  });
}

// ---------------------------------------------------------------------------
// Sorting and keyset pagination
// ---------------------------------------------------------------------------

interface SortKey {
  expression: SQL;
  direction: "asc" | "desc";
}

interface CursorPayload {
  f: string;
  v: Array<string | number | boolean | null>;
  id: string;
}

function fingerprint(value: unknown): string {
  const text = JSON.stringify(value) ?? "";
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function decodeCursor(cursor: string, expected: string): CursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(cursor) as unknown;
  } catch {
    throw new CrmCursorError("CRM list cursor is not readable.");
  }
  const payload = parsed as Partial<CursorPayload>;
  if (
    !payload ||
    typeof payload.id !== "string" ||
    !Array.isArray(payload.v) ||
    typeof payload.f !== "string"
  ) {
    throw new CrmCursorError("CRM list cursor is not readable.");
  }
  if (payload.f !== expected) {
    throw new CrmCursorError(
      "CRM list cursor belongs to a different filter or sort. Restart the list without a cursor.",
    );
  }
  return payload as CursorPayload;
}

/**
 * "Strictly after the cursor" under NULLS LAST ordering, expanded
 * lexicographically over the sort keys with the record id as the final,
 * always-ascending tiebreak. Without that tiebreak two rows with equal sort
 * values could swap between pages and be skipped or repeated.
 */
function keysetPredicate(
  keys: SortKey[],
  cursor: CursorPayload,
): SQL | undefined {
  let predicate: SQL = sql`${schema.crmRecords.id} > ${cursor.id}`;
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    const key = keys[index]!;
    const value = cursor.v[index] ?? null;
    const equal =
      value === null
        ? sql`${key.expression} is null`
        : sql`${key.expression} = ${value}`;
    // NULLs sort last, so nothing follows a null on this key: only the later
    // keys can still order two rows apart.
    const after =
      value === null
        ? undefined
        : key.direction === "asc"
          ? sql`(${key.expression} is null or ${key.expression} > ${value})`
          : sql`(${key.expression} is null or ${key.expression} < ${value})`;
    const tail = and(equal, predicate)!;
    predicate = after ? or(after, tail)! : tail;
  }
  return predicate;
}

function orderByFor(keys: SortKey[]): SQL[] {
  const clauses: SQL[] = [];
  for (const key of keys) {
    // Explicit null rank: SQLite orders NULLs first, PostgreSQL orders them
    // last. Neither default is portable, so rank them by hand.
    clauses.push(
      sql`case when ${key.expression} is null then 1 else 0 end asc`,
    );
    clauses.push(
      key.direction === "asc"
        ? sql`${key.expression} asc`
        : sql`${key.expression} desc`,
    );
  }
  clauses.push(sql`${schema.crmRecords.id} asc`);
  return clauses;
}

// ---------------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------------

export interface StoredCrmView {
  id: string;
  name: string;
  description: string;
  kind: string | null;
  viewKind: "table" | "board";
  targetKind: "object" | "list";
  targetId: string | null;
  groupByAttributeId: string | null;
  filter: CrmFilter;
  sort: CrmSort;
  columns: Array<{ attributeId: string; width?: number; hidden?: boolean }>;
  dataProgramId: string | null;
  pinned: boolean;
  audience: "personal" | "shared";
  updatedAt: string;
}

/**
 * Views saved before typed filters stored `{query, fieldEquals}`. Translate them
 * at the boundary so the rest of the pipeline only ever sees one filter shape.
 */
export function normalizeStoredFilter(raw: unknown): CrmFilter {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { op: "and", conditions: [] };
  }
  const value = raw as Record<string, unknown>;
  if (Array.isArray(value.conditions)) {
    const parsed = crmFilterSchema.safeParse(value);
    if (!parsed.success) {
      throw new CrmFilterError(
        "crm-filter-stored",
        `Saved view filter is not readable: ${parsed.error.issues[0]?.message ?? "invalid"}.`,
      );
    }
    return parsed.data;
  }
  const conditions: CrmFilterLeaf[] = [];
  if (typeof value.query === "string" && value.query.trim()) {
    conditions.push({
      field: "displayName",
      condition: "contains",
      value: value.query.trim(),
    });
  }
  const fieldEquals = value.fieldEquals;
  if (
    fieldEquals &&
    typeof fieldEquals === "object" &&
    !Array.isArray(fieldEquals)
  ) {
    for (const [name, entry] of Object.entries(
      fieldEquals as Record<string, unknown>,
    )) {
      if (
        typeof entry !== "string" &&
        typeof entry !== "number" &&
        typeof entry !== "boolean"
      ) {
        throw new CrmFilterError(
          "crm-filter-stored",
          `Saved view filter on "${name}" is not a comparable value.`,
        );
      }
      conditions.push({ attributeId: name, condition: "is", value: entry });
    }
  }
  const unknownKeys = Object.keys(value).filter(
    (key) => key !== "query" && key !== "fieldEquals" && key !== "op",
  );
  if (unknownKeys.length > 0) {
    throw new CrmFilterError(
      "crm-filter-stored",
      `Saved view filter has unsupported keys: ${unknownKeys.join(", ")}.`,
    );
  }
  return { op: "and", conditions };
}

export function normalizeStoredColumns(
  raw: unknown,
): Array<{ attributeId: string; width?: number; hidden?: boolean }> {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry === "string") return [{ attributeId: entry }];
    if (!entry || typeof entry !== "object") return [];
    const value = entry as Record<string, unknown>;
    const attributeId = value.attributeId;
    if (typeof attributeId !== "string" || !attributeId) return [];
    return [
      {
        attributeId,
        ...(typeof value.width === "number" ? { width: value.width } : {}),
        ...(typeof value.hidden === "boolean" ? { hidden: value.hidden } : {}),
      },
    ];
  });
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new CrmFilterError(
      "crm-filter-stored",
      `Saved view ${label} is not valid JSON.`,
    );
  }
}

export async function loadCrmSavedView(viewId: string): Promise<StoredCrmView> {
  const [row] = await getDb()
    .select()
    .from(schema.crmSavedViews)
    .where(
      and(
        eq(schema.crmSavedViews.id, viewId),
        accessFilter(schema.crmSavedViews, schema.crmSavedViewShares),
      ),
    )
    .limit(1);
  if (!row) throw new Error("CRM saved view was not found.");
  return hydrateSavedViewRow(row);
}

export function hydrateSavedViewRow(row: {
  id: string;
  name: string;
  description: string;
  kind: string | null;
  viewKind: "table" | "board";
  targetKind: "object" | "list";
  targetId: string | null;
  groupByAttributeId: string | null;
  filtersJson: string;
  columnsJson: string;
  sortJson: string;
  dataProgramId: string | null;
  pinned: boolean;
  visibility: string;
  updatedAt: string;
}): StoredCrmView {
  const sort = crmSortSchema.safeParse(
    normalizeStoredSort(parseJson(row.sortJson, "sort")),
  );
  if (!sort.success) {
    throw new CrmFilterError(
      "crm-filter-stored",
      `Saved view sort is not readable: ${sort.error.issues[0]?.message ?? "invalid"}.`,
    );
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    kind: row.kind,
    viewKind: row.viewKind,
    targetKind: row.targetKind,
    targetId: row.targetId,
    groupByAttributeId: row.groupByAttributeId,
    filter: normalizeStoredFilter(parseJson(row.filtersJson, "filters")),
    sort: sort.data,
    columns: normalizeStoredColumns(parseJson(row.columnsJson, "columns")),
    dataProgramId: row.dataProgramId,
    pinned: row.pinned,
    audience: row.visibility === "private" ? "personal" : "shared",
    updatedAt: row.updatedAt,
  };
}

/** Legacy sort entries used `{field}` for record columns; that still parses. */
function normalizeStoredSort(raw: unknown): unknown {
  return Array.isArray(raw) ? raw : [];
}

// ---------------------------------------------------------------------------
// The query
// ---------------------------------------------------------------------------

type ScopeValidationTarget = {
  connectionId: string;
  workspaceConnectionId: string | null;
  provider: string;
  objectType: string;
};

export type CrmScopeResolver = (
  target: ScopeValidationTarget,
) => Promise<CrmAccessScope | null>;

async function defaultScopeResolver(
  target: ScopeValidationTarget,
): Promise<CrmAccessScope | null> {
  if (target.provider === "native") {
    return resolveNativeCrmAccessScope({
      connectionId: target.connectionId,
      objectType: target.objectType,
    });
  }
  if (
    !isConnectedCrmProvider(target.provider) ||
    !target.workspaceConnectionId
  ) {
    return null;
  }
  const adapter = await createConnectedCrmAdapter({
    provider: target.provider,
    connectionId: target.workspaceConnectionId,
  });
  return adapter.getAccessScope(target.objectType);
}

const SUMMARY_COLUMNS = new Set([
  "displayName",
  "primaryEmail",
  "domain",
  "stage",
  "ownerName",
  "nextContactAt",
  "remoteUpdatedAt",
  "updatedAt",
]);

interface SummaryRow {
  id: string;
  displayName: string;
  kind: string;
  primaryEmail: string | null;
  domain: string | null;
  stage: string | null;
  ownerName: string | null;
  nextContactAt: string | null;
  remoteUpdatedAt: string | null;
  updatedAt: string;
  remoteRevision: string | null;
}

function toRecordSummary(row: SummaryRow, columns?: string[]) {
  const included = columns?.length ? new Set(columns) : SUMMARY_COLUMNS;
  return {
    id: row.id,
    displayName: row.displayName,
    kind: row.kind,
    // Not a display column: it is the concurrency token every write needs, so
    // a view's column selection must never drop it.
    remoteRevision: row.remoteRevision,
    ...(included.has("domain") || included.has("primaryEmail")
      ? { subtitle: row.domain ?? row.primaryEmail ?? undefined }
      : {}),
    ...(included.has("ownerName") ? { owner: row.ownerName ?? undefined } : {}),
    ...(included.has("stage") ? { stage: row.stage ?? undefined } : {}),
    ...(included.has("nextContactAt")
      ? { nextStep: row.nextContactAt ?? undefined }
      : {}),
    ...(included.has("remoteUpdatedAt") || included.has("updatedAt")
      ? { updatedAt: row.remoteUpdatedAt ?? row.updatedAt }
      : {}),
  };
}

export interface QueryCrmRecordsInput {
  kind?: CrmObjectKind;
  connectionId?: string;
  /** Display-name substring; sugar for a `displayName contains` condition. */
  query?: string;
  viewId?: string;
  filter?: CrmFilter;
  sort?: CrmSort;
  limit: number;
  cursor?: string;
  includeTotal?: boolean;
}

export interface QueryCrmRecordsOptions {
  resolveScope?: CrmScopeResolver;
  actorEmail?: string | null;
  now?: Date;
}

export async function queryCrmRecords(
  input: QueryCrmRecordsInput,
  options: QueryCrmRecordsOptions = {},
) {
  const db = getDb();
  const limit = Math.min(Math.max(input.limit, 1), MAX_RECORD_LIMIT);
  const now = options.now ?? new Date();

  if (input.viewId && input.filter) {
    throw new CrmFilterError(
      "crm-filter-conflict",
      "Pass either viewId or an inline filter, not both — a saved view owns its filter.",
    );
  }

  const view = input.viewId ? await loadCrmSavedView(input.viewId) : undefined;
  if (input.kind && view?.kind && input.kind !== view.kind) {
    throw new CrmFilterError(
      "crm-filter-conflict",
      "CRM saved view kind cannot be overridden.",
    );
  }

  const base: CrmFilterNode = view?.filter ??
    input.filter ?? { op: "and", conditions: [] };
  // A `query` NARROWS whatever it is combined with. Appending it to an
  // or-rooted filter would widen the result set instead, so an or-root is
  // wrapped as a group under a new and-root.
  const search: CrmFilterLeaf | undefined = input.query
    ? { field: "displayName", condition: "contains", value: input.query }
    : undefined;
  const rootFilter: CrmFilterNode = !search
    ? base
    : base.op === "or" && base.conditions.length > 0
      ? { op: "and", conditions: [base, search] }
      : { op: "and", conditions: [...base.conditions, search] };

  const sort = view?.sort?.length ? view.sort : (input.sort ?? []);
  const attributes = await resolveAttributes(attributeRefs(rootFilter, sort));
  const ctx: CompileContext = {
    attributes,
    actorEmail: options.actorEmail ?? null,
    now,
  };

  const conditions = [
    accessFilter(schema.crmRecords, schema.crmRecordShares),
    accessFilter(schema.crmConnections, schema.crmConnectionShares),
    eq(schema.crmRecords.tombstone, false),
  ];
  const kind = (view?.kind as CrmObjectKind | undefined) ?? input.kind;
  if (kind) conditions.push(eq(schema.crmRecords.kind, kind));
  if (input.connectionId) {
    conditions.push(eq(schema.crmRecords.connectionId, input.connectionId));
  }
  const compiled = compileNode(rootFilter, ctx);
  if (compiled) conditions.push(compiled);

  const keys: SortKey[] = sort.map((entry) => ({
    expression: sortKeyExpression(entry, attributes),
    direction: entry.direction,
  }));

  const shape = fingerprint({
    kind: kind ?? null,
    connectionId: input.connectionId ?? null,
    viewId: input.viewId ?? null,
    filter: rootFilter,
    sort,
    actor: options.actorEmail ?? null,
  });
  const pageConditions = [...conditions];
  if (input.cursor) {
    const cursor = decodeCursor(input.cursor, shape);
    const predicate = keysetPredicate(keys, cursor);
    if (predicate) pageConditions.push(predicate);
  }

  const selection: Record<string, unknown> = {
    id: schema.crmRecords.id,
    displayName: schema.crmRecords.displayName,
    kind: schema.crmRecords.kind,
    primaryEmail: schema.crmRecords.primaryEmail,
    domain: schema.crmRecords.domain,
    stage: schema.crmRecords.stage,
    ownerName: schema.crmRecords.ownerName,
    nextContactAt: schema.crmRecords.nextContactAt,
    remoteUpdatedAt: schema.crmRecords.remoteUpdatedAt,
    updatedAt: schema.crmRecords.updatedAt,
    remoteRevision: schema.crmRecords.remoteRevision,
    connectionId: schema.crmRecords.connectionId,
    objectType: schema.crmRecords.objectType,
    provider: schema.crmRecords.provider,
    accessScopeJson: schema.crmRecords.accessScopeJson,
    workspaceConnectionId: schema.crmConnections.workspaceConnectionId,
  };
  keys.forEach((key, index) => {
    selection[`sortKey${index}`] = key.expression.as(`sort_key_${index}`);
  });

  const rows = (await db
    .select(selection as never)
    .from(schema.crmRecords)
    .innerJoin(
      schema.crmConnections,
      eq(schema.crmRecords.connectionId, schema.crmConnections.id),
    )
    .where(and(...pageConditions))
    .orderBy(...orderByFor(keys))
    .limit(limit + 1)) as unknown as Array<
    SummaryRow & {
      connectionId: string;
      objectType: string;
      provider: string;
      accessScopeJson: string;
      workspaceConnectionId: string | null;
    } & Record<string, unknown>
  >;

  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last
      ? JSON.stringify({
          f: shape,
          v: keys.map((_, index) =>
            normalizeCursorValue(last[`sortKey${index}`]),
          ),
          id: last.id,
        } satisfies CursorPayload)
      : undefined;

  const resolveScope = options.resolveScope ?? defaultScopeResolver;
  const scopeTargets = Array.from(
    new Map(
      pageRows.map((row) => [
        `${row.connectionId}:${row.objectType}`,
        {
          connectionId: row.connectionId,
          workspaceConnectionId: row.workspaceConnectionId,
          provider: row.provider,
          objectType: row.objectType,
        },
      ]),
    ).values(),
  ).slice(0, MAX_SCOPE_VALIDATIONS);
  const currentScopes = new Map(
    await Promise.all(
      scopeTargets.map(
        async (target) =>
          [
            `${target.connectionId}:${target.objectType}`,
            await resolveScope(target).catch(() => null),
          ] as const,
      ),
    ),
  );

  const columnNames = view?.columns.map((column) => column.attributeId);
  const records = pageRows
    .filter((row) => {
      const current = currentScopes.get(
        `${row.connectionId}:${row.objectType}`,
      );
      return Boolean(
        current &&
        scopesAreCompatible(parseCrmAccessScope(row.accessScopeJson), current),
      );
    })
    .map((row) => toRecordSummary(row, columnNames));

  let totalEstimate: number | undefined;
  if (input.includeTotal) {
    const [count] = await db
      .select({ total: sql<number>`count(*)` })
      .from(schema.crmRecords)
      .innerJoin(
        schema.crmConnections,
        eq(schema.crmRecords.connectionId, schema.crmConnections.id),
      )
      .where(and(...conditions));
    totalEstimate = Number(count?.total ?? 0);
  }

  return {
    records,
    nextCursor,
    complete: !hasMore,
    ...(totalEstimate === undefined ? {} : { totalEstimate }),
    ...(view
      ? {
          appliedView: {
            id: view.id,
            name: view.name,
            viewKind: view.viewKind,
            ...(view.kind ? { kind: view.kind } : {}),
            ...(view.dataProgramId
              ? { dataProgramId: view.dataProgramId }
              : {}),
            ...(view.groupByAttributeId
              ? { groupByAttributeId: view.groupByAttributeId }
              : {}),
            filter: view.filter,
            sort: view.sort,
            columns: view.columns,
          },
        }
      : {}),
  };
}

function normalizeCursorValue(
  value: unknown,
): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  // A sort key that is not a comparable scalar cannot be resumed from; failing
  // here beats emitting a cursor that silently reorders the next page.
  throw new CrmCursorError(
    "CRM list sort key is not a comparable value; remove it from the sort.",
  );
}

function sortKeyExpression(
  entry: CrmSort[number],
  attributes: Map<string, ResolvedAttribute>,
): SQL {
  const target = resolveTarget(entry, attributes);
  if (target.kind === "column") return target.spec.column;
  if (target.attribute.multi) {
    throw new CrmFilterError(
      "crm-filter-sort",
      `"${target.label}" is multi-valued and has no single sortable value.`,
    );
  }
  const column = valueColumnFor(target.attribute);
  // A record has at most one current row per attribute (the partial unique
  // index enforces it); LIMIT 1 keeps PostgreSQL from erroring if that ever
  // slips rather than failing the whole page.
  const subquery = getDb()
    .select({ value: sql`${column}`.as("value") })
    .from(schema.crmRecordFields)
    .where(
      and(
        eq(schema.crmRecordFields.recordId, schema.crmRecords.id),
        isNull(schema.crmRecordFields.entryId),
        eq(schema.crmRecordFields.fieldName, target.attribute.apiSlug),
        isNull(schema.crmRecordFields.activeUntil),
        accessFilter(schema.crmRecordFields, schema.crmRecordFieldShares),
      ),
    )
    .limit(1);
  return sql`${subquery}`;
}
