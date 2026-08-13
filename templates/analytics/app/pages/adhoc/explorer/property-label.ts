const PROPERTY_ACRONYMS: Record<string, string> = {
  api: "API",
  fbclid: "FBCLID",
  gclid: "GCLID",
  id: "ID",
  url: "URL",
  utm: "UTM",
};

export function formatExplorerPropertyLabel(property: string): string {
  const trimmed = property.trim();
  if (!trimmed) return property;

  const spaced = trimmed
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

  if (!spaced) return property;

  return spaced
    .split(" ")
    .map((word, index) => {
      const lower = word.toLowerCase();
      return (
        PROPERTY_ACRONYMS[lower] ??
        (index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower)
      );
    })
    .join(" ");
}
