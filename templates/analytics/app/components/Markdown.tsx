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
    .replace(/"/g, "&quot;");
}

function renderInline(text: string): string {
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
      // Links
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
      )
  );
}

function renderMarkdown(md: string): string {
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
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      i++; // skip closing ```
      out.push(
        `<pre><code${lang ? ` class="language-${lang}"` : ""}>${codeLines.join("\n")}</code></pre>`,
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
