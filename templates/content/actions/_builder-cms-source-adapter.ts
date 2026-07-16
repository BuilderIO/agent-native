import type {
  ContentDatabaseItem,
  ContentDatabaseSourceFieldMapping,
  DocumentPropertyValue,
} from "../shared/api.js";
import {
  builderBlocksHash,
  builderEntryBlocks,
  normalizeRemoteUpdatedAt,
  type BuilderContentEntry,
} from "../shared/builder-mdx.js";

export const BUILDER_CMS_BODY_CONTENT_KEY = "__builder.body.content";
export const BUILDER_CMS_BODY_BLOCKS_HASH_KEY = "__builder.body.blocksHash";
export const BUILDER_CMS_BODY_LAST_UPDATED_KEY = "__builder.body.lastUpdated";
export const BUILDER_CMS_BODY_SIDECARS_KEY = "__builder.body.sidecarsJson";
export const BUILDER_CMS_BODY_LOSSLESS_CONTENT_KEY =
  "__builder.body.losslessContent";
export const BUILDER_CMS_BODY_READABLE_MAP_KEY =
  "__builder.body.readableMapJson";
export const BUILDER_CMS_BODY_BLOCK_COUNT_KEY = "__builder.body.blockCount";

export interface BuilderCmsSourceEntry {
  id: string;
  model: string;
  title: string;
  urlPath: string;
  updatedAt: string;
  sourceValues: Record<string, DocumentPropertyValue>;
  rawEntry?: BuilderContentEntry;
}

export interface ExistingBuilderSourceRowIdentity {
  documentId: string;
  sourceRowId: string;
  sourceQualifiedId: string;
  sourceDisplayKey: string;
  lastSourceUpdatedAt: string | null;
  sourceValuesJson?: string | null;
}

export const BUILDER_CMS_FIXTURE_ROW_PROVENANCE = "Builder CMS fixture adapter";

function slugifyBuilderTitle(title: string, fallback: string) {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || fallback
  );
}

export function buildBuilderCmsFixtureEntry(args: {
  item: ContentDatabaseItem;
  sourceTable: string;
  now: string;
}): BuilderCmsSourceEntry {
  const title = args.item.document.title?.trim() || "Untitled";
  const slug = slugifyBuilderTitle(title, args.item.document.id.toLowerCase());
  return {
    id: `builder-${args.item.document.id}`,
    model: args.sourceTable,
    title,
    urlPath: `/blog/${slug}`,
    updatedAt: args.now,
    sourceValues: {
      "data.title": title,
      "data.url": `/blog/${slug}`,
      lastUpdated: args.now,
    },
  };
}

export function builderCmsQualifiedId(args: {
  sourceTable: string;
  entryId: string;
}) {
  return `builder-cms://${args.sourceTable}/${args.entryId}`;
}

export function builderCmsSyntheticFixtureEntryId(args: {
  sourceRowId: string;
  documentId: string | null;
  provenance?: string | null;
}) {
  if (!args.documentId) return null;
  if (
    args.provenance &&
    args.provenance !== BUILDER_CMS_FIXTURE_ROW_PROVENANCE
  ) {
    return null;
  }
  return args.sourceRowId === `builder-${args.documentId}`
    ? args.documentId
    : null;
}

export function builderCmsSourceRowIdentityState(args: {
  row: {
    documentId: string | null;
    sourceRowId: string;
    sourceQualifiedId: string;
    provenance?: string | null;
  };
}) {
  const syntheticFixtureEntryId = builderCmsSyntheticFixtureEntryId({
    sourceRowId: args.row.sourceRowId,
    documentId: args.row.documentId,
    provenance: args.row.provenance,
  });
  return {
    sourceRowId: args.row.sourceRowId,
    sourceQualifiedId: args.row.sourceQualifiedId,
    syntheticFixtureEntryId,
    isSyntheticFixture: !!syntheticFixtureEntryId,
  };
}

export function builderCmsSourceFieldKey(
  localFieldKey: string,
  sourceFieldLabel: string,
) {
  if (localFieldKey === "title") return "data.title";
  if (localFieldKey === "builder_url") return "data.url";
  if (localFieldKey === "source_status") return "sys.sync_state";
  if (localFieldKey === "source_updated_at") return "lastUpdated";
  return `data.${sourceFieldLabel
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")}`;
}

export function builderCmsSourceRowIdentity(args: {
  item: ContentDatabaseItem;
  sourceTable: string;
  now: string;
  existing?: ExistingBuilderSourceRowIdentity | null;
  entry?: BuilderCmsSourceEntry | null;
}) {
  if (args.entry) {
    return {
      sourceRowId: args.entry.id,
      sourceQualifiedId: builderCmsQualifiedId({
        sourceTable: args.sourceTable,
        entryId: args.entry.id,
      }),
      sourceDisplayKey: args.entry.title,
      lastSourceUpdatedAt: args.entry.updatedAt,
    };
  }

  if (args.existing) {
    return {
      sourceRowId: args.existing.sourceRowId,
      sourceQualifiedId: args.existing.sourceQualifiedId,
      sourceDisplayKey: args.existing.sourceDisplayKey,
      lastSourceUpdatedAt: args.existing.lastSourceUpdatedAt ?? args.now,
    };
  }

  const entry = buildBuilderCmsFixtureEntry({
    item: args.item,
    sourceTable: args.sourceTable,
    now: args.now,
  });
  return {
    sourceRowId: entry.id,
    sourceQualifiedId: builderCmsQualifiedId({
      sourceTable: args.sourceTable,
      entryId: entry.id,
    }),
    sourceDisplayKey: entry.title,
    lastSourceUpdatedAt: entry.updatedAt,
  };
}

