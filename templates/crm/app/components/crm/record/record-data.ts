import {
  ATTRIBUTE_TYPE_SPECS,
  type CrmAttributeType,
} from "../../../../shared/crm-attributes";
import type {
  CrmAttributeDefinition,
  CrmAttributeOption,
  CrmValue,
} from "../../../../shared/crm-contract";
import {
  ATTRIBUTE_VALUE_SPECS,
  formatAttributeValue,
  parseAttributeValue,
  valueTokens,
  type CrmAttributeControl,
} from "../shared/attribute-value";

export { attributeInputValue as fieldInputValue } from "../shared/attribute-value";

export const MAX_HIGHLIGHTS = 6;

export interface CrmRecordPageEntry {
  id: string;
  listId: string;
  recordId: string;
  position: number;
  createdAt: string;
  createdByActorType: string;
  createdByActorId: string | null;
  values: Record<string, CrmValue>;
  valuesSince: Record<string, string>;
}

export interface CrmRecordPageListAttribute {
  id: string;
  apiSlug: string;
  label: string;
  description: string | null;
  attributeType: CrmAttributeType;
  multi: boolean;
  required: boolean;
  position: number;
  usesOptions: boolean;
  options: CrmAttributeOption[];
}

export interface CrmRecordPageList {
  id: string;
  name: string;
  apiSlug: string;
  parentObjectType: string;
  attributes: CrmRecordPageListAttribute[];
  entries: CrmRecordPageEntry[];
}

export interface CrmRecordPageValueMeta {
  since: string;
  actorType: string;
  actorId: string | null;
}

export interface CrmRecordPage {
  record: {
    id: string;
    connectionId: string;
    provider: string;
    objectType: string;
    kind: string;
    displayName: string;
    remoteRevision: string | null;
    updatedAt: string;
  };
  attributes: CrmAttributeDefinition[];
  values: Record<string, CrmValue>;
  valueMeta: Record<string, CrmRecordPageValueMeta>;
  lists: CrmRecordPageList[];
  listMembershipsTruncated: boolean;
  recordUrl: string | null;
  recordUrlUnavailableReason: string | null;
}

const PANEL_CONTROLS: ReadonlySet<CrmAttributeControl> = new Set([
  "text",
  "number",
  "checkbox",
  "date",
  "datetime",
  "options",
  "rating",
  "reference",
]);

export type FieldLockReason =
  | "archived"
  | "read-only"
  | "redacted"
  | "provider-owned"
  | "derived"
  | "unsupported-type";

export type FieldEditability =
  | { editable: true }
  | { editable: false; reason: FieldLockReason };

export function fieldEditability(
  attribute: Pick<
    CrmAttributeDefinition,
    "attributeType" | "archived" | "storagePolicy" | "updateable"
  >,
): FieldEditability {
  if (attribute.archived) return { editable: false, reason: "archived" };
  if (attribute.storagePolicy === "redacted")
    return { editable: false, reason: "redacted" };
  if (!attribute.updateable) return { editable: false, reason: "read-only" };
  if (attribute.storagePolicy === "derived-local")
    return { editable: false, reason: "derived" };
  if (attribute.storagePolicy !== "local-authoritative")
    return { editable: false, reason: "provider-owned" };
  if (
    !PANEL_CONTROLS.has(ATTRIBUTE_VALUE_SPECS[attribute.attributeType].control)
  )
    return { editable: false, reason: "unsupported-type" };
  return { editable: true };
}

export type FieldDisplay =
  | { kind: "empty" }
  | { kind: "boolean"; value: boolean }
  | { kind: "text"; text: string }
  | { kind: "tokens"; tokens: Array<{ label: string; color?: string }> }
  | { kind: "structured"; text: string };

const STRUCTURED_PREVIEW_LIMIT = 200;

export function formatFieldValue(
  attribute: Pick<
    CrmAttributeDefinition,
    "attributeType" | "multi" | "options" | "config"
  >,
  value: CrmValue | undefined,
): FieldDisplay {
  if (value === undefined || value === null) return { kind: "empty" };

  if (Array.isArray(value)) {
    const tokens = valueTokens(attribute, value);
    return tokens.length ? { kind: "tokens", tokens } : { kind: "empty" };
  }

  if (typeof value === "boolean") return { kind: "boolean", value };

  if (typeof value === "object") {
    const text = formatAttributeValue(attribute, value);
    return {
      kind: "structured",
      text:
        text.length > STRUCTURED_PREVIEW_LIMIT
          ? `${text.slice(0, STRUCTURED_PREVIEW_LIMIT)}…`
          : text,
    };
  }

  if (value === "") return { kind: "empty" };
  if (ATTRIBUTE_TYPE_SPECS[attribute.attributeType].usesOptions)
    return { kind: "tokens", tokens: valueTokens(attribute, value) };
  return { kind: "text", text: formatAttributeValue(attribute, value) };
}

