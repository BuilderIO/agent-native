export function databaseFilterSelectedValues(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return [trimmed];
    return [
      ...new Set(
        parsed
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
  } catch {
    return [trimmed];
  }
}

export function databaseFilterEncodeSelectedValues(values: string[]) {
  const normalized = [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ];
  // Several values are stored as a JSON list, one as itself, none as "".
  if (normalized.length > 1) return JSON.stringify(normalized);
  return normalized.join("");
}
