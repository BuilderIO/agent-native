/**
 * Translates a saved view's filter tree into the vocabulary
 * `list-crm-list-entries` speaks.
 *
 * The two surfaces were built against different dialects: records are filtered
 * with `{op, conditions:[{attributeId|field, condition, value}]}`, entries with
 * a flat `[{attribute, operator, value}]`. Anything this translator cannot
 * express is thrown, never dropped — a list board that quietly ignored half a
 * saved filter would render a full pipeline that looks exactly like a correct
 * filtered one.
 */

export class BoardFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardFilterError";
  }
}

export type EntryFilterOperator =
  | "eq"
  | "neq"
  | "contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "is-empty"
  | "is-not-empty";

export interface EntryFilter {
  attribute: string;
  operator: EntryFilterOperator;
  value?: unknown;
}

const CONDITION_OPERATORS: Record<string, EntryFilterOperator> = {
  is: "eq",
  "is-not": "neq",
  contains: "contains",
  "is-empty": "is-empty",
  "is-not-empty": "is-not-empty",
  "=": "eq",
  "!=": "neq",
  ">": "gt",
  ">=": "gte",
  "<": "lt",
  "<=": "lte",
  "is-any-of": "in",
};

/** `crm_records` columns `list-crm-list-entries` exposes as `record.*`. */
const RECORD_FIELDS = new Set([
  "displayName",
  "kind",
  "stage",
  "ownerName",
  "domain",
  "primaryEmail",
  "amount",
  "closeDate",
  "updatedAt",
]);

interface AttributeRef {
  id: string;
  apiSlug: string;
}

/**
 * @param attributes the list's own attributes, for resolving an `attributeId`
 *   (which may be an id or an api_slug) to the slug entry filters use.
 */
export function toEntryFilters(
  filter: unknown,
  attributes: readonly AttributeRef[],
): EntryFilter[] {
  if (filter === undefined || filter === null) return [];
  if (typeof filter !== "object") {
    throw new BoardFilterError("This view's stored filter is not readable.");
  }
  const node = filter as { op?: unknown; conditions?: unknown };
  if (node.conditions === undefined) return [];
  if (!Array.isArray(node.conditions)) {
    throw new BoardFilterError("This view's stored filter is not readable.");
  }
  if (node.op === "or" && node.conditions.length > 1) {
    throw new BoardFilterError(
      "A list board cannot yet apply an OR filter. Edit the view on the table.",
    );
  }
  return node.conditions.map((condition) =>
    toEntryFilter(condition, attributes),
  );
}

function toEntryFilter(
  condition: unknown,
  attributes: readonly AttributeRef[],
): EntryFilter {
  if (!condition || typeof condition !== "object") {
    throw new BoardFilterError(
      "This view holds an unreadable filter condition.",
    );
  }
  const leaf = condition as Record<string, unknown>;
  if (leaf.conditions !== undefined) {
    throw new BoardFilterError(
      "A list board cannot yet apply a nested filter group. Edit the view on the table.",
    );
  }
  const operator = CONDITION_OPERATORS[String(leaf.condition)];
  if (!operator) {
    throw new BoardFilterError(
      `A list board cannot yet apply the "${String(leaf.condition)}" condition.`,
    );
  }

  let attribute: string;
  if (typeof leaf.field === "string" && leaf.field) {
    if (!RECORD_FIELDS.has(leaf.field)) {
      throw new BoardFilterError(
        `A list board cannot filter on the record field "${leaf.field}".`,
      );
    }
    attribute = `record.${leaf.field}`;
  } else if (typeof leaf.attributeId === "string" && leaf.attributeId) {
    const match = attributes.find(
      (entry) =>
        entry.id === leaf.attributeId || entry.apiSlug === leaf.attributeId,
    );
    if (!match) {
      throw new BoardFilterError(
        `This view filters on "${leaf.attributeId}", which is not an attribute of this list.`,
      );
    }
    attribute = match.apiSlug;
  } else {
    throw new BoardFilterError("A filter condition names no attribute.");
  }

  return {
    attribute,
    operator,
    ...(operator === "is-empty" || operator === "is-not-empty"
      ? {}
      : { value: leaf.value }),
  };
}
