function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * The linked design system id can live on the row's own column or, for a
 * deck saved before that column existed, inside its JSON `data`. Callers must
 * check both, so this is the one place that order is decided.
 */
export function resolveDeckDesignSystemId(
  row: { designSystemId?: string | null },
  data: unknown,
): string | null {
  if (typeof row.designSystemId === "string" && row.designSystemId) {
    return row.designSystemId;
  }
  const fromData = (data as { designSystemId?: unknown } | null)
    ?.designSystemId;
  return typeof fromData === "string" && fromData ? fromData : null;
}

export function deckContentSignature(raw: unknown): string {
  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    const clone = JSON.parse(JSON.stringify(data ?? {}));
    if (clone && typeof clone === "object" && !Array.isArray(clone)) {
      delete (clone as Record<string, unknown>).updatedAt;
    }
    return stableStringify(clone);
  } catch {
    return typeof raw === "string" ? raw : (JSON.stringify(raw ?? "") ?? "");
  }
}
