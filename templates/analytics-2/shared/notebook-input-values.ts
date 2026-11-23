export function isNumericNotebookInput(value: string): boolean {
  return (
    /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value) &&
    Number.isFinite(Number(value))
  );
}

export function parseMultiValue(value: string): string[] {
  if (value.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}
