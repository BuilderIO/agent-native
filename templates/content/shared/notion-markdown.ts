export const VISUAL_INDENT = "\u00A0\u00A0";

const LEGACY_TOGGLE_RE = /^(?:[-*]\s+)?(?:▶|▾)\s+(.*)$/;
const CODE_FENCE_RE = /^```/;

function normalizeLineEndings(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n");
}

function getLeadingIndent(rawLine: string): { indent: number; text: string } {
  let index = 0;
  let indent = 0;

  while (index < rawLine.length) {
    if (rawLine.startsWith(VISUAL_INDENT, index)) {
      indent++;
      index += VISUAL_INDENT.length;
      continue;
    }
    if (rawLine.startsWith("  ", index)) {
      indent++;
      index += 2;
      continue;
    }
    if (rawLine[index] === "\t") {
      indent++;
      index += 1;
      continue;
    }
    break;
  }

  return { indent, text: rawLine.slice(index) };
}

function prefixIndent(indent: number): string {
  return "\t".repeat(Math.max(0, indent));
}

function normalizeLegacyStructure(markdown: string): string {
  const lines = normalizeLineEndings(markdown).split("\n");
  const output: string[] = [];
  const toggleStack: number[] = [];
  let inCodeFence = false;

  const closeTogglesTo = (indent: number) => {
    while (
      toggleStack.length &&
      toggleStack[toggleStack.length - 1] >= indent
    ) {
      output.push(`${prefixIndent(toggleStack.pop()!)}</details>`);
    }
  };

  for (const rawLine of lines) {
    const { indent, text } = getLeadingIndent(rawLine);
    const trimmed = text.trim();

    if (CODE_FENCE_RE.test(trimmed)) {
      if (!inCodeFence) {
        closeTogglesTo(indent + 1);
      }
      output.push(`${prefixIndent(indent)}${trimmed}`);
      inCodeFence = !inCodeFence;
      continue;
    }

    if (inCodeFence) {
      output.push(rawLine);
      continue;
    }

    if (!trimmed) {
      output.push("");
      continue;
    }

    closeTogglesTo(indent + 1);

    const toggleMatch = text.match(LEGACY_TOGGLE_RE);
    if (toggleMatch) {
      output.push(`${prefixIndent(indent)}<details>`);
      output.push(
        `${prefixIndent(indent)}<summary>${escapeHtml(toggleMatch[1].trim())}</summary>`,
      );
      toggleStack.push(indent);
      continue;
    }

    output.push(`${prefixIndent(indent)}${text}`);
  }

  closeTogglesTo(0);

  return output.join("\n");
}

function trimTrailingBlankLines(text: string): string {
  return text.replace(/\n+$/g, "");
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function serializeTagAttributes(
  attrs: Record<string, string | number | boolean | null | undefined>,
): string {
  const parts = Object.entries(attrs)
    .filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    )
    .map(([key, value]) => `${key}="${escapeHtml(String(value))}"`);

  return parts.length ? ` ${parts.join(" ")}` : "";
}

export function indentMarkdown(markdown: string, prefix = "\t"): string {
  return markdown
    .split("\n")
    .map((line) => (line ? `${prefix}${line}` : line))
    .join("\n");
}

export function legacyMarkdownToNfm(markdown: string): string {
  return trimTrailingBlankLines(normalizeLegacyStructure(markdown));
}

export function normalizeNfmForStorage(markdown: string): string {
  return legacyMarkdownToNfm(markdown);
}

export function parseNfmForEditor(markdown: string): string {
  return normalizeNfmForStorage(markdown);
}

export function serializeEditorToNfm(markdown: string): string {
  return normalizeNfmForStorage(markdown);
}
