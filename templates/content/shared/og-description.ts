const DEFAULT_DESCRIPTION =
  "Read this public document in Agent-Native Content.";
const DEFAULT_MAX_LENGTH = 160;

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, "");
}

function stripFencedCode(markdown: string): string {
  return markdown.replace(/(?:^|\n)(```|~~~)[\s\S]*?(?:\n\1[ \t]*|$)/g, "\n");
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
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
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

  const lines = trimmed.split("\n");
  return (
    lines.length === 2 &&
    lines[0].trim().length > 0 &&
    /^\s*(=+|-+)\s*$/.test(lines[1])
  );
}

function isDividerBlock(block: string): boolean {
  return /^\s{0,3}(?:[-*_]\s*){3,}$/.test(block.trim());
}

export function stripMarkdownForPreview(markdown: string): string {
  return decodeCommonEntities(markdown)
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
    .replace(/\|/g, " ")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/~~([^~\n]+)~~/g, "$1")
    .replace(/\\([\\`*_[\]{}()#+\-.!|>])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
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
/** Marks where a truncated body ends. Postgres text can't hold it. */
const PREFIX_END = "\u0000";

/**
 * Plain text from the start of a page body, for a list row. Images, code,
 * dividers and a first paragraph that repeats the title drop out, and
 * headings only count when the page has no other text. `truncated` means the
 * markdown is only the body's first part, so its last word may be cut short.
 */
export function buildDocumentExcerpt({
  content,
  title,
  truncated = false,
  maxLength = DEFAULT_EXCERPT_LENGTH,
}: {
  content?: string | null;
  title?: string | null;
  truncated?: boolean;
  maxLength?: number;
}): string {
  let markdown = content?.replace(/\r\n?/g, "\n") ?? "";
  // Frontmatter puts a `key:` line right after its opening `---`; a divider at
  // the top of a page is followed by text or a blank line.
  if (/^---[ \t]*\n[\w"'-][^\n]*:/.test(markdown)) {
    const body = stripFrontmatter(markdown);
    // A prefix that ends inside the frontmatter has no body text yet.
    if (body !== markdown) markdown = body;
    else if (truncated) return "";
  }
  if (truncated) {
    // Drop a link or image the cut leaves open, and mark the end so a word is
    // dropped only when the cut splits text the excerpt keeps.
    markdown = `${markdown.replace(/!?\[[^\]\n]*(?:\]\([^)\n]*)?$/, "")}${PREFIX_END}`;
  }
  const blocks = stripFencedCode(markdown)
    // Headings and dividers stand alone even without blank lines around them.
    // A `---` right under a line of text underlines a heading, so it stays.
    .replace(/^#{1,6}[ \t].*$/gm, "\n$&\n")
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
  const joined = (paragraphs.length > 0 ? paragraphs : headings).join(" ");
  const cutsWord =
    joined.endsWith(PREFIX_END) && /\S/.test(joined.at(-2) ?? "");
  const text = joined.replace(PREFIX_END, "").trimEnd();
  if (text.length > maxLength) return truncateDescription(text, maxLength);
  if (!truncated || !text) return text;
  const wordBoundary = cutsWord ? text.lastIndexOf(" ") : -1;
  return withEllipsis(
    wordBoundary > 0 ? text.slice(0, wordBoundary) : text,
    maxLength,
  );
}
