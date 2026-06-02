export type DocumentExportFormat = "pdf" | "markdown" | "html";

export interface DocumentExportInput {
  id: string;
  title?: string | null;
  content?: string | null;
  updatedAt?: string | null;
  format: DocumentExportFormat;
}

export interface DocumentExportPayload {
  id: string;
  title: string;
  format: DocumentExportFormat;
  filename: string;
  mimeType: string;
  content: string;
  print: boolean;
}

const EXTENSION_BY_FORMAT: Record<DocumentExportFormat, string> = {
  pdf: "pdf",
  markdown: "md",
  html: "html",
};

const MIME_BY_FORMAT: Record<DocumentExportFormat, string> = {
  pdf: "text/html;charset=utf-8",
  markdown: "text/markdown;charset=utf-8",
  html: "text/html;charset=utf-8",
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeExportUrl(value: string, kind: "link" | "image"): string {
  const normalized = value.replace(/&amp;/g, "&").trim();
  const lower = normalized.toLowerCase();

  if (
    lower.startsWith("#") ||
    lower.startsWith("/") ||
    lower.startsWith("./") ||
    lower.startsWith("../")
  ) {
    return value;
  }

  if (kind === "image" && lower.startsWith("data:image/")) return value;

  try {
    const url = new URL(normalized);
    const allowed =
      kind === "image"
        ? url.protocol === "http:" || url.protocol === "https:"
        : ["http:", "https:", "mailto:", "tel:"].includes(url.protocol);
    return allowed ? value : "#";
  } catch {
    return "#";
  }
}

function normalizeTitle(title: string | null | undefined): string {
  const normalized = (title ?? "").replace(/\s+/g, " ").trim();
  return normalized || "Untitled";
}

export function exportFilename(
  title: string | null | undefined,
  format: DocumentExportFormat,
): string {
  const base = normalizeTitle(title)
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return `${base || "untitled"}.${EXTENSION_BY_FORMAT[format]}`;
}

export function markdownWithTitle(
  title: string | null | undefined,
  content: string | null | undefined,
): string {
  const safeTitle = normalizeTitle(title);
  const body = (content ?? "").trim();
  const firstHeading = body.match(/^#\s+(.+?)(?:\n|$)/);

  if (firstHeading?.[1]?.trim().toLowerCase() === safeTitle.toLowerCase()) {
    return `${body}\n`;
  }

  return `${`# ${safeTitle}`}${body ? `\n\n${body}` : ""}\n`;
}

function inlineMarkdownToHtml(text: string): string {
  return escapeHtml(text)
    .replace(
      /!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g,
      (_m, alt, src) => {
        return `<img src="${safeExportUrl(src, "image")}" alt="${alt}" />`;
      },
    )
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
      return `<a href="${safeExportUrl(href, "link")}">${label}</a>`;
    })
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/(^|[^\*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_]+)_/g, "$1<em>$2</em>");
}

function listItemsToHtml(lines: string[], ordered: boolean): string {
  const items = lines
    .map((line) => {
      const text = ordered
        ? line.replace(/^\s*\d+[.)]\s+/, "")
        : line.replace(/^\s*[-*+]\s+/, "");
      const task = text.match(/^\[( |x|X)\]\s+(.*)$/);
      if (task) {
        const checked = task[1].toLowerCase() === "x";
        return `<li class="task"><input type="checkbox" disabled${
          checked ? " checked" : ""
        } /> <span>${inlineMarkdownToHtml(task[2])}</span></li>`;
      }
      return `<li>${inlineMarkdownToHtml(text)}</li>`;
    })
    .join("\n");

  return ordered ? `<ol>\n${items}\n</ol>` : `<ul>\n${items}\n</ul>`;
}

function isEmptyBlockLine(trimmed: string): boolean {
  return /^<empty-block\b[^>]*\/>$/.test(trimmed);
}