export type FieldParseResult =
  | { ok: true; value: CrmValue }
  | {
      ok: false;
      code: "not-a-number" | "not-a-date" | "unknown-option" | "not-editable";
    };

/**
 * Parse a raw editor value into the typed `CrmValue` the action expects.
 * `multi` attributes take a comma-separated list.
 *
 * The editability gate runs first, so this panel never parses a field
 * `update-crm-record` would refuse; everything past it is the shared parser.
 *
 * ponytail: comma-separated text for multi values instead of a token input —
 * upgrade to a real token editor when a customer keeps commas inside a value.
 */
export function parseFieldInput(
  attribute: Pick<
    CrmAttributeDefinition,
    | "attributeType"
    | "multi"
    | "options"
    | "archived"
    | "storagePolicy"
    | "updateable"
  >,
  raw: string | boolean,
): FieldParseResult {
  if (!fieldEditability(attribute).editable)
    return { ok: false, code: "not-editable" };
  if (typeof raw === "boolean") return { ok: true, value: raw };

  const parsed = parseAttributeValue(attribute, raw);
  if (parsed.ok) return { ok: true, value: parsed.value };
  return {
    ok: false,
    code: parsed.reason === "read-only" ? "not-editable" : parsed.reason,
  };
}

export function entryAttributeAsEditable(
  attribute: CrmRecordPageListAttribute,
): Pick<
  CrmAttributeDefinition,
  | "apiSlug"
  | "label"
  | "attributeType"
  | "multi"
  | "options"
  | "config"
  | "archived"
  | "storagePolicy"
  | "updateable"
  | "required"
> {
  return {
    apiSlug: attribute.apiSlug,
    label: attribute.label,
    attributeType: attribute.attributeType,
    multi: attribute.multi,
    options: attribute.options,
    config: {},
    archived: false,
    storagePolicy: "local-authoritative",
    updateable: true,
    required: attribute.required,
  };
}

const HIGHLIGHT_ORDER: Record<string, readonly string[]> = {
  account: ["name", "domain", "industry", "ownerName", "nextContactAt"],
  person: [
    "name",
    "firstName",
    "lastName",
    "email",
    "title",
    "accountId",
    "ownerName",
  ],
  opportunity: ["name", "amount", "stage", "closeDate", "ownerName"],
};

function hasHighlightValue(value: CrmValue | undefined): boolean {
  if (value === undefined || value === null || value === "") return false;
  return !Array.isArray(value) || value.length > 0;
}

export function splitHighlights<
  T extends { apiSlug: string; position: number },
>(
  attributes: T[],
  options: {
    kind?: string;
    values?: Record<string, CrmValue>;
    max?: number;
  } = {},
): { highlights: T[]; rest: T[] } {
  const { kind = "custom", values = {}, max = MAX_HIGHLIGHTS } = options;
  const ordered = [...attributes].sort((a, b) => a.position - b.position);
  const curated = HIGHLIGHT_ORDER[kind];
  if (!curated) {
    return { highlights: ordered.slice(0, max), rest: ordered.slice(max) };
  }

  const byApiSlug = new Map(
    ordered.map((attribute) => [attribute.apiSlug, attribute]),
  );
  const picked: T[] = [];
  const pickedSlugs = new Set<string>();
  for (const slug of curated) {
    if (picked.length >= max) break;
    const attribute = byApiSlug.get(slug);
    if (!attribute) continue;
    picked.push(attribute);
    pickedSlugs.add(slug);
  }
  if (picked.length < max) {
    const filler = ordered
      .filter((attribute) => !pickedSlugs.has(attribute.apiSlug))
      .sort((a, b) => {
        const byValue =
          Number(hasHighlightValue(values[b.apiSlug])) -
          Number(hasHighlightValue(values[a.apiSlug]));
        return byValue !== 0 ? byValue : a.position - b.position;
      });
    for (const attribute of filler) {
      if (picked.length >= max) break;
      picked.push(attribute);
      pickedSlugs.add(attribute.apiSlug);
    }
  }
  return {
    highlights: picked,
    rest: ordered.filter((attribute) => !pickedSlugs.has(attribute.apiSlug)),
  };
}

