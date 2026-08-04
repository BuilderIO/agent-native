const EMAIL_BACKGROUND = "#f6f7f9"; // guard:allow-raw-color - email clients need inlined colors
const EMAIL_TEXT = "#1f2937"; // guard:allow-raw-color - email clients need inlined colors
const EMAIL_MUTED = "#64748b"; // guard:allow-raw-color - email clients need inlined colors
const EMAIL_BORDER = "#dbe3ec"; // guard:allow-raw-color - email clients need inlined colors
const EMAIL_CODE = "#eef2f7"; // guard:allow-raw-color - email clients need inlined colors
const EMAIL_SURFACE = "#ffffff"; // guard:allow-raw-color - email clients need inlined colors

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function inlineMarkdown(value: string): string {
  let html = escapeHtml(value);
  const protectedLinks: string[] = [];
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_match, label: string, url: string) => {
      const index = protectedLinks.push(
        `<a href="${url}" style="color:${EMAIL_TEXT};text-decoration:underline;">${label}</a>`,
      );
      return `\u0000${index - 1}\u0000`;
    },
  );
  html = html.replace(
    /(^|[^\w"'=])(https?:\/\/[^\s<]+)/g,
    (_match, prefix: string, rawUrl: string) => {
      let url = rawUrl;
      let trailing = "";
      while (/[.,!?;:]$/.test(url)) {
        trailing = url.slice(-1) + trailing;
        url = url.slice(0, -1);
      }
      let label = "Open link";
      try {
        const host = new URL(url.replace(/&amp;/g, "&")).hostname.replace(
          /^www\./,
          "",
        );
        if (host) label = `Open ${host}`;
      } catch {
        // Keep the generic label for malformed URLs.
      }
      return `${prefix}<a href="${url}" style="color:${EMAIL_TEXT};text-decoration:underline;">${label}</a>${trailing}`;
    },
  );
  html = html
    .replace(
      /`([^`]+)`/g,
      `<code style="background:${EMAIL_CODE};padding:2px 5px;border-radius:4px;font-size:0.92em;">$1</code>`,
    )
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, "$1<em>$2</em>")
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, "$1<em>$2</em>");
  html = html.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => {
    return protectedLinks[Number(index)] ?? "";
  });
  return html;
}

function renderTable(lines: string[]): string | null {
  if (lines.length < 2 || !lines.every((line) => line.includes("|"))) {
    return null;
  }
  const parseRow = (line: string) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
  const header = parseRow(lines[0]);
  const divider = parseRow(lines[1]);
  if (!header.length || !divider.every((cell) => /^:?-{3,}:?$/.test(cell))) {
    return null;
  }
  const body = lines.slice(2).map(parseRow);
  const headHtml = header
    .map(
      (cell) =>
        `<th align="left" style="border:1px solid ${EMAIL_BORDER};padding:8px 10px;background:${EMAIL_CODE};font-weight:600;">${inlineMarkdown(cell)}</th>`,
    )
    .join("");
  const bodyHtml = body
    .map(
      (row) =>
        `<tr>${header
          .map(
            (_cell, index) =>
              `<td style="border:1px solid ${EMAIL_BORDER};padding:8px 10px;vertical-align:top;">${inlineMarkdown(row[index] ?? "")}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");
  return `<div style="overflow-x:auto;margin:0 0 18px;"><table role="presentation" style="border-collapse:collapse;width:100%;font-size:14px;"><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
}

export function markdownToText(md: string): string {
  return md
    .replace(/^(?:```[^\n]*\n|```$)/gm, "")
    .replace(/!\[([^\]]*)\]\([^\s)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, "$1 ($2)")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/gm, "$1$2")
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/gm, "$1$2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .trim();
}

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").trim().split("\n");
  if (!md.trim()) return '<p style="margin:0;">&nbsp;</p>';

  const blocks: string[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }
    const line = lines[index].trim();
    if (
      line.startsWith("```") &&
      lines.slice(index + 1).some((item) => item.trim() === "```")
    ) {
      const end = lines.findIndex(
        (item, offset) => offset > index && item.trim() === "```",
      );
      const code = lines.slice(index + 1, end).join("\n");
      blocks.push(
        `<pre style="margin:0 0 18px;padding:14px 16px;background:${EMAIL_CODE};border-radius:6px;overflow-x:auto;white-space:pre-wrap;"><code>${escapeHtml(code)}</code></pre>`,
      );
      index = end + 1;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 3);
      const sizes = ["24px", "19px", "16px"];
      blocks.push(
        `<h${level} style="margin:0 0 10px;color:${EMAIL_TEXT};font-size:${sizes[level - 1]};line-height:1.3;">${inlineMarkdown(heading[2])}</h${level}>`,
      );
      index += 1;
      continue;
    }
    if (/^(?:-{3,}|\*{3,})$/.test(line)) {
      blocks.push(
        `<hr style="border:0;border-top:1px solid ${EMAIL_BORDER};margin:4px 0 18px;" />`,
      );
      index += 1;
      continue;
    }

    const listMatch = line.match(/^([-*+] |\d+\. )/);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[1]);
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index]
          .trim()
          .match(ordered ? /^\d+\.\s+(.+)$/ : /^[-*+]\s+(.+)$/);
        if (!item) break;
        items.push(
          `<li style="margin:0 0 6px;">${inlineMarkdown(item[1])}</li>`,
        );
        index += 1;
      }
      const tag = ordered ? "ol" : "ul";
      blocks.push(
        `<${tag} style="margin:0 0 18px;padding-left:24px;">${items.join("")}</${tag}>`,
      );
      continue;
    }

    const tableLines = [line];
    let tableEnd = index + 1;
    while (
      tableEnd < lines.length &&
      lines[tableEnd].trim() &&
      lines[tableEnd].includes("|")
    ) {
      tableLines.push(lines[tableEnd].trim());
      tableEnd += 1;
    }
    const table = renderTable(tableLines);
    if (table) {
      blocks.push(table);
      index = tableEnd;
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim()) {
      if (/^(?:#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```)/.test(lines[index].trim()))
        break;
      paragraph.push(lines[index].trim());
      index += 1;
    }
    if (paragraph.every((item) => item.startsWith("> "))) {
      blocks.push(
        `<blockquote style="margin:0 0 18px;padding:4px 0 4px 14px;border-left:3px solid ${EMAIL_BORDER};color:${EMAIL_MUTED};">${inlineMarkdown(paragraph.map((item) => item.slice(2)).join("\n")).replace(/\n/g, "<br />")}</blockquote>`,
      );
    } else {
      blocks.push(
        `<p style="margin:0 0 18px;line-height:1.65;">${inlineMarkdown(paragraph.join("\n")).replace(/\n/g, "<br />")}</p>`,
      );
    }
  }
  return blocks.join("\n");
}

export function wrapInEmailTemplate(bodyHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="margin:0;padding:0;background:${EMAIL_BACKGROUND};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${EMAIL_TEXT};"><div style="padding:24px 12px;"><div style="box-sizing:border-box;max-width:640px;margin:0 auto;padding:28px 30px;background:${EMAIL_SURFACE};border:1px solid ${EMAIL_BORDER};border-radius:8px;font-size:15px;line-height:1.65;">${bodyHtml}</div></div></body></html>`;
}
