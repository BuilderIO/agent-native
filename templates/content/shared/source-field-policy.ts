import type { ContentDatabaseSourceWriteOwner } from "./api.js";

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

export function contentDatabaseSourceFieldsAllowLocalWrite(
  fields: Array<{ writeOwner: unknown; readOnly: unknown }>,
) {
  const decisions = fields.map(contentDatabaseSourceFieldAllowsLocalWrite);
  return decisions.every(Boolean);
}
