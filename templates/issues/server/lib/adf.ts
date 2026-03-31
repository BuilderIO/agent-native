// ── ADF → HTML conversion ──

type AdfNode = {
  type: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMarks(text: string, marks?: AdfNode["marks"]): string {
  if (!marks || marks.length === 0) return escapeHtml(text);
  let result = escapeHtml(text);
  for (const mark of marks) {
    switch (mark.type) {
      case "strong":
        result = `<strong>${result}</strong>`;
        break;
      case "em":
        result = `<em>${result}</em>`;
        break;
      case "code":
        result = `<code>${result}</code>`;
        break;
      case "strike":
        result = `<s>${result}</s>`;
        break;
      case "underline":
        result = `<u>${result}</u>`;
        break;
      case "link":
        result = `<a href="${escapeHtml(String(mark.attrs?.href ?? ""))}">${result}</a>`;
        break;
    }
  }
  return result;
}

function renderNode(node: AdfNode): string {
  switch (node.type) {
    case "doc":
      return (node.content || []).map(renderNode).join("");

    case "paragraph":
      return `<p>${(node.content || []).map(renderNode).join("")}</p>`;

    case "text":
      return renderMarks(node.text || "", node.marks);

    case "heading": {
      const level = node.attrs?.level ?? 1;
      return `<h${level}>${(node.content || []).map(renderNode).join("")}</h${level}>`;
    }

    case "bulletList":
      return `<ul>${(node.content || []).map(renderNode).join("")}</ul>`;

    case "orderedList":
      return `<ol>${(node.content || []).map(renderNode).join("")}</ol>`;

    case "listItem":
      return `<li>${(node.content || []).map(renderNode).join("")}</li>`;

    case "blockquote":
      return `<blockquote>${(node.content || []).map(renderNode).join("")}</blockquote>`;

    case "codeBlock": {
      const lang = node.attrs?.language
        ? ` class="language-${node.attrs.language}"`
        : "";
      return `<pre><code${lang}>${(node.content || []).map(renderNode).join("")}</code></pre>`;
    }

    case "rule":
      return "<hr />";

    case "hardBreak":
      return "<br />";

    case "table":
      return `<table>${(node.content || []).map(renderNode).join("")}</table>`;

    case "tableRow":
      return `<tr>${(node.content || []).map(renderNode).join("")}</tr>`;

    case "tableHeader":
      return `<th>${(node.content || []).map(renderNode).join("")}</th>`;

    case "tableCell":
      return `<td>${(node.content || []).map(renderNode).join("")}</td>`;

    case "mediaSingle":
    case "media":
      return ""; // Skip media for now

    case "emoji":
      return node.attrs?.shortName ? String(node.attrs.shortName) : "";

    case "mention":
      return `<span class="mention">@${escapeHtml(String(node.attrs?.text ?? ""))}</span>`;

    case "inlineCard":
      return `<a href="${escapeHtml(String(node.attrs?.url ?? ""))}">${escapeHtml(String(node.attrs?.url ?? "link"))}</a>`;

    case "panel": {
      const panelType = node.attrs?.panelType ?? "info";
      return `<div class="panel panel-${panelType}">${(node.content || []).map(renderNode).join("")}</div>`;
    }

    default:
      if (node.content) {
        return (node.content || []).map(renderNode).join("");
      }
      return node.text ? escapeHtml(node.text) : "";
  }
}

export function adfToHtml(adfDoc: unknown): string {
  if (!adfDoc || typeof adfDoc !== "object") return "";
  return renderNode(adfDoc as AdfNode);
}

// ── ADF → Plain text ──

function nodeToText(node: AdfNode): string {
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "paragraph") {
    return (node.content || []).map(nodeToText).join("") + "\n";
  }
  if (node.type === "heading") {
    return (node.content || []).map(nodeToText).join("") + "\n";
  }
  if (node.type === "listItem") {
    return "- " + (node.content || []).map(nodeToText).join("") + "\n";
  }
  if (node.type === "mention") return `@${node.attrs?.text ?? ""}`;
  if (node.content) return (node.content || []).map(nodeToText).join("");
  return node.text || "";
}

export function adfToPlainText(adfDoc: unknown): string {
  if (!adfDoc || typeof adfDoc !== "object") return "";
  return nodeToText(adfDoc as AdfNode).trim();
}

// ── Markdown → ADF ──

export function markdownToAdf(markdown: string): unknown {
  const lines = markdown.split("\n");
  const content: AdfNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      content.push({
        type: "heading",
        attrs: { level: headingMatch[1].length },
        content: parseInline(headingMatch[2]),
      });
      i++;
      continue;
    }

    // Bullet list
    if (line.match(/^[-*]\s+/)) {
      const items: AdfNode[] = [];
      while (i < lines.length && lines[i].match(/^[-*]\s+/)) {
        items.push({
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: parseInline(lines[i].replace(/^[-*]\s+/, "")),
            },
          ],
        });
        i++;
      }
      content.push({ type: "bulletList", content: items });
      continue;
    }

    // Ordered list
    if (line.match(/^\d+\.\s+/)) {
      const items: AdfNode[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s+/)) {
        items.push({
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: parseInline(lines[i].replace(/^\d+\.\s+/, "")),
            },
          ],
        });
        i++;
      }
      content.push({ type: "orderedList", content: items });
      continue;
    }

    // Code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim() || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      content.push({
        type: "codeBlock",
        attrs: lang ? { language: lang } : {},
        content: [{ type: "text", text: codeLines.join("\n") }],
      });
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      content.push({
        type: "blockquote",
        content: [
          {
            type: "paragraph",
            content: parseInline(quoteLines.join("\n")),
          },
        ],
      });
      continue;
    }

    // HR
    if (line.match(/^[-*_]{3,}$/)) {
      content.push({ type: "rule" });
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Regular paragraph
    content.push({
      type: "paragraph",
      content: parseInline(line),
    });
    i++;
  }

  return {
    version: 1,
    type: "doc",
    content,
  };
}

function parseInline(text: string): AdfNode[] {
  const nodes: AdfNode[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Bold
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) {
      nodes.push({
        type: "text",
        text: boldMatch[1],
        marks: [{ type: "strong" }],
      });
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic
    const italicMatch = remaining.match(/^\*(.+?)\*/);
    if (italicMatch) {
      nodes.push({
        type: "text",
        text: italicMatch[1],
        marks: [{ type: "em" }],
      });
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Code
    const codeMatch = remaining.match(/^`(.+?)`/);
    if (codeMatch) {
      nodes.push({
        type: "text",
        text: codeMatch[1],
        marks: [{ type: "code" }],
      });
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Link
    const linkMatch = remaining.match(/^\[(.+?)\]\((.+?)\)/);
    if (linkMatch) {
      nodes.push({
        type: "text",
        text: linkMatch[1],
        marks: [{ type: "link", attrs: { href: linkMatch[2] } }],
      });
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Plain text (up to next special char)
    const plainMatch = remaining.match(/^[^*`\[]+/);
    if (plainMatch) {
      nodes.push({ type: "text", text: plainMatch[0] });
      remaining = remaining.slice(plainMatch[0].length);
      continue;
    }

    // Fallback: consume one char
    nodes.push({ type: "text", text: remaining[0] });
    remaining = remaining.slice(1);
  }

  return nodes;
}
