import { useT } from "@agent-native/core/client/i18n";
import { useMemo } from "react";

import enUSMessages from "@/i18n/en-US";

export default function Markdown({ content }: { content: string }) {
  const t = useT();
  const labels = useMemo(
    () => ({
      embedBlocked: t("markdown.embedBlocked"),
      sameOriginEmbedsOnly: t("markdown.sameOriginEmbedsOnly"),
      embeddedContent: t("markdown.embeddedContent"),
    }),
    [t],
  );
  const html = useMemo(
    () => renderMarkdown(content, labels),
    [content, labels],
  );
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

type MarkdownLabels = (typeof enUSMessages)["markdown"];

const DEFAULT_MARKDOWN_LABELS = enUSMessages.markdown;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

const ALLOWED_EMBED_ASPECTS = new Set([
  "16/9",
  "4/3",
  "1/1",
  "21/9",
  "3/2",
  "2/1",
]);

function parseEmbedBody(body: string): {
  src?: string;
  aspect?: string;
  title?: string;
  height?: number;
} {
  const out: {
    src?: string;
    aspect?: string;
    title?: string;
    height?: number;
  } = {};
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (!value) continue;
    if (key === "src") out.src = value;
    else if (key === "aspect") out.aspect = value;
    else if (key === "title") out.title = value;
    else if (key === "height") {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) out.height = Math.min(2000, n);
    }
  }
  return out;
}

function sanitizeEmbedSrc(src: string | undefined): string | null {
  if (!src) return null;
  const trimmed = src.trim();
  if (!trimmed || trimmed.startsWith("//")) return null;
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  ) {
    return trimmed;
  }
  return null;
}

function renderEmbedBlock(
  body: string,
  labels: MarkdownLabels = DEFAULT_MARKDOWN_LABELS,
): string {
  const parsed = parseEmbedBody(body);
  const safeSrc = sanitizeEmbedSrc(parsed.src);
  if (!safeSrc) {
    const blockedSourceHtml = parsed.src
      ? `<div class="mt-1 truncate font-mono text-[10px]">${escapeHtml(parsed.src)}</div>` // i18n-ignore stable sanitized URL echo in generated HTML
      : "";
    return [
      '<div class="my-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">',
      `<strong class="text-foreground">${escapeHtml(labels.embedBlocked)}</strong>`,
      `<div class="mt-1">${escapeHtml(labels.sameOriginEmbedsOnly)}</div>`, // i18n-ignore generated HTML expression boundary
      blockedSourceHtml,
      "</div>",
    ].join("");
  }
  const aspect =
    parsed.aspect && ALLOWED_EMBED_ASPECTS.has(parsed.aspect)
      ? parsed.aspect
      : "16/9";
  const style = parsed.height
    ? `height:${parsed.height}px`
    : `aspect-ratio:${aspect.replace("/", " / ")}`;
  return [
    `<div class="my-4 overflow-hidden rounded-lg border border-border bg-muted/20" style="${style}">`,
    `<iframe src="${escapeHtml(safeSrc)}" title="${escapeHtml(parsed.title || labels.embeddedContent)}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerpolicy="same-origin" loading="lazy" class="h-full w-full border-0 bg-transparent"></iframe>`,
    "</div>",
  ].join("");
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

export function renderMarkdown(
  md: string,
  labels: MarkdownLabels = DEFAULT_MARKDOWN_LABELS,
): string {
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

    if (line.startsWith("```")) {
      closeList();
      const rawLang = line.slice(3).trim();
      const safeLang = rawLang.replace(/[^a-zA-Z0-9_+#.-]/g, "").slice(0, 32);
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      if (safeLang === "embed") {
        out.push(renderEmbedBlock(codeLines.join("\n"), labels));
        continue;
      }
      out.push(
        `<pre><code${safeLang ? ` class="language-${escapeHtml(safeLang)}"` : ""}>${codeLines.map(escapeHtml).join("\n")}</code></pre>`,
      );
      continue;
    }

    if (line.trim() === "") {
      closeList();
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      closeList();
      out.push("<hr />");
      i++;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      out.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`);
      i++;
      continue;
    }

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
      i += 2;
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

    closeList();
    out.push(`<p>${renderInline(line)}</p>`);
    i++;
  }

  closeList();
  return out.join("\n");
}
