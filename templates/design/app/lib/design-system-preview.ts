const DEFAULT_OBJECT_ENTRY_LIMIT = 8;

export function formatDesignTokenValue(value: unknown): string | undefined {
  return formatTokenValue(value, new Set());
}

export function getCssColorToken(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  for (const nested of Object.values(value)) {
    const candidate = getCssColorToken(nested);
    if (candidate) return candidate;
  }

  return undefined;
}

function formatTokenValue(
  value: unknown,
  seenObjects: Set<object>,
): string | undefined {
  if (value === null || value === undefined) return undefined;

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => formatTokenValue(item, seenObjects))
      .filter((item): item is string => Boolean(item));
    return parts.length > 0 ? parts.join(", ") : undefined;
  }

  if (typeof value !== "object") return undefined;

  if (seenObjects.has(value)) return undefined;
  seenObjects.add(value);

  const entries = Object.entries(value)
    .map(([key, nestedValue]) => {
      const formatted = formatTokenValue(nestedValue, seenObjects);
      return formatted ? `${labelizeDesignTokenKey(key)}: ${formatted}` : null;
    })
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, DEFAULT_OBJECT_ENTRY_LIMIT);

  seenObjects.delete(value);
  return entries.length > 0 ? entries.join(", ") : undefined;
}

function labelizeDesignTokenKey(key: string) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/[-_]/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}
