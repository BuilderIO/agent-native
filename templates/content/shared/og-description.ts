const DEFAULT_DESCRIPTION = "Read this public document in Agent-Native Content.";
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
    .replace(/[^a-z0-9]+/g, " ")
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

function truncateDescription(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const hardLimit = Math.max(20, maxLength - 3);
  const prefix = text.slice(0, hardLimit);
  const wordBoundary = prefix.lastIndexOf(" ");
  const truncated =
    wordBoundary > hardLimit * 0.6 ? prefix.slice(0, wordBoundary) : prefix;

  return `${truncated.replace(/[.,;:!?\s-]+$/g, "")}...`;
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
