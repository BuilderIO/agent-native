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

/**
 * Convert blockquote syntax (`> text`) back to tab-indented lines.
 * The editor uses blockquotes to display Notion-style indentation,
 * but NFM stores indentation as tabs. Without this, pushing to Notion
 * turns indented paragraphs into quote blocks.
 */
function blockquotesToIndent(markdown: string): string {
  const lines = normalizeLineEndings(markdown).split("\n");
  const result: string[] = [];
  let inCodeFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (CODE_FENCE_RE.test(trimmed)) inCodeFence = !inCodeFence;
    if (inCodeFence) {
      result.push(line);
      continue;
    }

    // Count leading `> ` markers and convert to tabs
    let depth = 0;
    let rest = line;
    while (rest.startsWith("> ")) {
      depth++;
      rest = rest.slice(2);
    }
    // Also handle `>` without trailing space at end of nested quotes
    if (depth > 0 && rest.startsWith(">")) {
      depth++;
      rest = rest.slice(1);
    }

    if (depth > 0) {
      result.push("\t".repeat(depth) + rest);
    } else {
      result.push(line);
    }
  }

  return result.join("\n");
}

/**
 * Preserve intentional empty lines as `<empty-block/>` tags.
 * In the editor, consecutive blank lines represent vertical spacing,
 * but markdown parsers collapse them. Converting extras to `<empty-block/>`
 * ensures they survive round-tripping.
 */
function preserveEmptyLines(markdown: string): string {
  const lines = normalizeLineEndings(markdown).split("\n");
  const result: string[] = [];
  let inCodeFence = false;
  // Track when the last push was an <empty-block/> converted from &nbsp;.
  // The blank line that follows is just a markdown paragraph separator and
  // must NOT be treated as an extra empty line — otherwise empty-block tags
  // inflate exponentially on every save/load cycle.
  let lastWasNbspBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (CODE_FENCE_RE.test(trimmed)) {
      inCodeFence = !inCodeFence;
      result.push(lines[i]);
      lastWasNbspBlock = false;
      continue;
    }
    if (inCodeFence) {
      result.push(lines[i]);
      lastWasNbspBlock = false;
      continue;
    }

    // Skip the structural paragraph-separator blank line after an &nbsp;
    // that was just converted to <empty-block/>
    if (trimmed === "" && lastWasNbspBlock) {
      lastWasNbspBlock = false;
      continue;
    }
    lastWasNbspBlock = false;

    // A blank line that follows another blank line is extra spacing
    if (trimmed === "" && i > 0) {
      const prevTrimmed =
        result.length > 0 ? result[result.length - 1].trim() : "";
      if (prevTrimmed === "" || prevTrimmed === "<empty-block/>") {
        result.push("<empty-block/>");
        continue;
      }
    }

    // &nbsp; used by editor for empty paragraphs → <empty-block/>
    if (trimmed === "&nbsp;") {
      result.push("<empty-block/>");
      lastWasNbspBlock = true;
      continue;
    }

    result.push(lines[i]);
  }

  return result.join("\n");
}

export function normalizeNfmForStorage(markdown: string): string {
  return legacyMarkdownToNfm(preserveEmptyLines(blockquotesToIndent(markdown)));
}

export function parseNfmForEditor(markdown: string): string {
  const normalized = normalizeNfmForStorage(markdown);
  return convertNfmToEditorMarkdown(normalized);
}

/**
 * Convert Notion-flavored markdown (NFM) to standard markdown that
 * TipTap/markdown-it can parse.
 *
 * Three issues with raw NFM in a standard markdown parser:
 *
 * 1. `<empty-block/>` has no TipTap extension → adjacent blocks merge.
 * 2. A leading tab triggers an indented code block, not visual nesting.
 * 3. Content inside `<details>` is treated as raw HTML by markdown-it,
 *    so tab-indented markdown inside toggles is never parsed.
 * 4. Notion treats every line as a separate block, but consecutive lines
 *    without blank-line separation are one paragraph in standard markdown.
 *
 * The conversion runs in three passes:
 *   Pass 1 – Convert `<details>` inner content from NFM to HTML.
 *   Pass 2 – Rewrite `<empty-block/>` → blank lines, tabs → list items.
 *   Pass 3 – Insert blank lines between consecutive plain-text paragraphs.
 */
function convertNfmToEditorMarkdown(nfm: string): string {
  let result = convertHtmlContainerContent(nfm);
  result = convertNfmBlocks(result);
  result = ensureParagraphSeparation(result);
  return result;
}

// ── Pass 1: Convert HTML container inner content to HTML ─────────────
// markdown-it doesn't parse markdown inside HTML blocks, so content
// inside <details>, <callout>, <columns>, and <column> must be actual HTML elements.
const HTML_CONTENT_CONTAINERS = /^<(details|callout|columns|column)\b/;
const HTML_CONTENT_CLOSE = /^<\/(details|callout|columns|column)>/;

