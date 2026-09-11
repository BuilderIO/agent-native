export function queryUniqueSelector(
  root: ParentNode,
  selector: string,
): Element | null {
  try {
    const matches = root.querySelectorAll(selector);
    return matches.length === 1 ? (matches[0] ?? null) : null;
  } catch {
    return null;
  }
}

export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeHtmlAttributeValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
