import { useMemo } from "react";

/**
 * Lightweight Markdown renderer — handles headings, bold, italic, code blocks,
 * inline code, links, unordered/ordered lists, horizontal rules, and tables.
 * No external deps required.
 */
export default function Markdown({ content }: { content: string }) {
  const html = useMemo(() => renderMarkdown(content), [content]);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Sanitize a URL for use in an href. Rejects dangerous protocols
 * (javascript:, data:, vbscript:, file:) and empty strings. Returns a
 * safe-to-embed value — always HTML-escape the result when inserting
 * into an attribute.
 */
function decodeHtmlEntities(value: string): string {
  let decoded = value;
  for (let i = 0; i < 3; i++) {
    const next = decoded
      .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) =>
        String.fromCodePoint(Number.parseInt(hex, 16)),
      )
      .replace(/&#(\d+);?/g, (_, dec: string) =>
        String.fromCodePoint(Number.parseInt(dec, 10)),
      )
      .replace(/&colon;?/gi, ":")
      .replace(/&tab;?/gi, "\t")
      .replace(/&newline;?/gi, "\n")
      .replace(/&amp;?/gi, "&");
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function sanitizeUrl(url: string, kind: "link" | "image" = "link"): string {
  const trimmed = url.trim();
  if (!trimmed) return "#";

  // Strip HTML entities and whitespace before protocol check so
  // `javascript&#58;…` style attempts don't sneak through.
  const decoded = decodeHtmlEntities(trimmed);
  const stripped = decoded
    .replace(/[\s\u0000-\u001f\u007f]+/g, "")
    .toLowerCase();
  if (
    stripped.startsWith("javascript:") ||
    stripped.startsWith("data:") ||
    stripped.startsWith("vbscript:") ||
    stripped.startsWith("file:") ||
    stripped.startsWith("//")
  ) {
    return "#";
  }
  if (kind === "image" && /^[a-z][a-z\d+.-]*:/i.test(stripped)) {
    if (!stripped.startsWith("http:") && !stripped.startsWith("https:")) {
      return "#";
    }
  }
  // Defense-in-depth: when the URL carries a scheme, require http/https via
  // a real URL parse (catches encodings the deny-list above might miss).
  // Relative URLs (`/path`, `#anchor`, `?q=1`) without a scheme pass through.
  // (audit 03 defense-in-depth)
  if (/^[a-z][a-z\d+.-]*:/i.test(stripped)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "#";
      }
    } catch {
      return "#";
    }
  }
  return trimmed;
}

function renderInline(text: string): string {
  // Escape the raw text before applying markdown replacements so any
  // HTML the agent emits is inert. Note: markdown tokens like `**` and
  // `[text](url)` are detected AFTER escaping — that's safe because our
  // tokens don't overlap with escaped entities.
  return (
    escapeHtml(text)
      // Bold
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__(.+?)__/g, "<strong>$1</strong>")
      // Italic
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/_(.+?)_/g, "<em>$1</em>")
      // Inline code
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      // Images — must run before the link pattern since ![alt](url) contains [alt](url)
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, rawUrl) => {
        const safe = sanitizeUrl(rawUrl, "image");
        if (safe === "#") return "";
        return `<img src="${escapeHtml(safe)}" alt="${escapeHtml(alt)}" loading="lazy" />`;
      })
      // Links — sanitize URL to block javascript:/data:/vbscript:/file:
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, rawUrl) => {
        const safe = sanitizeUrl(rawUrl);
        return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
      })
  );
}

export function renderMarkdown(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  let inList: "ul" | "ol" | null = null;

  function closeList() {
    if (inList) {
      out.push(inList === "ul" ? "</ul>" : "</ol>");
      inList = null;
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith("```")) {
      closeList();
      // Language hint is user-controlled (via the markdown fence); normalize
      // to a safe identifier and then HTML-escape as a belt-and-suspenders.
      const rawLang = line.slice(3).trim();
      const safeLang = rawLang.replace(/[^a-zA-Z0-9_+#.-]/g, "").slice(0, 32);
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      i++; // skip closing ```
      out.push(
        `<pre><code${safeLang ? ` class="language-${escapeHtml(safeLang)}"` : ""}>${codeLines.join("\n")}</code></pre>`,
      );
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      closeList();
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      closeList();
      out.push("<hr />");
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      out.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    // Table
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      /^\|?\s*[-:]+/.test(lines[i + 1])
    ) {
      closeList();
      const headerCells = line
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (
        i < lines.length &&
        lines[i].includes("|") &&
        lines[i].trim() !== ""
      ) {
        rows.push(
          lines[i]
            .split("|")
            .map((c) => c.trim())
            .filter(Boolean),
        );
        i++;
      }
      out.push("<table>");
      out.push(
        "<thead><tr>" +
          headerCells.map((c) => `<th>${renderInline(c)}</th>`).join("") +
          "</tr></thead>",
      );
      out.push("<tbody>");
      for (const row of rows) {
        out.push(
          "<tr>" +
            row.map((c) => `<td>${renderInline(c)}</td>`).join("") +
            "</tr>",
        );
      }
      out.push("</tbody></table>");
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (ulMatch) {
      if (inList !== "ul") {
        closeList();
        inList = "ul";
        out.push("<ul>");
      }
      out.push(`<li>${renderInline(ulMatch[2])}</li>`);
      i++;
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)\d+[.)]\s+(.+)$/);
    if (olMatch) {
      if (inList !== "ol") {
        closeList();
        inList = "ol";
        out.push("<ol>");
      }
      out.push(`<li>${renderInline(olMatch[2])}</li>`);
      i++;
      continue;
    }

    // Paragraph
    closeList();
    out.push(`<p>${renderInline(line)}</p>`);
    i++;
  }

  closeList();
  return out.join("\n");
}