function convertHtmlContainerContent(nfm: string): string {
  const lines = nfm.split("\n");
  const output: string[] = [];
  let inCodeFence = false;
  let containerDepth = 0;
  let capturedContent: string[] = [];
  let capturedOpen = "";
  let capturedSummary = "";

  for (const line of lines) {
    const trimmed = line.trim();

    if (CODE_FENCE_RE.test(trimmed) && containerDepth === 0) {
      inCodeFence = !inCodeFence;
      output.push(line);
      continue;
    }
    if (inCodeFence) {
      output.push(line);
      continue;
    }

    // Opening tag for containers whose content needs HTML conversion
    if (HTML_CONTENT_CONTAINERS.test(trimmed) && !trimmed.endsWith("/>")) {
      containerDepth++;
      if (containerDepth === 1) {
        capturedOpen = line;
        capturedSummary = "";
        capturedContent = [];
        continue;
      }
    }

    // <summary> only relevant for <details>
    if (
      containerDepth === 1 &&
      /^<summary>/.test(trimmed) &&
      !capturedSummary
    ) {
      capturedSummary = line;
      continue;
    }

    // Closing tag
    if (HTML_CONTENT_CLOSE.test(trimmed)) {
      if (containerDepth === 1) {
        output.push(capturedOpen);
        if (capturedSummary) output.push(capturedSummary);
        const htmlContent = nfmLinesToHtml(capturedContent);
        if (htmlContent) output.push(htmlContent);
        output.push(line);
      } else if (containerDepth > 1) {
        capturedContent.push(line);
      }
      containerDepth = Math.max(0, containerDepth - 1);
      continue;
    }

    if (containerDepth > 0) {
      capturedContent.push(line);
      continue;
    }

    output.push(line);
  }

  return output.join("\n");
}

/** Convert common inline markdown (bold, italic, code, links) to HTML. */
function inlineMarkdownToHtml(text: string): string {
  let result = escapeHtml(text);
  // Order matters: bold before italic to handle **bold *nested*** correctly
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");
  result = result.replace(/~~(.+?)~~/g, "<s>$1</s>");
  result = result.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Links: [text](url) — need to unescape the HTML entities in href
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, label, href) =>
      `<a href="${href.replace(/&amp;/g, "&")}">${label}</a>`,
  );
  return result;
}

/** Convert NFM lines (tab-indented, with optional list markers) to HTML. */
function nfmLinesToHtml(lines: string[]): string {
  const html: string[] = [];
  let openLevels = 0;
  let inCodeFence = false;

  let baseIndent = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = line.match(/^(\t*)/);
    if (m) baseIndent = Math.min(baseIndent, m[1].length);
  }
  if (!isFinite(baseIndent)) baseIndent = 0;

  const closeLists = () => {
    while (openLevels > 0) {
      html.push("</li></ul>");
      openLevels--;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Code fences — pass through as a <pre><code> block
    if (CODE_FENCE_RE.test(trimmed)) {
      if (!inCodeFence) {
        closeLists();
        const lang = trimmed.slice(3).trim();
        html.push(
          lang
            ? `<pre><code class="language-${escapeHtml(lang)}">`
            : "<pre><code>",
        );
      } else {
        html.push("</code></pre>");
      }
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) {
      html.push(
        escapeHtml(
          line.startsWith("\t".repeat(baseIndent))
            ? line.slice(baseIndent)
            : line,
        ),
      );
      continue;
    }

    if (!trimmed || /^<empty-block\b[^>]*\/>$/.test(trimmed)) {
      closeLists();
      continue;
    }

    const indentMatch = line.match(/^(\t*)(.*)/);
    const depth = (indentMatch ? indentMatch[1].length : 0) - baseIndent;
    const content = (indentMatch ? indentMatch[2] : line).trim();

    // HTML element tags (nested <details>, <summary>, <callout>, etc.)
    // Use [a-zA-Z] to avoid matching text like "<3"
    if (/^<\/?[a-zA-Z]/.test(content)) {
      closeLists();
      html.push(content);
      continue;
    }

    const listMatch = content.match(/^[-*+]\s+(.*)/);

    if (listMatch) {
      const text = listMatch[1].trim();
      const target = depth + 1;

      while (openLevels > target) {
        html.push("</li></ul>");
        openLevels--;
      }
      if (openLevels === target) {
        html.push("</li>");
      }
      while (openLevels < target) {
        html.push("<ul>");
        openLevels++;
      }

      html.push(`<li>${inlineMarkdownToHtml(text)}`);
    } else {
      closeLists();
      // Plain text — use nested <blockquote> for indentation
      let tag = `<p>${inlineMarkdownToHtml(content)}</p>`;
      for (let i = 0; i < depth; i++) {
        tag = `<blockquote>${tag}</blockquote>`;
      }
      html.push(tag);
    }
  }

  closeLists();
  return html.join("\n");
}

