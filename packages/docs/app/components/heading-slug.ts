/**
 * Slugify heading text into a stable anchor id. Keeps any Unicode letter,
 * combining mark, or digit — so a heading written entirely in a non-Latin
 * script (Chinese, Japanese, Korean, Arabic, Devanagari, ...) still gets a
 * real, non-empty id instead of collapsing to "", and scripts that rely on
 * combining marks (Devanagari vowel signs, Arabic diacritics) keep them
 * instead of being reduced to bare consonants. Hyphenates whitespace/
 * punctuation runs. Matches the previous ASCII-only behavior byte-for-byte
 * for Latin-script headings, so existing English anchors are unaffected.
 */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{M}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
