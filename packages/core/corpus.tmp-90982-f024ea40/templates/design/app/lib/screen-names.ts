/**
 * Convert a design file's raw filename ("mobile.html", "page-pricing.html",
 * "index.html") into a designer-friendly screen name shown in viewport tabs
 * and the overview lineup. The underlying filename is still the source of
 * truth for actions / disk paths — this is purely a display transform.
 *
 * Rules, in order:
 *   1. Strip the file extension.
 *   2. `index` → `Home` (so the canonical entry point reads as a screen name,
 *      not a routing artifact).
 *   3. Drop a leading `page-` (a common pattern when an agent names a
 *      multi-page prototype: `page-pricing.html` should read as "Pricing",
 *      not "Page pricing").
 *   4. Replace `-` and `_` with spaces.
 *   5. Title-case the first letter; leave the rest alone so acronyms like
 *      "FAQ" or "API" survive uppercase if the filename used them.
 *
 * Examples:
 *   index.html         → Home
 *   mobile.html        → Mobile
 *   dashboard.html     → Dashboard
 *   page-pricing.html  → Pricing
 *   page-about-us.html → About us
 *   styles.css         → Styles
 *   FAQ.html           → FAQ
 */
export function prettyScreenName(filename: string): string {
  const dot = filename.lastIndexOf(".");
  let stem = dot > 0 ? filename.slice(0, dot) : filename;
  if (stem.toLowerCase() === "index") return "Home";
  if (stem.toLowerCase().startsWith("page-")) stem = stem.slice(5);
  const spaced = stem.replace(/[-_]+/g, " ").trim();
  if (spaced.length === 0) return filename;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
