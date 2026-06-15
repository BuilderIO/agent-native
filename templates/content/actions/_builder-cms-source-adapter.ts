import type {
  ContentDatabaseItem,
  ContentDatabaseSourceFieldMapping,
} from "../shared/api.js";

export interface BuilderCmsSourceEntry {
  id: string;
  model: string;
  title: string;
  urlPath: string;
  updatedAt: string;
}

export interface ExistingBuilderSourceRowIdentity {
  documentId: string;
  sourceRowId: string;
  sourceQualifiedId: string;
  sourceDisplayKey: string;
  lastSourceUpdatedAt: string | null;
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

export function builderCmsWriteTargetFromSourceRow(args: {
  sourceTable: string;
  row: {
    documentId: string | null;
    sourceRowId: string;
    sourceQualifiedId: string;
    provenance?: string | null;
  };
  normalizeFixtureIdentity: boolean;
}) {
  const normalizedEntryId = args.normalizeFixtureIdentity
    ? builderCmsSyntheticFixtureEntryId({
        sourceRowId: args.row.sourceRowId,
        documentId: args.row.documentId,
        provenance: args.row.provenance,
      })
    : null;
  const entryId = normalizedEntryId ?? args.row.sourceRowId;
  return {
    entryId,
    sourceQualifiedId: normalizedEntryId
      ? builderCmsQualifiedId({
          sourceTable: args.sourceTable,
          entryId: normalizedEntryId,
        })
      : args.row.sourceQualifiedId,
    normalizedFixtureIdentity: !!normalizedEntryId,
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
    pushMode: "autosave" as const,
    pushModeLabel: "Save revision / autosave",
    pushModeDescription:
      "Local-only Builder revision staging. No Builder API write runs in this slice.",
    allowedWriteModes: ["autosave"],
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
    stringFromRecord(record, ["lastUpdated", "updatedDate", "updatedAt"]) ??
    stringFromRecord(data, ["updatedAt"]) ??
    new Date().toISOString();

  return {
    id,
    model,
    title,
    urlPath,
    updatedAt,
  };
}
