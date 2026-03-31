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
        result = `<a href="${escapeHtml(String(mark.attrs?.href ?? ""))}" target="_blank" rel="noopener noreferrer">${result}</a>`;
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
        ? ` class="language-${escapeHtml(String(node.attrs.language))}"`
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
    case "mention":
      return `<span class="mention">@${escapeHtml(String(node.attrs?.text ?? ""))}</span>`;
    case "emoji":
      return node.attrs?.shortName ? String(node.attrs.shortName) : "";
    case "inlineCard":
      return `<a href="${escapeHtml(String(node.attrs?.url ?? ""))}" target="_blank" rel="noopener noreferrer">${escapeHtml(String(node.attrs?.url ?? "link"))}</a>`;
    case "panel": {
      const panelType = escapeHtml(String(node.attrs?.panelType ?? "info"));
      return `<div class="panel panel-${panelType}">${(node.content || []).map(renderNode).join("")}</div>`;
    }
    default:
      if (node.content) return (node.content || []).map(renderNode).join("");
      return node.text ? escapeHtml(node.text) : "";
  }
}

export function adfToHtml(adfDoc: unknown): string {
  if (!adfDoc || typeof adfDoc !== "object") return "";
  return renderNode(adfDoc as AdfNode);
}

export function markdownToAdf(markdown: string): unknown {
  const lines = markdown.split("\n");
  const content: any[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      content.push({
        type: "heading",
        attrs: { level: headingMatch[1].length },
        content: [{ type: "text", text: headingMatch[2] }],
      });
      i++;
      continue;
    }

    if (line.match(/^[-*]\s+/)) {
      const items: any[] = [];
      while (i < lines.length && lines[i].match(/^[-*]\s+/)) {
        items.push({
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: lines[i].replace(/^[-*]\s+/, ""),
                },
              ],
            },
          ],
        });
        i++;
      }
      content.push({ type: "bulletList", content: items });
      continue;
    }

    if (line.startsWith("```")) {
      const lang = line.slice(3).trim() || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      content.push({
        type: "codeBlock",
        attrs: lang ? { language: lang } : {},
        content: [{ type: "text", text: codeLines.join("\n") }],
      });
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    content.push({
      type: "paragraph",
      content: [{ type: "text", text: line }],
    });
    i++;
  }

  return { version: 1, type: "doc", content };
}
