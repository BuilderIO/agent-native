export function sessionDateBound(
  value: string | null | undefined,
  endOfDay = false,
): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(
    `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`,
  );
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(value)
    ? date.toISOString()
    : undefined;
}

export function sessionDateForDisplay(
  dateOnly: string | null | undefined,
  bound: string | null | undefined,
): string {
  if (dateOnly && sessionDateBound(dateOnly)) return dateOnly;
  if (!bound) return "";
  const date = new Date(bound);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}
