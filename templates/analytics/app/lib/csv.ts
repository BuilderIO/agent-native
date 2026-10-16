export function csvCell(
  value: unknown,
  options: { alwaysQuote?: boolean; displayValue?: string } = {},
): string {
  let text = options.displayValue ?? csvText(value);
  if (
    typeof value !== "number" &&
    typeof value !== "boolean" &&
    /^[\s\u0000-\u001f\u007f]*[=+\-@]/.test(text)
  ) {
    text = `'${text}`;
  }

  if (options.alwaysQuote || /[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function csvText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value) ?? "";
}