export function builderCmsSourceMetadata(sourceTable: string) {
  return {
    primaryKey: "id",
    titleField: "data.title",
    naturalKeyField: "/blog/[slug]",
    pushMode: "none" as const,
    pushModeLabel: "No writes",
    pushModeDescription:
      "Read-only Builder source. Choose a write tier before any Builder API write can run.",
    writeMode: "read_only" as const,
    allowPublicationTransitions: false,
    allowedWriteModes: [],
    allowDraftWrites: false,
    allowPublishWrites: false,
    notes:
      "Builder CMS binding for local read/diff/revision staging only. Push and publish are represented as capabilities, but live writes are disabled.",
    label: `builder.cms.${sourceTable}`,
  };
}

export function isBuilderCmsTitleField(
  field: Pick<ContentDatabaseSourceFieldMapping, "localFieldKey">,
) {
  return field.localFieldKey === "title";
}

function stringFromRecord(
  value: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function timestampStringFromRecord(
  value: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return String(candidate);
    }
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function pickStringField(
  obj: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

// Builder reference values look like
// `{ "@type": "@builder.io/core:Reference", id, model, value? }`. When the read
// is enriched, the referenced entry is inlined on `value` (with its own `name`
// and `data`) — prefer a human field from it (so e.g. a blog-article's author
// shows the author's name). Without enrichment, fall back to a readable
// `model:shortId` token instead of raw JSON.
function builderReferenceLabel(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const ref = value as Record<string, unknown>;
  if (ref["@type"] !== "@builder.io/core:Reference") return null;
  const inlined =
    ref.value && typeof ref.value === "object"
      ? (ref.value as Record<string, unknown>)
      : null;
  if (inlined) {
    const data =
      inlined.data && typeof inlined.data === "object"
        ? (inlined.data as Record<string, unknown>)
        : {};
    const candidate =
      pickStringField(data, ["name", "fullName", "title", "label", "handle"]) ??
      pickStringField(inlined, ["name", "title"]);
    if (candidate) return candidate;
  }
  const model = typeof ref.model === "string" ? ref.model : "ref";
  const id = typeof ref.id === "string" ? ref.id : "";
  return id ? `${model}:${id.slice(0, 8)}` : model;
}

function sourceValueFromUnknown(value: unknown): DocumentPropertyValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (
          typeof entry === "string" ||
          typeof entry === "number" ||
          typeof entry === "boolean"
        ) {
          return String(entry);
        }
        return builderReferenceLabel(entry);
      })
      .filter((entry): entry is string => entry !== null);
  }
  if (value && typeof value === "object") {
    const refLabel = builderReferenceLabel(value);
    if (refLabel !== null) return refLabel;
    return JSON.stringify(value);
  }
  return null;
}

function builderSourceValuesFromRecord(args: {
  record: Record<string, unknown>;
  data: Record<string, unknown>;
  title: string;
  urlPath: string;
  updatedAt: string;
  rawEntry: BuilderContentEntry;
}) {
  const values: Record<string, DocumentPropertyValue> = {
    "data.title": args.title,
    "data.url": args.urlPath,
    lastUpdated: args.updatedAt,
  };
  for (const [key, value] of Object.entries(args.data)) {
    if (key === "blocks" || key === "blocksString") continue;
    values[`data.${key}`] = sourceValueFromUnknown(value);
  }
  for (const key of ["published", "createdDate", "updatedDate", "updatedAt"]) {
    if (key in args.record) {
      values[key] = sourceValueFromUnknown(args.record[key]);
    }
  }
  const blocks = builderEntryBlocks(args.rawEntry);
  if (blocks.length > 0) {
    values[BUILDER_CMS_BODY_BLOCKS_HASH_KEY] = builderBlocksHash(blocks);
    values[BUILDER_CMS_BODY_BLOCK_COUNT_KEY] = blocks.length;
  }
  return values;
}

export function normalizeBuilderCmsApiEntry(
  value: unknown,
  model: string,
): BuilderCmsSourceEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const data =
    record.data &&
    typeof record.data === "object" &&
    !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : {};
  const id = stringFromRecord(record, ["id", "@id", "uuid"]);
  if (!id) return null;

  const title =
    stringFromRecord(data, ["title", "name"]) ??
    stringFromRecord(record, ["name", "title"]) ??
    id;
  const slug = stringFromRecord(data, ["slug", "handle"]);
  const urlPath =
    stringFromRecord(data, ["url", "urlPath", "path"]) ??
    (slug ? `/blog/${slug.replace(/^\/+/, "")}` : `/blog/${id}`);
  const updatedAt =
    timestampStringFromRecord(record, [
      "lastUpdated",
      "updatedDate",
      "updatedAt",
    ]) ??
    timestampStringFromRecord(data, ["updatedAt"]) ??
    new Date().toISOString();
  const rawEntry: BuilderContentEntry = {
    ...record,
    id,
    model,
    name:
      typeof record.name === "string" && record.name.trim()
        ? record.name.trim()
        : title,
    published:
      typeof record.published === "string" ? record.published : undefined,
    lastUpdated: normalizeRemoteUpdatedAt({
      ...record,
      id,
      model,
      data,
    } as BuilderContentEntry),
    data,
  };

  return {
    id,
    model,
    title,
    urlPath,
    updatedAt,
    sourceValues: builderSourceValuesFromRecord({
      record,
      data,
      title,
      urlPath,
      updatedAt,
      rawEntry,
    }),
    rawEntry,
  };
}
