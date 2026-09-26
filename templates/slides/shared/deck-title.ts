export const DEFAULT_DECK_TITLE = "Untitled Deck";
export const DEFAULT_IMPORTED_DECK_TITLE = "New Presentation";

const IMPORTED_TITLE_PLACEHOLDERS = new Set([
  "untitled deck",
  "untitled file",
  "untitled presentation",
  "untitled scene",
  "untitled slide",
  "imported file",
  "imported document",
  "imported presentation",
  DEFAULT_IMPORTED_DECK_TITLE.toLowerCase(),
]);

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
  ...IMPORTED_TITLE_PLACEHOLDERS,
]);

const OPAQUE_DECK_TITLE_PATTERN = /^[A-Za-z0-9_-]{12,64}$/;

export function isOpaqueDeckTitle(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const title = value.trim();
  if (!OPAQUE_DECK_TITLE_PATTERN.test(title)) return false;

  return title
    .split(/[-_]/)
    .some(
      (part) =>
        part.length >= 8 &&
        /[a-z]/.test(part) &&
        /[A-Z]/.test(part) &&
        /\d/.test(part),
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

export function summarizeSlideContent(content: unknown): string {
  if (typeof content !== "string") return "";
  const text = plainText(content);
  if (text.length <= 160) return text;
  const cut = text.lastIndexOf(" ", 157);
  return `${text.slice(0, cut > 0 ? cut : 157).trimEnd()}…`;
}

function plainTextLines(value: string): string[] {
  return decodeHtmlEntities(
    value.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/gi, "\n"),
  )
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function usableCandidate(value: string): string | null {
  const candidate = plainText(value).replace(/^[•●▪‣\-\s]+/, "");
  if (!candidate || candidate.length > 140) return null;
  if (isGeneratedDeckTitle(candidate)) return null;
  return candidate;
}

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

  const styledOpeningPattern =
    /<([a-z][\w:-]*)\b[^>]*\bstyle\s*=\s*(["'])([\s\S]*?)\2[^>]*>/gi;
  for (const match of content.matchAll(styledOpeningPattern)) {
    const fontSize = Number.parseFloat(
      match[3]?.match(/(?:^|;)\s*font-size\s*:\s*([\d.]+)px/i)?.[1] ?? "0",
    );
    if (fontSize < 28) continue;

    const bodyStart = (match.index ?? 0) + match[0].length;
    const closingTag = new RegExp(`</${match[1]}\\s*>`, "i").exec(
      content.slice(bodyStart),
    );
    const body = closingTag
      ? content.slice(bodyStart, bodyStart + closingTag.index)
      : "";
    const text = usableCandidate(body);
    if (text) candidates.push({ score: fontSize, text });
  }

  const fallbackLines = plainTextLines(content);
  const hasMarkup = /<[^>]+>/.test(content);
  if (fallbackLines.length > 1 || !hasMarkup) {
    for (const line of fallbackLines) {
      const text = usableCandidate(line);
      if (text) {
        candidates.push({ score: 1, text });
        break;
      }
    }
  }

  return candidates.sort((a, b) => b.score - a.score)[0]?.text ?? null;
}

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

export function resolveImportedDeckTitle(
  requestedTitle: unknown,
  firstSlideContent: unknown,
  fallbackTitle?: unknown,
): string {
  const title = usableCandidate(
    typeof requestedTitle === "string" ? requestedTitle : "",
  );
  if (title) return title;

  const derivedTitle = deriveDeckTitleFromSlideContent(firstSlideContent);
  if (derivedTitle) return derivedTitle;

  const fallback = usableCandidate(
    typeof fallbackTitle === "string" ? fallbackTitle : "",
  );
  return fallback ?? DEFAULT_IMPORTED_DECK_TITLE;
}

export function assertHumanReadableDeckTitle(title: string): void {
  if (isOpaqueDeckTitle(title)) {
    throw new Error(
      "Deck title must be a concise, human-readable title; generated ids are not valid titles.",
    );
  }
}
