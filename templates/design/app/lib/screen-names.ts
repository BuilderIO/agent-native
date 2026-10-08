export function prettyScreenName(filename: string): string {
  const dot = filename.lastIndexOf(".");
  let stem = dot > 0 ? filename.slice(0, dot) : filename;
  if (stem.toLowerCase() === "index") return "Home";
  if (stem.toLowerCase().startsWith("page-")) stem = stem.slice(5);
  const spaced = stem.replace(/[-_]+/g, " ").trim();
  if (spaced.length === 0) return filename;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
