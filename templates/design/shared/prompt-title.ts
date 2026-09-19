/**
 * Title derivation for designs created from a generation prompt.
 *
 * Two title sources are used together:
 * - `derivePromptTitle` produces an instant, purely local placeholder (first
 *   line of the prompt, truncated at a word boundary) so the UI has
 *   something to show the moment the design is created.
 * - `sanitizeGeneratedDesignTitle` normalizes whatever a model returns for
 *   the real AI-generated title (see `generate-design-title` action) into
 *   the same short, Title-Case, punctuation-free style used for chat names.
 */

const PLACEHOLDER_MAX = 40;
const GENERATED_MAX = 60;
// Small words stay lowercase in Title Case unless they're the first word.
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

/**
 * Derive a short, friendly placeholder title from a prompt. The full prompt
 * still drives generation — this is just a label that shows up in the editor
 * header and the design card until the AI-generated title resolves.
 *
 * Strategy: take the first line, strip trailing punctuation, then truncate
 * at the nearest word boundary near 40 chars (with an ellipsis when cut).
 */
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
      // Preserve words that are already all-caps (acronyms like "AI", "UI").
      if (word.length > 1 && word === word.toUpperCase()) return word;
      if (index > 0 && TITLE_CASE_MINOR_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/**
 * Normalize a model-generated design title into the framework's short-name
 * style: no surrounding quotes, no trailing punctuation, collapsed
 * whitespace, Title Case, and capped at a sane length. Returns `null` when
 * the input doesn't yield a usable title so callers can fall back to the
 * prompt-derived placeholder instead of persisting junk.
 */
export function sanitizeGeneratedDesignTitle(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;

  // Strip a single layer of wrapping quotes the model sometimes adds.
  value = value.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  // Drop a leading "Title:" style prefix some models add.
  value = value.replace(/^(title|name)\s*:\s*/i, "").trim();
  // Collapse whitespace/newlines.
  value = value.replace(/\s+/g, " ").trim();
  // Strip trailing punctuation (periods, exclamation/question marks, colons).
  value = value.replace(/[.!?:;,]+$/, "").trim();

  if (!value) return null;
  if (value.length > GENERATED_MAX) {
    value = value.slice(0, GENERATED_MAX).trim();
  }

  return toTitleCase(value);
}
