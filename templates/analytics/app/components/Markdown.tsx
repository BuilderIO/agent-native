import { useT } from "@agent-native/core/client/i18n";
import { useMemo } from "react";

import { messagesByLocale } from "@/i18n-data";

/**
 * Lightweight Markdown renderer — handles headings, bold, italic, code blocks,
 * inline code, links, unordered/ordered lists, horizontal rules, and tables.
 * No external deps required.
 */
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

type MarkdownLabels = (typeof messagesByLocale)["en-US"]["markdown"];

const DEFAULT_MARKDOWN_LABELS = messagesByLocale["en-US"].markdown;

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

/**
 * Sanitize a URL for use in an href. Rejects dangerous protocols
 * (javascript:, data:, vbscript:, file:) and empty strings. Returns a
 * safe-to-embed value — always HTML-escape the result when inserting
 * into an attribute.
 */
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

const LEGACY_CHART_PALETTE = [
  "#6366f1",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#0ea5e9",
  "#a855f7",
];

const SAFE_HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

function extractBalancedArray(text: string, fromIndex: number): string | null {
  const start = text.indexOf("[", fromIndex);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  for (let idx = start; idx < text.length; idx++) {
    const ch = text[idx];
    if (inString) {
      if (ch === "\\")
        idx++; // skip escaped character, including \"
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, idx + 1);
    }
  }
  return null;
}

interface LegacyChartShorthand {
  type: "bar" | "line" | "area";
  title: string;
  labels: string[];
  series: { label: string; data: number[]; color?: string }[];
}

