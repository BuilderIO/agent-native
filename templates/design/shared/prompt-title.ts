const PLACEHOLDER_MAX = 40;
const GENERATED_MAX = 60;
const TITLE_CASE_MINOR_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "vs",
  "with",
]);

export function derivePromptTitle(prompt: string): string {
  const firstLine = prompt
    .split("\n")[0]
    ?.trim()
    .replace(/[.!?]+$/, "");
  if (!firstLine) return "Untitled Design";
  if (firstLine.length <= PLACEHOLDER_MAX) return firstLine;
  const slice = firstLine.slice(0, PLACEHOLDER_MAX);
  const lastSpace = slice.lastIndexOf(" ");
  const trimmed = lastSpace > 20 ? slice.slice(0, lastSpace) : slice;
  return `${trimmed.trim()}…`;
}

function toTitleCase(value: string): string {
  const words = value.split(/\s+/).filter(Boolean);
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (word.length > 1 && word === word.toUpperCase()) return word;
      if (index > 0 && TITLE_CASE_MINOR_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

export function sanitizeGeneratedDesignTitle(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;

  value = value.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  value = value.replace(/^(title|name)\s*:\s*/i, "").trim();
  value = value.replace(/\s+/g, " ").trim();
  value = value.replace(/[.!?:;,]+$/, "").trim();

  if (!value) return null;
  if (value.length > GENERATED_MAX) {
    value = value.slice(0, GENERATED_MAX).trim();
  }

  return toTitleCase(value);
}
