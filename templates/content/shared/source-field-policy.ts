import {
  BUILDER_CMS_SAFE_WRITE_MODEL,
  type ContentDatabaseSourceWriteOwner,
} from "./api.js";
import { isDocumentPropertyDateValue } from "./properties.js";

export function parseContentDatabaseSourceWriteOwner(
  value: unknown,
): ContentDatabaseSourceWriteOwner {
  if (value === "local" || value === "source" || value === "derived") {
    return value;
  }
  throw new Error(`Invalid Content source field write owner: ${String(value)}`);
}

export function parseContentDatabaseSourceFieldReadOnly(
  value: unknown,
): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  throw new Error(
    `Invalid Content source field read-only value: ${String(value)}`,
  );
}

export function contentDatabaseSourceFieldAllowsLocalWrite(field: {
  writeOwner: unknown;
  readOnly: unknown;
}) {
  return (
    parseContentDatabaseSourceWriteOwner(field.writeOwner) === "local" &&
    !parseContentDatabaseSourceFieldReadOnly(field.readOnly)
  );
}

const BUILDER_ENTRY_BODY_FIELD_KEYS = new Set([
  "data.title",
  "data.blocks",
  "data.blocksString",
]);

export function contentDatabaseSourceFieldSavesEditsToSource(field: {
  writeOwner: unknown;
  readOnly: unknown;
  mappingType?: unknown;
  sourceFieldKey?: unknown;
  sourceType?: unknown;
  sourceTable?: unknown;
  sourceMetadataJson?: unknown;
}) {
  return (
    field.sourceType === "builder-cms" &&
    field.sourceTable === BUILDER_CMS_SAFE_WRITE_MODEL &&
    sourceOwnsItsRows(field.sourceMetadataJson) &&
    field.mappingType === "property" &&
    typeof field.sourceFieldKey === "string" &&
    field.sourceFieldKey.startsWith("data.") &&
    !BUILDER_ENTRY_BODY_FIELD_KEYS.has(field.sourceFieldKey) &&
    parseContentDatabaseSourceWriteOwner(field.writeOwner) === "source" &&
    !parseContentDatabaseSourceFieldReadOnly(field.readOnly)
  );
}

function sourceOwnsItsRows(metadataJson: unknown) {
  if (typeof metadataJson !== "string") return false;
  try {
    const metadata: unknown = JSON.parse(metadataJson);
    if (
      typeof metadata !== "object" ||
      metadata === null ||
      Array.isArray(metadata)
    ) {
      return false;
    }
    const { federation } = metadata as {
      federation?: { role?: unknown } | null;
    };
    return federation == null || federation.role === "primary";
    // coercion-ok: metadata that doesn't parse can't show the source owns its rows, so nothing saves back
  } catch {
    return false;
  }
}

function isWebLink(value: unknown) {
  if (typeof value !== "string" || !URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === "https:" || protocol === "http:";
}

export function contentDatabaseSourceWritebackValueError(
  type: string,
  value: unknown,
  options: ReadonlyArray<{ id: string }> = [],
) {
  if (type === "select" || type === "multi_select") {
    const picked = Array.isArray(value) ? value : value == null ? [] : [value];
    const known = new Set(options.map((option) => option.id));
    return picked.every((id) => typeof id === "string" && known.has(id))
      ? null
      : "Builder takes only the options this field already lists";
  }
  if (type === "files_media") {
    const links = Array.isArray(value) ? value : value == null ? [] : [value];
    return links.length === 0 || (links.length === 1 && isWebLink(links[0]))
      ? null
      : "Builder takes a single link that starts with https://";
  }
  if (type === "date" && isDocumentPropertyDateValue(value) && value.end) {
    return "Builder takes a single date, not a range";
  }
  return null;
}

export function contentDatabaseSourceFieldAllowsValueEdit(
  field: Parameters<typeof contentDatabaseSourceFieldSavesEditsToSource>[0],
) {
  return (
    contentDatabaseSourceFieldAllowsLocalWrite(field) ||
    contentDatabaseSourceFieldSavesEditsToSource(field)
  );
}

export function contentDatabaseSourceFieldsAllowLocalWrite(
  fields: Array<{ writeOwner: unknown; readOnly: unknown }>,
) {
  const decisions = fields.map(contentDatabaseSourceFieldAllowsLocalWrite);
  return decisions.every(Boolean);
}

export function contentDatabaseSourceManagedPropertyIds(
  fields: Array<{
    propertyId: string | null;
    writeOwner: unknown;
    readOnly: unknown;
  }>,
) {
  const decisions = fields
    .filter(
      (field): field is typeof field & { propertyId: string } =>
        field.propertyId !== null,
    )
    .map((field) => ({
      propertyId: field.propertyId,
      allowsLocalWrite: contentDatabaseSourceFieldAllowsLocalWrite(field),
    }));
  return new Set(
    decisions.flatMap(({ propertyId, allowsLocalWrite }) =>
      allowsLocalWrite ? [] : [propertyId],
    ),
  );
}

export function contentDatabaseSourceWritebackPropertyIds(
  fields: Array<
    Parameters<typeof contentDatabaseSourceFieldSavesEditsToSource>[0] & {
      propertyId: string | null;
    }
  >,
) {
  const bound = new Map<string, boolean>();
  for (const field of fields) {
    if (field.propertyId === null) continue;
    bound.set(
      field.propertyId,
      (bound.get(field.propertyId) ?? true) &&
        contentDatabaseSourceFieldAllowsValueEdit(field),
    );
  }
  const managed = contentDatabaseSourceManagedPropertyIds(fields);
  return new Set(
    [...bound].flatMap(([propertyId, editable]) =>
      editable && managed.has(propertyId) ? [propertyId] : [],
    ),
  );
}
