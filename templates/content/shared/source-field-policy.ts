import {
  BUILDER_CMS_SAFE_WRITE_MODEL,
  type ContentDatabaseSourceWriteOwner,
} from "./api.js";

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
}) {
  return (
    field.sourceType === "builder-cms" &&
    field.sourceTable === BUILDER_CMS_SAFE_WRITE_MODEL &&
    field.mappingType === "property" &&
    typeof field.sourceFieldKey === "string" &&
    field.sourceFieldKey.startsWith("data.") &&
    !BUILDER_ENTRY_BODY_FIELD_KEYS.has(field.sourceFieldKey) &&
    parseContentDatabaseSourceWriteOwner(field.writeOwner) === "source" &&
    !parseContentDatabaseSourceFieldReadOnly(field.readOnly)
  );
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
