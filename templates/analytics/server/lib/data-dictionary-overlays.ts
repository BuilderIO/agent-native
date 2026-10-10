type DictionaryEntry = Record<string, unknown>;

const SOURCE_INDEX_FIELDS = [
  "status",
  "aiGenerated",
  "sourceIndex",
  "sourcePath",
  "sourceRevision",
  "sourceIndexGeneratedAt",
  "sourceIndexSources",
] as const;

function hasOverlayValue(value: unknown): boolean {
  return (
    value !== null &&
    value !== undefined &&
    (typeof value !== "string" || value.trim().length > 0) &&
    (!Array.isArray(value) || value.length > 0)
  );
}

function populatedFields(entry: DictionaryEntry): DictionaryEntry {
  return Object.fromEntries(
    Object.entries(entry).filter(([, value]) => hasOverlayValue(value)),
  );
}

export function mergeDataDictionaryEntry(
  existing: DictionaryEntry,
  incoming: DictionaryEntry,
): DictionaryEntry {
  const generated =
    incoming.sourceIndex === true
      ? incoming
      : existing.sourceIndex === true
        ? existing
        : null;
  const overlay =
    incoming.sourceIndex === true
      ? populatedFields(existing)
      : {
          ...populatedFields(existing),
          ...populatedFields(incoming),
        };
  const merged = {
    ...(generated ?? existing),
    ...overlay,
  };

  if (generated) {
    for (const field of SOURCE_INDEX_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(generated, field)) {
        merged[field] = generated[field];
      } else {
        delete merged[field];
      }
    }
  }

  return merged;
}
