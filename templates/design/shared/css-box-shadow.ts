export interface ParsedComputedBoxShadow {
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: string;
  inset?: boolean;
}

/** Split on top-level commas only — not inside color functions. */
export function splitTopLevelCommas(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const LENGTH_RE = /(-?[\d.]+)px/g;

export function parseComputedBoxShadow(
  value: string | null | undefined,
): ParsedComputedBoxShadow[] {
  if (!value || value === "none") return [];
  return splitTopLevelCommas(value).map((part) => {
    const inset = /\binset\b/.test(part);
    const withoutInset = part.replace(/\binset\b/g, "").trim();
    const colorMatch = withoutInset.match(
      /^(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}|[a-zA-Z]+)/,
    );
    // guard:allow-raw-color — exported SVG paint read from the design's own computed styles, never app UI
    const color = colorMatch ? colorMatch[0] : "rgb(0, 0, 0)";
    const rest = colorMatch
      ? withoutInset.slice(colorMatch[0].length)
      : withoutInset;
    const lengths = Array.from(rest.matchAll(LENGTH_RE)).map((m) =>
      Number.parseFloat(m[1]),
    );
    const [offsetX = 0, offsetY = 0, blur = 0, spread = 0] = lengths;
    return { offsetX, offsetY, blur, spread, color, inset };
  });
}
