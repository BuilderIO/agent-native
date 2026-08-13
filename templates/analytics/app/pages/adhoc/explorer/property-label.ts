export function formatExplorerPropertyLabel(property: string): string {
  const trimmed = property.trim();
  if (!trimmed) return property;

  const spaced = trimmed
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

  if (!spaced) return property;

  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