function tryParseLegacyChartShorthand(
  rawLine: string,
): LegacyChartShorthand | null {
  const trimmed = rawLine.trim();
  if (!trimmed.startsWith("/chart")) return null;
  if (!/\blabels=/.test(trimmed) || !/\bdata=/.test(trimmed)) return null;

  const typeMatch = trimmed.match(/\btype=(bar|line|area)\b/i);
  const chartType =
    (typeMatch?.[1].toLowerCase() as LegacyChartShorthand["type"]) || "bar";

  const titleMatch = trimmed.match(/\btitle=(?:"([^"]*)"|'([^']*)')/);
  const chartTitle = titleMatch ? (titleMatch[1] ?? titleMatch[2] ?? "") : "";

  const labelsIdx = trimmed.search(/\blabels=/);
  const labelsRaw =
    labelsIdx >= 0 ? extractBalancedArray(trimmed, labelsIdx) : null;
  const dataIdx = trimmed.search(/\bdata=/);
  const dataRaw = dataIdx >= 0 ? extractBalancedArray(trimmed, dataIdx) : null;
  if (!labelsRaw || !dataRaw) return null;

  let parsedLabels: unknown;
  let parsedData: unknown;
  try {
    parsedLabels = JSON.parse(labelsRaw);
    parsedData = JSON.parse(dataRaw);
  } catch {
    return null;
  }
  if (
    !Array.isArray(parsedLabels) ||
    parsedLabels.length === 0 ||
    parsedLabels.length > 60
  ) {
    return null;
  }
  const safeLabels = parsedLabels.map((l) => String(l)).slice(0, 60);
  const isValidSeriesData = (values: unknown): values is number[] =>
    Array.isArray(values) &&
    values.length === safeLabels.length &&
    values.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0);

  const colorMatch = trimmed.match(/(?:^|\s)color=(#[0-9a-fA-F]{3,8})\b/);
  const topLevelColor =
    colorMatch && SAFE_HEX_COLOR.test(colorMatch[1])
      ? colorMatch[1]
      : undefined;

  let chartSeries: LegacyChartShorthand["series"];
  if (isValidSeriesData(parsedData)) {
    chartSeries = [
      {
        label: chartTitle || "Value",
        data: parsedData,
        color: topLevelColor,
      },
    ];
  } else if (
    Array.isArray(parsedData) &&
    parsedData.length > 0 &&
    parsedData.every(
      (d) =>
        d &&
        typeof d === "object" &&
        isValidSeriesData((d as { data?: unknown }).data),
    )
  ) {
    chartSeries = (
      parsedData as { label?: unknown; data: number[]; color?: unknown }[]
    )
      .slice(0, 6)
      .map((d, idx) => ({
        label: typeof d.label === "string" ? d.label : `Series ${idx + 1}`,
        data: d.data,
        color:
          typeof d.color === "string" && SAFE_HEX_COLOR.test(d.color)
            ? d.color
            : undefined,
      }));
  } else {
    return null;
  }
  if (chartSeries.length === 0) return null;
  return {
    type: chartType,
    title: chartTitle,
    labels: safeLabels,
    series: chartSeries,
  };
}

function renderLegacyChartShorthand(parsed: LegacyChartShorthand): string {
  const { title, labels, series, type } = parsed;
  const width = 640;
  const height = 280;
  const padding = { top: 16, right: 16, bottom: 44, left: 48 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const maxVal = Math.max(
    1,
    series.reduce(
      (acc, s) => s.data.reduce((seriesAcc, v) => Math.max(seriesAcc, v), acc),
      0,
    ),
  );
  const groupW = innerW / labels.length;

  let gridSvg = "";
  const gridLines = 4;
  for (let g = 0; g <= gridLines; g++) {
    const y = padding.top + (innerH * g) / gridLines;
    const val = Math.round(maxVal - (maxVal * g) / gridLines);
    gridSvg += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="currentColor" stroke-opacity="0.1" />`;
    gridSvg += `<text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="currentColor" fill-opacity="0.6">${val}</text>`;
  }

  let seriesSvg = "";
  if (type === "bar") {
    const groupPad = groupW * 0.15;
    const barsW = groupW - groupPad * 2;
    const barW = barsW / series.length;
    labels.forEach((_, li) => {
      series.forEach((s, si) => {
        const value = s.data[li] ?? 0;
        const barH = (Math.max(0, value) / maxVal) * innerH;
        const x = padding.left + li * groupW + groupPad + si * barW;
        const y = padding.top + (innerH - barH);
        const color =
          s.color || LEGACY_CHART_PALETTE[si % LEGACY_CHART_PALETTE.length];
        seriesSvg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, barW - 2).toFixed(1)}" height="${Math.max(0, barH).toFixed(1)}" fill="${escapeHtml(color)}" rx="2" />`;
      });
    });
  } else {
    series.forEach((s, si) => {
      const color =
        s.color || LEGACY_CHART_PALETTE[si % LEGACY_CHART_PALETTE.length];
      const points = labels
        .map((_, li) => {
          const value = s.data[li] ?? 0;
          const x = padding.left + groupW * li + groupW / 2;
          const y =
            padding.top + innerH - (Math.max(0, value) / maxVal) * innerH;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ");
      if (type === "area") {
        const baseY = padding.top + innerH;
        const firstX = padding.left + groupW / 2;
        const lastX = padding.left + groupW * (labels.length - 1) + groupW / 2;
        seriesSvg += `<polygon points="${firstX.toFixed(1)},${baseY.toFixed(1)} ${points} ${lastX.toFixed(1)},${baseY.toFixed(1)}" fill="${escapeHtml(color)}" fill-opacity="0.15" />`;
      }
      seriesSvg += `<polyline points="${points}" fill="none" stroke="${escapeHtml(color)}" stroke-width="2" />`;
    });
  }

  const labelsSvg = labels
    .map((label, li) => {
      const x = padding.left + groupW * li + groupW / 2;
      const y = height - padding.bottom + 16;
      const truncated = label.length > 12 ? `${label.slice(0, 11)}...` : label;
      return `<text x="${x.toFixed(1)}" y="${y}" text-anchor="middle" font-size="10" fill="currentColor" fill-opacity="0.7">${escapeHtml(truncated)}</text>`;
    })
    .join("");

  const legendHtml =
    series.length > 1
      ? `<div class="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">${series
          .map((s, si) => {
            const color =
              s.color || LEGACY_CHART_PALETTE[si % LEGACY_CHART_PALETTE.length];
            return `<span class="inline-flex items-center gap-1"><span class="inline-block h-2 w-2 rounded-full" style="background:${escapeHtml(color)}"></span>${escapeHtml(s.label)}</span>`;
          })
          .join("")}</div>`
      : "";

  const titleHtml = title
    ? `<div class="mb-1 text-sm font-medium text-foreground">${escapeHtml(title)}</div>`
    : "";

  return [
    '<div class="my-4 rounded-lg border border-border bg-muted/20 p-3">',
    titleHtml,
    `<svg viewBox="0 0 ${width} ${height}" class="w-full text-muted-foreground" role="img" aria-label="${escapeHtml(title || "Chart")}">`,
    gridSvg,
    seriesSvg,
    labelsSvg,
    "</svg>",
    legendHtml,
    "</div>",
  ].join("");
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
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      if (safeLang === "embed") {
        out.push(renderEmbedBlock(codeLines.join("\n"), labels));
        continue;
      }
      out.push(
        `<pre><code${safeLang ? ` class="language-${escapeHtml(safeLang)}"` : ""}>${codeLines.map(escapeHtml).join("\n")}</code></pre>`,
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

    // Legacy hallucinated /chart shorthand: the model occasionally emits
    // `/chart type=bar title=... labels=[...] data=[...]` instead of the
    // documented embed fence, mirroring generate-chart's tool params. Parse
    // it best-effort so a chart still renders even when the syntax is wrong.
    const legacyChart = tryParseLegacyChartShorthand(line);
    if (legacyChart) {
      closeList();
      out.push(renderLegacyChartShorthand(legacyChart));
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
