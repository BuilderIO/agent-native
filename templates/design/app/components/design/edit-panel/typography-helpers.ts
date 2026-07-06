export const FONT_FAMILY_OPTIONS = [
  { value: "inherit", key: "inherit" },
  { value: "sans-serif", key: "sansSerif" },
  { value: "serif", key: "serif" },
  { value: "monospace", key: "monospace" },
  { value: "'Inter', sans-serif", key: "inter" },
  { value: "'Poppins', sans-serif", key: "poppins" },
  { value: "'Playfair Display', serif", key: "playfairDisplay" },
  { value: "'JetBrains Mono', monospace", key: "jetBrainsMono" },
] as const;

export const FONT_WEIGHT_OPTIONS = [
  { value: "100", key: "thin" },
  { value: "200", key: "extraLight" },
  { value: "300", key: "light" },
  { value: "400", key: "regular" },
  { value: "500", key: "medium" },
  { value: "600", key: "semiBold" },
  { value: "700", key: "bold" },
  { value: "800", key: "extraBold" },
  { value: "900", key: "black" },
] as const;

export type TextResizeMode = "auto-width" | "auto-height" | "fixed";

function cleanFontFamilyName(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function splitFontFamilyList(value: string | undefined): string[] {
  const raw = value?.trim();
  if (!raw) return [];

  const families: string[] = [];
  let token = "";
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if ((char === '"' || char === "'") && raw[i - 1] !== "\\") {
      if (quote === char) quote = null;
      else if (!quote) quote = char;
      token += char;
      continue;
    }
    if (char === "," && !quote) {
      const cleaned = cleanFontFamilyName(token);
      if (cleaned) families.push(cleaned);
      token = "";
      continue;
    }
    token += char;
  }

  const cleaned = cleanFontFamilyName(token);
  if (cleaned) families.push(cleaned);
  return families;
}

function normalizeFontFamilyName(value: string): string {
  return cleanFontFamilyName(value).replace(/\s+/g, " ").toLowerCase();
}

function normalizeFontFamilyStack(value: string): string {
  return splitFontFamilyList(value).map(normalizeFontFamilyName).join(",");
}

export function displayFontFamilyName(value: string | undefined): string {
  const first = splitFontFamilyList(value)[0];
  if (!first) return "Sans Serif"; // i18n-ignore design generic font label

  const normalized = normalizeFontFamilyName(first);
  if (normalized === "sans-serif") {
    return "Sans Serif"; // i18n-ignore design generic font label
  }
  if (normalized === "serif") return "Serif"; // i18n-ignore design generic font label
  if (normalized === "monospace") {
    return "Monospace"; // i18n-ignore design generic font label
  }
  if (normalized === "system-ui" || normalized === "-apple-system") {
    return "System UI"; // i18n-ignore design generic font label
  }
  if (normalized === "blinkmacsystemfont") {
    return "Apple System"; // i18n-ignore design generic font label
  }
  return first;
}

export function resolveFontFamilySelectValue(
  value: string | undefined,
): string {
  const raw = value?.trim();
  if (!raw) return "sans-serif";

  const normalizedStack = normalizeFontFamilyStack(raw);
  const exactOption = FONT_FAMILY_OPTIONS.find(
    (option) => normalizeFontFamilyStack(option.value) === normalizedStack,
  );
  if (exactOption) return exactOption.value;

  const firstFamily = normalizeFontFamilyName(
    splitFontFamilyList(raw)[0] ?? "",
  );
  const firstFamilyOption = FONT_FAMILY_OPTIONS.find(
    (option) =>
      normalizeFontFamilyName(splitFontFamilyList(option.value)[0] ?? "") ===
      firstFamily,
  );
  return firstFamilyOption?.value ?? raw;
}
