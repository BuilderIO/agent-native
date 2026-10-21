import type { WorkflowCatalog, WorkflowNode } from "@/lib/workflow-editor";
import type { SourceKind } from "@/lib/workflow-editor/drop-paths";

import type {
  NodeDataItem,
  NodeDataStoredItem,
} from "../../../../server/workflow-host/read-models.js";

/** The fixed fields every stored item carries, in the order the views show them. */
const ITEM_FIELDS = [
  "title",
  "text",
  "url",
  "author",
  "occurredAt",
  "thread",
] as const;
type ItemField = (typeof ITEM_FIELDS)[number];

/** The table shows this many columns; the rest sit behind a notice. */
const MAX_TABLE_COLUMNS = 40;
/** A schema lists this many elements of an array, then counts the rest. */
const MAX_SCHEMA_ELEMENTS = 20;
/** A schema row shows at most this many characters of a value. */
const MAX_SAMPLE_CHARS = 600;

export type ValueKind =
  | "text"
  | "number"
  | "boolean"
  | "list"
  | "object"
  | "empty";

export type Segment = string | number;

export function storedItemsOf(
  items: readonly NodeDataItem[],
): NodeDataStoredItem[] {
  return items.filter((item): item is NodeDataStoredItem => !item.synthetic);
}

/** A stored item as the views show it: the fixed fields, then the extras. */
export function fieldsOf(item: NodeDataStoredItem): Record<string, unknown> {
  return {
    title: item.title,
    text: item.text,
    url: item.url,
    author: item.author,
    occurredAt: item.occurredAt,
    thread: item.thread,
    extras: item.extras,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function valueKind(value: unknown): ValueKind {
  if (value === null || value === undefined) return "empty";
  if (Array.isArray(value)) return "list";
  switch (typeof value) {
    case "string":
      return "text";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      return "object";
    // JSON holds no other types; anything else that reached a view is shown as text.
    default:
      return "text";
  }
}

/**
 * The kind of a field across the values it has in each item: the first value
 * that is not null, or empty when every value is null or missing.
 */
function kindOfValues(values: readonly unknown[]): ValueKind {
  const first = values.find((value) => value !== undefined && value !== null);
  return first === undefined ? "empty" : valueKind(first);
}

/** The value at a path under `root`, or undefined when a step along the path is missing. */
function valueAt(root: unknown, segments: readonly Segment[]): unknown {
  let value = root;
  for (const segment of segments) {
    if (Array.isArray(value) && typeof segment === "number") {
      value = value[segment];
    } else if (
      isRecord(value) &&
      typeof segment === "string" &&
      hasOwn(value, segment)
    ) {
      value = value[segment];
    } else {
      return undefined;
    }
  }
  return value;
}

/** The kind of the value at a path across the stored items, so a key reads the same in every item that shows it. */
export function kindAt(
  items: readonly NodeDataStoredItem[],
  segments: readonly Segment[],
): ValueKind {
  return kindOfValues(items.map((item) => valueAt(fieldsOf(item), segments)));
}

function clipSample(text: string): string {
  return text.length > MAX_SAMPLE_CHARS
    ? `${text.slice(0, MAX_SAMPLE_CHARS)}…`
    : text;
}

/** The value as a schema row shows it. A container shows only when it is empty. */
function sampleOf(value: unknown): string | null {
  switch (valueKind(value)) {
    case "empty":
      return "null";
    case "text":
      return clipSample(String(value));
    case "number":
    case "boolean":
      return String(value);
    case "list":
      return (value as unknown[]).length === 0 ? "[]" : null;
    case "object":
      return isRecord(value) && Object.keys(value).length === 0 ? "{}" : null;
  }
}

/** One row of a schema: a field, its sample, and the fields or elements under it. */
export interface SchemaField {
  /** Unique within the schema: the segments as JSON, so a key with a dot cannot collide. */
  id: string;
  /** The row's name: a key, or `key[0]` for an array element. */
  label: string;
  /** The path from the item root, for copying it. */
  segments: Segment[];
  kind: ValueKind;
  sample: string | null;
  children: SchemaField[];
  /** Array elements left out of `children`. */
  more: number;
  /** From the operation's declared mapping: a shape with no values yet. */
  preview: boolean;
}

export const EXTRAS_FIELD_ID = JSON.stringify(["extras"]);

function fieldId(segments: readonly Segment[]): string {
  return JSON.stringify(segments);
}

/**
 * One field across the items it appears in, in item order. The kind and sample
 * come from the first value that is not null. Children merge from every item
 * that has them, so the first value also wins for each child.
 */
function fieldOf(
  label: string,
  segments: Segment[],
  values: readonly unknown[],
): SchemaField {
  const present = values.filter(
    (value) => value !== undefined && value !== null,
  );
  const first = present[0];
  const kind = kindOfValues(values);
  let children: SchemaField[] = [];
  let more = 0;
  if (kind === "object") {
    const records = present.filter(isRecord);
    const keys = new Set<string>();
    for (const record of records) {
      for (const key of Object.keys(record)) keys.add(key);
    }
    children = [...keys].map((key) =>
      fieldOf(
        key,
        [...segments, key],
        records
          .filter((record) => hasOwn(record, key))
          .map((record) => record[key]),
      ),
    );
  } else if (kind === "list") {
    const lists = present.filter((value): value is unknown[] =>
      Array.isArray(value),
    );
    const longest = lists.reduce((max, list) => Math.max(max, list.length), 0);
    const shown = Math.min(longest, MAX_SCHEMA_ELEMENTS);
    children = Array.from({ length: shown }, (_, index) =>
      fieldOf(
        `${label}[${index}]`,
        [...segments, index],
        lists.filter((list) => index < list.length).map((list) => list[index]),
      ),
    );
    more = longest - shown;
  }
  return {
    id: fieldId(segments),
    label,
    segments,
    kind,
    sample:
      first === undefined
        ? values.length > 0
          ? "null"
          : null
        : sampleOf(first),
    children,
    more,
    preview: false,
  };
}

/** The schema of the stored items: the fixed fields, then `extras`, merged across every item. */
export function schemaOf(items: readonly NodeDataStoredItem[]): SchemaField[] {
  return [
    ...ITEM_FIELDS.map((field) =>
      fieldOf(
        field,
        [field],
        items.map((item) => item[field]),
      ),
    ),
    fieldOf(
      "extras",
      ["extras"],
      items.map((item) => item.extras),
    ),
  ];
}

/** The kind a drag of a schema row carries. A preview row has no value yet, so its kind is unknown. */
export function dragKindOf(field: SchemaField): SourceKind {
  return field.preview ? "unknown" : field.kind;
}

const PREVIEW_KINDS: Record<Exclude<ItemField, "thread">, ValueKind> = {
  title: "text",
  text: "text",
  url: "text",
  author: "text",
  occurredAt: "text",
};

function previewField(
  label: string,
  segments: Segment[],
  kind: ValueKind,
  children: SchemaField[] = [],
): SchemaField {
  return {
    id: fieldId(segments),
    label,
    segments,
    kind,
    sample: null,
    children,
    more: 0,
    preview: true,
  };
}

/**
 * The schema an operation's declared item mapping promises, before any run has
 * produced an item. `declared` is the mapping's field keys, such as `extras.price`.
 */
export function previewSchemaOf(declared: readonly string[]): SchemaField[] {
  const under = (group: string) =>
    declared
      .filter((key) => key.startsWith(`${group}.`))
      .map((key) => key.slice(group.length + 1));
  return [
    ...ITEM_FIELDS.map((field) =>
      field === "thread"
        ? previewField(
            "thread",
            ["thread"],
            "object",
            under("thread").map((name) =>
              previewField(
                name,
                ["thread", name],
                name === "number" ? "number" : "text",
              ),
            ),
          )
        : previewField(field, [field], PREVIEW_KINDS[field]),
    ),
    previewField(
      "extras",
      ["extras"],
      "object",
      under("extras").map((name) =>
        previewField(name, ["extras", name], "empty"),
      ),
    ),
  ];
}

/** The item fields a node's catalog entry declares it fills. Only a source operation declares any. */
export function declaredFieldsOf(
  node: WorkflowNode,
  catalog: WorkflowCatalog,
): string[] {
  if (node.kind !== "source" || !("operation" in node.settings)) return [];
  return Object.keys(
    catalog.get(node.settings.operation)?.itemMapping?.fields ?? {},
  );
}

export function includesText(haystack: string, needle: string): boolean {
  return needle === "" || haystack.toLowerCase().includes(needle.toLowerCase());
}

function textOf(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(textOf).join(" ");
  if (isRecord(value)) return Object.values(value).map(textOf).join(" ");
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

/** What a search matches in a table or JSON row: the values, not the key names. */
export function itemText(item: NodeDataItem): string {
  return item.synthetic ? item.itemId : textOf(fieldsOf(item));
}

function matchesField(field: SchemaField, query: string): boolean {
  return (
    includesText(field.label, query) ||
    (field.sample !== null && includesText(field.sample, query))
  );
}

function hasMatch(field: SchemaField, query: string): boolean {
  return (
    matchesField(field, query) ||
    field.children.some((child) => hasMatch(child, query))
  );
}

export type SchemaLine =
  | {
      kind: "field";
      field: SchemaField;
      depth: number;
      open: boolean;
      expandable: boolean;
    }
  | { kind: "more"; count: number; depth: number };

/**
 * The rows a schema shows, top to bottom. A search keeps each field whose name
 * or sample matches, with the fields above it, and opens every branch it keeps.
 */
export function schemaLines(
  fields: readonly SchemaField[],
  opened: ReadonlySet<string>,
  query: string,
): SchemaLine[] {
  const lines: SchemaLine[] = [];
  const visit = (field: SchemaField, depth: number) => {
    if (query !== "" && !hasMatch(field, query)) return;
    const expandable = field.children.length > 0 || field.more > 0;
    const open = query !== "" || opened.has(field.id);
    lines.push({ kind: "field", field, depth, open, expandable });
    if (!expandable || !open) return;
    for (const child of field.children) visit(child, depth + 1);
    if (field.more > 0 && query === "") {
      lines.push({ kind: "more", count: field.more, depth: depth + 1 });
    }
  };
  for (const field of fields) visit(field, 0);
  return lines;
}

export interface TableColumn {
  key: string;
  label: string;
  /** The path from the item root, for mapping the column. */
  segments: Segment[];
  /** The kind a drag of the column carries, across every stored item. */
  kind: ValueKind;
  read: (item: NodeDataStoredItem) => unknown;
}

/**
 * The table's columns: the fixed fields, then each key of `extras` as
 * `extras.<key>`, in the order the items first show them. Columns past the
 * limit are counted, not shown.
 */
export function tableColumnsOf(items: readonly NodeDataStoredItem[]): {
  shown: TableColumn[];
  hidden: number;
} {
  const extraKeys = new Set<string>();
  for (const item of items) {
    for (const key of Object.keys(item.extras)) extraKeys.add(key);
  }
  const columns: TableColumn[] = [
    ...ITEM_FIELDS.map(
      (field): TableColumn => ({
        key: field,
        label: field,
        segments: [field],
        kind: kindAt(items, [field]),
        read: (item) => item[field],
      }),
    ),
    ...[...extraKeys].map(
      (key): TableColumn => ({
        key: `extras.${key}`,
        label: `extras.${key}`,
        segments: ["extras", key],
        kind: kindAt(items, ["extras", key]),
        read: (item) => item.extras[key],
      }),
    ),
  ];
  return {
    shown: columns.slice(0, MAX_TABLE_COLUMNS),
    hidden: Math.max(0, columns.length - MAX_TABLE_COLUMNS),
  };
}