function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index++;
      continue;
    }

    if (isEmptyBlockLine(trimmed)) {
      blocks.push("<p>&nbsp;</p>");
      index++;
      continue;
    }

    const codeFence = trimmed.match(/^```(\w+)?/);
    if (codeFence) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        code.push(lines[index]);
        index++;
      }
      index++;
      const language = codeFence[1]
        ? ` class="language-${escapeHtml(codeFence[1])}"`
        : "";
      blocks.push(
        `<pre><code${language}>${escapeHtml(code.join("\n"))}</code></pre>`,
      );
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${inlineMarkdownToHtml(heading[2])}</h${level}>`);
      index++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push("<hr />");
      index++;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quote.push(lines[index].trim().replace(/^>\s?/, ""));
        index++;
      }
      blocks.push(
        `<blockquote>${markdownToHtml(quote.join("\n"))}</blockquote>`,
      );
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(lines[index]);
        index++;
      }
      blocks.push(listItemsToHtml(items, false));
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(lines[index]);
        index++;
      }
      blocks.push(listItemsToHtml(items, true));
      continue;
    }

    const paragraph: string[] = [line];
    index++;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !isEmptyBlockLine(lines[index].trim()) &&
      !/^(#{1,6})\s+/.test(lines[index].trim()) &&
      !/^```/.test(lines[index].trim()) &&
      !/^>\s?/.test(lines[index].trim()) &&
      !/^\s*[-*+]\s+/.test(lines[index]) &&
      !/^\s*\d+[.)]\s+/.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index++;
    }
    blocks.push(`<p>${inlineMarkdownToHtml(paragraph.join("\n"))}</p>`);
  }

  return blocks.join("\n\n");
}

function buildHtmlDocument(input: {
  title: string;
  content: string;
  updatedAt?: string | null;
  print: boolean;
}): string {
  const body = markdownToHtml(input.content);
  const updated = input.updatedAt
    ? `<p class="meta">Updated ${escapeHtml(
        new Date(input.updatedAt).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }),
      )}</p>`
    : "";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.title)}</title>
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      background: #fff;
      color: #262626;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.68;
    }
    main {
      box-sizing: border-box;
      max-width: 760px;
      margin: 0 auto;
      padding: ${input.print ? "48px 56px" : "56px 32px"};
    }
    .meta {
      color: #737373;
      font-size: 13px;
      margin: 0 0 12px;
    }
    h1 {
      font-size: 40px;
      line-height: 1.15;
      letter-spacing: 0;
      margin: 0 0 32px;
    }
    h2 { font-size: 26px; margin: 32px 0 8px; }
    h3 { font-size: 21px; margin: 28px 0 6px; }
    h4, h5, h6 { font-size: 17px; margin: 22px 0 4px; }
    p, ul, ol, blockquote, pre { margin: 12px 0; }
    ul, ol { padding-left: 1.4rem; }
    li { margin: 4px 0; }
    li.task { list-style: none; margin-left: -1.4rem; }
    li.task input { margin-right: 8px; }
    blockquote {
      border-left: 3px solid #d4d4d4;
      color: #525252;
      padding-left: 14px;
    }
    pre {
      background: #f6f6f6;
      border: 1px solid #e5e5e5;
      border-radius: 8px;
      overflow-x: auto;
      padding: 14px 16px;
      white-space: pre-wrap;
    }
    code {
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.9em;
    }
    p code, li code {
      background: #f1f1f1;
      border-radius: 4px;
      padding: 0.12rem 0.3rem;
    }
    a { color: #2563eb; }
    img {
      display: block;
      max-width: 100%;
      height: auto;
      border-radius: 8px;
      margin: 18px 0;
    }
    hr {
      border: 0;
      border-top: 1px solid #e5e5e5;
      margin: 28px 0;
    }
    @media print {
      @page { margin: 0.65in; }
      main { max-width: none; padding: 0; }
      a { color: inherit; text-decoration: underline; }
      pre, blockquote, img { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <main>
    ${updated}
    <h1>${escapeHtml(input.title)}</h1>
    <article>${body}</article>
  </main>
</body>
</html>`;
}

export function buildDocumentExport(
  input: DocumentExportInput,
): DocumentExportPayload {
  const title = normalizeTitle(input.title);
  const filename = exportFilename(title, input.format);
  const markdown = markdownWithTitle(title, input.content);
  const isHtmlLike = input.format === "html" || input.format === "pdf";
  const content = isHtmlLike
    ? buildHtmlDocument({
        title,
        content: input.content ?? "",
        updatedAt: input.updatedAt,
        print: input.format === "pdf",
      })
    : markdown;

  return {
    id: input.id,
    title,
    format: input.format,
    filename,
    mimeType: MIME_BY_FORMAT[input.format],
    content,
    print: input.format === "pdf",
  };
}
