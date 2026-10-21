const DEFAULT_DESCRIPTION =
  "Read this public document in Agent-Native Content.";
const DEFAULT_MAX_LENGTH = 160;

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, "");
}

function stripFencedCode(markdown: string): string {
  // A closing fence is at least as long as the opening one and has nothing
  // after it, so a line like ```js inside the block doesn't close it.
  return markdown.replace(
    /(?:^|\n) {0,3}((`|~)\2{2,})[\s\S]*?(?:\n {0,3}\1\2*[ \t]*(?=\n|$)|$)/g,
    "\n",
  );
}

function decodeCommonEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeForComparison(text: string): string {
  return stripMarkdownForPreview(text)
    .normalize("NFC")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

function isTitleRepeat(text: string, title: string): boolean {
  const normalizedText = normalizeForComparison(text);
  const normalizedTitle = normalizeForComparison(title);
  return Boolean(normalizedText && normalizedText === normalizedTitle);
}

function isHeadingBlock(block: string): boolean {
  const trimmed = block.trim();
  if (/^#{1,6}\s+\S/.test(trimmed)) return true;
  if (/^<h[1-6]\b/i.test(trimmed)) return true;

  // Lines of paragraph text underlined with `=` or `-`. Under a list, quote
  // or table, a `---` is a divider instead.
  const lines = trimmed.split("\n");
  return (
    lines.length >= 2 &&
    /^\s*(=+|-+)\s*$/.test(lines[lines.length - 1]) &&
    lines
      .slice(0, -1)
      .every(
        (line) =>
          line.trim().length > 0 &&
          !/^\s{0,3}(?:(?:[-+*]|\d+[.)])(?:\s|$)|>|\|)/.test(line),
      )
  );
}

function isDividerBlock(block: string): boolean {
  return /^\s{0,3}(?:[-*_]\s*){3,}$/.test(block.trim());
}

export function stripMarkdownForPreview(markdown: string): string {
  return (
    decodeCommonEntities(markdown)
      .replace(/<[^>\n]+\/>/g, " ")
      .replace(/<\/?[^>\n]+>/g, " ")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\s+#+\s*$/gm, "")
      .replace(/^\s{0,3}>\s?/gm, "")
      .replace(/^\s*[-+*]\s+\[[ xX]\]\s+/gm, "")
      .replace(/^\s*[-+*]\s+/gm, "")
      .replace(/^\s*\d+[.)]\s+/gm, "")
      .replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/gm, " ")
      // Heading underlines and dividers that share a block with text.
      .replace(/^[ \t]{0,3}(?:=+|-+)[ \t]*$/gm, " ")
      .replace(/\|/g, " ")
      .replace(/\*\*([^*\n]+)\*\*/g, "$1")
      .replace(/__([^_\n]+)__/g, "$1")
      .replace(/\*([^*\n]+)\*/g, "$1")
      .replace(/_([^_\n]+)_/g, "$1")
      .replace(/~~([^~\n]+)~~/g, "$1")
      .replace(/\\([\\`*_[\]{}()#+\-.!|>])/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Ends text with "...", shortening it at a word so the whole fits. */
function withEllipsis(text: string, maxLength: number): string {
  const hardLimit = Math.max(20, maxLength - 3);
  let kept = text;
  if (kept.length > hardLimit) {
    const prefix = kept.slice(0, hardLimit);
    const wordBoundary = prefix.lastIndexOf(" ");
    kept =
      wordBoundary > hardLimit * 0.6 ? prefix.slice(0, wordBoundary) : prefix;
  }

  return `${kept.replace(/[.,;:!?\s-]+$/g, "")}...`;
}

function truncateDescription(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : withEllipsis(text, maxLength);
}

export function buildPublicDocumentDescription({
  content,
  title,
  maxLength = DEFAULT_MAX_LENGTH,
}: {
  content?: string | null;
  title?: string | null;
  maxLength?: number;
}): string {
  const normalizedContent = stripFencedCode(
    stripFrontmatter(content?.replace(/\r\n?/g, "\n") ?? ""),
  );
  const blocks = normalizedContent.split(/\n{2,}/);
  const fallbackText: string[] = [];

  for (const block of blocks) {
    if (!block.trim() || isDividerBlock(block)) continue;

    const stripped = stripMarkdownForPreview(block);
    if (!stripped) continue;

    fallbackText.push(stripped);
    if (isHeadingBlock(block) || isTitleRepeat(stripped, title ?? "")) {
      continue;
    }

    return truncateDescription(stripped, maxLength);
  }

  const fallback = fallbackText.find(
    (text) => !isTitleRepeat(text, title ?? ""),
  );

  return fallback
    ? truncateDescription(fallback, maxLength)
    : DEFAULT_DESCRIPTION;
}

const DEFAULT_EXCERPT_LENGTH = 300;
/** Scripts written without spaces between words. */
const SPACELESS_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/**
 * Plain text from the start of a page body, for a list row. Images, code,
 * dividers and a first paragraph that repeats the title drop out, and
 * headings only count when the page has no other text. `truncated` means the
 * markdown is only the body's first part, so it may end partway through;
 * `nextCharacter`, when known, tells whether its last word goes on.
 */
export function buildDocumentExcerpt({
  content,
  title,
  truncated = false,
  nextCharacter,
  maxLength = DEFAULT_EXCERPT_LENGTH,
}: {
  content?: string | null;
  title?: string | null;
  truncated?: boolean;
  nextCharacter?: string;
  maxLength?: number;
}): string {
  let markdown = content?.replace(/\r\n?/g, "\n") ?? "";
  // Frontmatter puts a `key:` line right after its opening `---`; a divider at
  // the top of a page is followed by text or a blank line.
  if (/^---[ \t]*\n[\p{L}\p{N}_"'-][^\n]*:/u.test(markdown)) {
    const body = stripFrontmatter(markdown);
    // A prefix that ends inside the frontmatter has no body text yet.
    if (body !== markdown) markdown = body;
    else if (truncated) return "";
  }
  if (truncated) {
    // Drop a link, image or tag the cut leaves open, and a word it splits. A
    // cut right after punctuation or closing markup ends a whole word, and
    // text in a script written without spaces has no word to finish.
    markdown = markdown
      .replace(/!?\[[^\]\n]*(?:\]\([^)\n]*)?$/, "")
      .replace(/<[A-Za-z/!][^>\n]*$/, "");
    const lastWord = /\s([\p{L}\p{M}\p{N}]+)$/u.exec(markdown)?.[1];
    const wordGoesOn =
      nextCharacter === undefined || /[\p{L}\p{M}\p{N}]/u.test(nextCharacter);
    if (lastWord && wordGoesOn && !SPACELESS_SCRIPT.test(lastWord)) {
      markdown = markdown.slice(0, -lastWord.length);
    }
  }
  const blocks = stripFencedCode(markdown)
    // Headings and dividers stand alone even without blank lines around them.
    // A line of `=` or `-` right under a line of text underlines it as a
    // heading, so it stays with that line.
    .replace(/^ {0,3}#{1,6}[ \t].*$/gm, "\n$&\n")
    .replace(/(?<=\S[^\n]*\n) {0,3}(?:=+|-+)[ \t]*$/gm, "$&\n")
    .replace(/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/gm, "\n")
    .replace(/(^|\n\n)[ \t]{0,3}(?:[-*_][ \t]*){3,}(?=\n|$)/g, "$1\n")
    .split(/\n{2,}/);
  const paragraphs: string[] = [];
  const headings: string[] = [];
  let length = 0;
  for (const block of blocks) {
    if (length > maxLength) break;
    if (!block.trim() || isDividerBlock(block)) continue;
    const text = stripMarkdownForPreview(
      block.replace(/!\[[^\]]*\]\([^)]*\)/g, " "),
    );
    if (!text) continue;
    if (isHeadingBlock(block)) {
      headings.push(text);
    } else if (paragraphs.length > 0 || !isTitleRepeat(text, title ?? "")) {
      paragraphs.push(text);
      length += text.length + 1;
    }
  }
  const text = (paragraphs.length > 0 ? paragraphs : headings).join(" ");
  if (text.length > maxLength) return truncateDescription(text, maxLength);
  return truncated && text ? withEllipsis(text, maxLength) : text;
}

/**
 * How much of a page body a list row's excerpt reads: enough markdown for
 * three lines of text once links and formatting are stripped.
 */
export const EXCERPT_SOURCE_CHARS = 1000;

/**
 * A list row's excerpt, from only the first `EXCERPT_SOURCE_CHARS` characters
 * of the page body. A whole body and a list read's prefix, which takes one
 * character more to tell a longer body from one that fits, give the same text.
 */
export function buildListRowExcerpt({
  content,
  title,
}: {
  content?: string | null;
  title?: string | null;
}): string {
  // Count characters the way the database does, not UTF-16 units. No
  // character takes more than two units.
  const characters = Array.from(
    (content ?? "").slice(0, 2 * (EXCERPT_SOURCE_CHARS + 1)),
  );
  return buildDocumentExcerpt({
    content: characters.slice(0, EXCERPT_SOURCE_CHARS).join(""),
    title,
    truncated: characters.length > EXCERPT_SOURCE_CHARS,
    nextCharacter: characters[EXCERPT_SOURCE_CHARS],
  });
}
