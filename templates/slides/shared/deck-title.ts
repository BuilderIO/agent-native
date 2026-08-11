const GENERATED_TITLE_PLACEHOLDERS = new Set([
  "deck",
  "date",
  "image slide title",
  "presentation title",
  "section",
  "section title",
  "slide title",
  "untitled",
  "untitled deck",
  "your name",
]);

/**
 * Generated deck ids should never become user-facing titles. Keep this
 * deliberately narrow so normal titles with spaces and punctuation remain
 * valid, while catching opaque mixed-case tokens such as H3sVsnns-TEVUOpz9w.
 */
const OPAQUE_DECK_TITLE_PATTERN =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z0-9_-]{12,64}$/;

export const DEFAULT_DECK_TITLE = "Untitled Deck";

export function isOpaqueDeckTitle(value: unknown): value is string {
  return (
    typeof value === "string" && OPAQUE_DECK_TITLE_PATTERN.test(value.trim())
  );
}

export function isGeneratedDeckTitle(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const title = value.trim();
  return (
    GENERATED_TITLE_PLACEHOLDERS.has(title.toLowerCase()) ||
    isOpaqueDeckTitle(title)
  );
}

function decodeHtmlEntities(value: string): string {
  const decodeCodePoint = (raw: string, radix: number): string => {
    const codePoint = Number.parseInt(raw, radix);
    return Number.isNaN(codePoint) || codePoint > 0x10ffff
      ? ""
      : String.fromCodePoint(codePoint);
  };

  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/(?:&#39;|&apos;)/gi, "'")
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => decodeCodePoint(hex, 16))
    .replace(/&#(\d+);?/g, (_, digits: string) => decodeCodePoint(digits, 10));
}

function plainText(value: string): string {
  return decodeHtmlEntities(
    value.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function usableCandidate(value: string): string | null {
  const candidate = plainText(value).replace(/^[•●▪‣\-\s]+/, "");
  if (!candidate || candidate.length > 140) return null;
  if (GENERATED_TITLE_PLACEHOLDERS.has(candidate.toLowerCase())) return null;
  return candidate;
}

/**
 * Recover a deck title from the largest title-like text in its first slide.
 * This is intentionally HTML-string based because the action runs on the
 * server without a browser DOM.
 */
export function deriveDeckTitleFromSlideContent(
  content: unknown,
): string | null {
  if (typeof content !== "string" || !content.trim()) return null;

  const candidates: Array<{ score: number; text: string }> = [];
  const headingPattern = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of content.matchAll(headingPattern)) {
    const text = usableCandidate(match[2] ?? "");
    if (text) {
      const level = Number.parseInt(match[1].slice(1), 10);
      candidates.push({ score: 1000 - level * 10, text });
    }
  }

  const styledTextPattern =
    /<([a-z][\w:-]*)\b[^>]*\bstyle\s*=\s*(["'])([\s\S]*?)\2[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of content.matchAll(styledTextPattern)) {
    const fontSize = Number.parseFloat(
      match[3]?.match(/(?:^|;)\s*font-size\s*:\s*([\d.]+)px/i)?.[1] ?? "0",
    );
    if (fontSize < 28) continue;
    const text = usableCandidate(match[4] ?? "");
    if (text) candidates.push({ score: fontSize, text });
  }

  return candidates.sort((a, b) => b.score - a.score)[0]?.text ?? null;
}

/**
 * Return a human-readable replacement only when the requested title is a
 * generated placeholder or opaque id. A meaningful existing title wins when
 * a stale full-payload save tries to replace it with a generated value.
 */
export function repairGeneratedDeckTitle(
  requestedTitle: unknown,
  firstSlideContent: unknown,
  existingTitle?: unknown,
): string | null {
  if (!isGeneratedDeckTitle(requestedTitle)) return null;

  return (
    deriveDeckTitleFromSlideContent(firstSlideContent) ??
    (typeof existingTitle === "string" &&
    existingTitle.trim() &&
    !isGeneratedDeckTitle(existingTitle)
      ? existingTitle
      : null)
  );
}

export function assertHumanReadableDeckTitle(title: string): void {
  if (isOpaqueDeckTitle(title)) {
    throw new Error(
      "Deck title must be a concise, human-readable title; generated ids are not valid titles.",
    );
  }
}
