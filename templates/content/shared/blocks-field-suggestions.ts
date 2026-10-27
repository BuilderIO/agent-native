/**
 * Suggestions on a Blocks field tab other than the page body. Each one names
 * its field in its operation's `targetId` and is made against that field's
 * revision, so accepting it writes only that field.
 */
export const CONTENT_BLOCKS_FIELD_SUGGESTION_ADAPTER =
  "content.blocks-field-markdown";

const REVISION_PREFIX = "blocks-field:";

/** The base revision of a suggestion on a field: the field and its revision. */
export function blocksFieldSuggestionRevision(
  propertyId: string,
  revision: number,
): string {
  return `${REVISION_PREFIX}${propertyId}:${revision}`;
}

export function parseBlocksFieldSuggestionRevision(
  baseRevision: string,
): { propertyId: string; revision: number } | null {
  if (!baseRevision.startsWith(REVISION_PREFIX)) return null;
  const rest = baseRevision.slice(REVISION_PREFIX.length);
  const separator = rest.lastIndexOf(":");
  if (separator <= 0) return null;
  const revision = Number(rest.slice(separator + 1));
  if (!Number.isSafeInteger(revision) || revision < 0) return null;
  return { propertyId: rest.slice(0, separator), revision };
}

/** The Blocks field a suggestion edits, or null when it edits the page body. */
export function suggestionBlocksFieldId(suggestion: {
  adapterKind: string;
  operations: ReadonlyArray<{ targetId?: string | null }>;
}): string | null {
  if (suggestion.adapterKind !== CONTENT_BLOCKS_FIELD_SUGGESTION_ADAPTER)
    return null;
  const targetId = suggestion.operations[0]?.targetId;
  return typeof targetId === "string" && targetId ? targetId : null;
}