// ── Pass 2: Rewrite remaining NFM constructs ────────────────────────
function convertNfmBlocks(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let inCodeFence = false;
  let htmlDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (CODE_FENCE_RE.test(trimmed) && htmlDepth === 0) {
      inCodeFence = !inCodeFence;
      result.push(line);
      continue;
    }
    if (inCodeFence) {
      result.push(line);
      continue;
    }

    // Track HTML containers so we don't rewrite their content
    if (
      /^<(details|callout|columns|column)\b/.test(trimmed) &&
      !trimmed.endsWith("/>")
    ) {
      htmlDepth++;
      result.push(line);
      continue;
    }
    if (/^<\/(details|callout|columns|column)>/.test(trimmed)) {
      htmlDepth = Math.max(0, htmlDepth - 1);
      result.push(line);
      continue;
    }
    if (htmlDepth > 0) {
      result.push(line);
      continue;
    }

    // <empty-block/> → visible empty paragraph (preserves Notion's vertical spacing)
    // Only add a leading blank line if the previous line isn't already blank,
    // to avoid creating redundant blank lines between consecutive empty-blocks
    // that inflate on the next save cycle.
    if (/^<empty-block\b[^>]*\/>$/.test(trimmed)) {
      const prevLine = result.length > 0 ? result[result.length - 1] : "";
      if (prevLine.trim() !== "") {
        result.push("");
      }
      result.push("&nbsp;");
      result.push("");
      continue;
    }

    // Tab-indented lines → standard markdown
    const indentMatch = line.match(/^(\t+)(.*)/);
    if (indentMatch) {
      const depth = indentMatch[1].length;
      const content = (indentMatch[2] ?? "").trim();

      if (!content) {
        result.push("");
        continue;
      }

      // Already a list/task item → re-indent with spaces
      // Use 4 spaces per level so numbered list nesting works in CommonMark
      if (
        /^[-*+]\s/.test(content) ||
        /^\d+\.\s/.test(content) ||
        /^\[[ x]]\s/i.test(content)
      ) {
        result.push("    ".repeat(depth) + content);
        continue;
      }

      // HTML tag → keep as space-indented HTML
      if (/^</.test(content)) {
        result.push("  ".repeat(depth) + content);
        continue;
      }

      // Plain indented text → blockquote (Notion-style indent, no bullet)
      // Separate from previous non-blank line so each becomes its own block
      if (result.length > 0 && result[result.length - 1].trim() !== "") {
        result.push("");
      }
      result.push("> ".repeat(depth) + content);
      continue;
    }

    result.push(line);
  }

  return result.join("\n");
}

// ── Pass 3: Paragraph separation ────────────────────────────────────
// Ensures every Notion block becomes its own element in the editor.
// Without this, consecutive text lines merge into one paragraph,
// blockquote content leaks via lazy continuation, and `---` after
// text becomes a setext H2 heading.
function ensureParagraphSeparation(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let inCodeFence = false;

  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i].trim();
    const next = i < lines.length - 1 ? lines[i + 1].trim() : "";

    if (CODE_FENCE_RE.test(cur)) inCodeFence = !inCodeFence;
    result.push(lines[i]);
    if (inCodeFence || !next) continue;

    const needsBlank =
      // Two consecutive plain-text lines → separate paragraphs
      (isPlainTextLine(cur) && isPlainTextLine(next)) ||
      // Blockquote → non-blockquote (prevent lazy continuation)
      (/^>/.test(cur) && !/^>/.test(next)) ||
      // Before `---`/`***`/`___` (prevent setext H2 interpretation)
      (cur !== "" && !/^</.test(cur) && /^(---+|\*\*\*+|___+)$/.test(next)) ||
      // After block-level HTML close tags (not </li>, </ul>, etc.)
      /^<\/(details|callout|table|columns|column)>/.test(cur);

    if (needsBlank) {
      result.push("");
    }
  }

  return result.join("\n");
}

function isPlainTextLine(trimmed: string): boolean {
  if (!trimmed) return false;
  if (/^#{1,6}\s/.test(trimmed)) return false;
  if (/^[-*+]\s/.test(trimmed)) return false;
  if (/^\d+\.\s/.test(trimmed)) return false;
  if (/^>/.test(trimmed)) return false;
  if (/^\|/.test(trimmed)) return false;
  if (/^```/.test(trimmed)) return false;
  if (/^</.test(trimmed)) return false;
  if (/^(---+|\*\*\*+|___+)$/.test(trimmed)) return false;
  return true;
}

export function serializeEditorToNfm(markdown: string): string {
  return normalizeNfmForStorage(markdown);
}