function sameCrmValue(a: CrmValue, b: CrmValue | undefined): boolean {
  if (a === b) return true;
  if (a === null || b === null || b === undefined) return false;
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

export function isSuppressedDuplicateAttribute(
  apiSlug: string,
  values: Record<string, CrmValue>,
): boolean {
  if (apiSlug !== "displayName") return false;
  const name = values.name;
  if (!name) return false;
  return sameCrmValue(name, values.displayName);
}

export function withoutSuppressedDuplicates<T extends { apiSlug: string }>(
  attributes: T[],
  values: Record<string, CrmValue>,
): T[] {
  return attributes.filter(
    (attribute) => !isSuppressedDuplicateAttribute(attribute.apiSlug, values),
  );
}

export interface FieldHistoryChange {
  id: string;
  value: CrmValue;
  activeFrom: string;
  activeUntil: string | null;
  current: boolean;
  actorType: string;
  actorId: string | null;
}

export interface FieldHistoryResponse {
  recordId: string;
  entryId: string | null;
  apiSlug: string;
  label: string;
  attributeType: CrmAttributeType;
  multi: boolean;
  historyTracked: boolean;
  changes: FieldHistoryChange[];
}

export interface FieldHistoryTransition {
  id: string;
  from: CrmValue | undefined;
  to: CrmValue;
  at: string;
  actorType: string;
  actorId: string | null;
}

export function historyTransitions(
  changes: FieldHistoryChange[],
): FieldHistoryTransition[] {
  return changes.map((change, index) => {
    const previous = changes[index + 1];
    return {
      id: change.id,
      from: previous ? previous.value : undefined,
      to: change.value,
      at: change.activeFrom,
      actorType: change.actorType,
      actorId: change.actorId,
    };
  });
}

export interface CrmActivityItem {
  id: string;
  title: string;
  summary?: string;
  occurredAt?: string;
  actor?: string;
}

export type ActivityState =
  | { kind: "not-ingested" }
  | { kind: "items"; items: CrmActivityItem[] };

export function resolveActivityState(
  items: CrmActivityItem[] | undefined,
): ActivityState {
  return items && items.length
    ? { kind: "items", items }
    : { kind: "not-ingested" };
}

export interface OptimisticFieldEdit {
  apiSlug: string;
  previousValue: CrmValue | undefined;
  previousMeta: CrmRecordPageValueMeta | undefined;
}

export function applyFieldValue(
  page: CrmRecordPage,
  apiSlug: string,
  value: CrmValue,
  meta: CrmRecordPageValueMeta,
): { page: CrmRecordPage; edit: OptimisticFieldEdit } {
  return {
    page: {
      ...page,
      values: { ...page.values, [apiSlug]: value },
      valueMeta: { ...page.valueMeta, [apiSlug]: meta },
    },
    edit: {
      apiSlug,
      previousValue: page.values[apiSlug],
      previousMeta: page.valueMeta[apiSlug],
    },
  };
}

export function rollbackFieldValue(
  page: CrmRecordPage,
  edit: OptimisticFieldEdit,
): CrmRecordPage {
  const values = { ...page.values };
  const valueMeta = { ...page.valueMeta };
  if (edit.previousValue === undefined) delete values[edit.apiSlug];
  else values[edit.apiSlug] = edit.previousValue;
  if (edit.previousMeta === undefined) delete valueMeta[edit.apiSlug];
  else valueMeta[edit.apiSlug] = edit.previousMeta;
  return { ...page, values, valueMeta };
}

export function applyEntryValue(
  page: CrmRecordPage,
  entryId: string,
  apiSlug: string,
  value: CrmValue,
): { page: CrmRecordPage; previousValue: CrmValue | undefined } {
  let previousValue: CrmValue | undefined;
  const lists = page.lists.map((list) => ({
    ...list,
    entries: list.entries.map((entry) => {
      if (entry.id !== entryId) return entry;
      previousValue = entry.values[apiSlug];
      return { ...entry, values: { ...entry.values, [apiSlug]: value } };
    }),
  }));
  return { page: { ...page, lists }, previousValue };
}

export function rollbackEntryValue(
  page: CrmRecordPage,
  entryId: string,
  apiSlug: string,
  previousValue: CrmValue | undefined,
): CrmRecordPage {
  return {
    ...page,
    lists: page.lists.map((list) => ({
      ...list,
      entries: list.entries.map((entry) => {
        if (entry.id !== entryId) return entry;
        const values = { ...entry.values };
        if (previousValue === undefined) delete values[apiSlug];
        else values[apiSlug] = previousValue;
        return { ...entry, values };
      }),
    })),
  };
}

export const RECORD_TABS = ["activity", "notes", "tasks", "related"] as const;

export type RecordTab = (typeof RECORD_TABS)[number];

export function isRecordTab(value: unknown): value is RecordTab {
  return (
    typeof value === "string" &&
    (RECORD_TABS as readonly string[]).includes(value)
  );
}
