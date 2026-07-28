// Some tool schemas expose chart parameters named `type`/`title`/`labels`/
// `data` (e.g. a chart-generation action). Models occasionally regress to
// typing those parameter names as a bare chat line instead of calling the
// tool or emitting a real ```embed fence, e.g.:
//   /chart type=bar title="..." labels=["Mon","Tue"] data=[5,8]
// That has no real markdown syntax and would otherwise render as inert text.
// This module detects that generic shape (any "/word ... labels=[...]
// data=[...]" line) and renders a best-effort inline chart so the user still
// sees something useful, without hardcoding any single template's tool name.

import React from "react";

export const LEGACY_CHART_SHORTHAND_LANG = "chart-shorthand";

const LEGACY_CHART_PALETTE = [
  "#6366f1",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#0ea5e9",
  "#a855f7",
];

const SAFE_HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;
const BACKSLASH = String.fromCharCode(92);
const MAX_LINE_LENGTH = 20_000;
const MAX_LABELS = 60;
const MAX_SERIES = 6;

export interface LegacyChartShorthand {
  type: "bar" | "line" | "area";
  title: string;
  labels: string[];
  series: { label: string; data: number[]; color?: string }[];
}

// Extracts a balanced JSON array/object starting exactly at `startIndex`
// (which must point at "["), tracking string/escape state so brackets or
// braces inside JSON string values don't confuse the boundary.
function extractBalancedArrayAt(
  text: string,
  startIndex: number,
): string | null {
  if (text[startIndex] !== "[") return null;
  let depth = 0;
  let inString = false;
  for (let idx = startIndex; idx < text.length; idx++) {
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
      if (depth === 0) return text.slice(startIndex, idx + 1);
    }
  }
  return null;
}

// Marks which character indices fall inside a JSON/quoted-string literal so
// key-token scanning can ignore false matches such as a key= that's part of
// a title string, or embedded in a label's own text, rather than a real
// assignment in the line.
function computeStringMask(text: string): boolean[] {
  const mask = new Array<boolean>(text.length).fill(false);
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    mask[i] = inString;
    const ch = text[i];
    if (inString) {
      if (ch === BACKSLASH) {
        i++;
        if (i < text.length) mask[i] = true;
        continue;
      }
      if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    }
  }
  return mask;
}

// Finds the array value immediately following a `key=` token, scanning every
// occurrence of `key=` outside of quoted strings (not just the first) so a
// `key=` that appears inside an unrelated quoted string (e.g.
// title="data=quality", or a label literally containing "data=[1,2]") is
// skipped in favor of the real one. Only whitespace is allowed between
// `key=` and the `[`.
function extractArrayForKey(
  text: string,
  key: "labels" | "data",
): string | null {
  const mask = computeStringMask(text);
  const re = new RegExp(`\\b${key}=`, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (mask[match.index]) continue; // this key= is inside a string literal
    let idx = match.index + match[0].length;
    while (idx < text.length && /\s/.test(text[idx])) idx++;
    const arr = extractBalancedArrayAt(text, idx);
    if (arr) return arr;
  }
  return null;
}

// Extracts the value of a `title="..."`/`title='...'` token, honoring
// backslash-escaped quotes and backslashes inside the string (e.g.
// title="Sales \"Metrics\"") instead of stopping at the first escaped quote.
function extractLegacyChartTitle(text: string): string {
  const match = /\btitle=/.exec(text);
  if (!match) return "";
  let idx = match.index + match[0].length;
  const quoteChar = text[idx];
  if (quoteChar !== '"' && quoteChar !== "'") return "";
  idx++;
  let result = "";
  while (idx < text.length) {
    const ch = text[idx];
    if (ch === BACKSLASH && idx + 1 < text.length) {
      const next = text[idx + 1];
      if (next === quoteChar || next === BACKSLASH) {
        result += next;
        idx += 2;
        continue;
      }
    }
    if (ch === quoteChar) return result;
    result += ch;
    idx++;
  }
  return "";
}

/**
 * Cheap-ish pre-check so callers can skip the full parse on ordinary text.
 * Requires `labels=`/`data=` to actually resolve to bracketed arrays (not
 * just appear as substrings) so unrelated slash commands or API paths that
 * happen to mention both words aren't diverted out of normal markdown
 * rendering.
 */
export function looksLikeLegacyChartShorthand(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LINE_LENGTH) return false;
  if (!/^\/[a-zA-Z][\w-]*\b/.test(trimmed)) return false;
  if (!/\blabels=/.test(trimmed) || !/\bdata=/.test(trimmed)) return false;
  return (
    extractArrayForKey(trimmed, "labels") !== null &&
    extractArrayForKey(trimmed, "data") !== null
  );
}

export function parseLegacyChartShorthand(
  rawLine: string,
): LegacyChartShorthand | null {
  const trimmed = rawLine.trim();
  if (!looksLikeLegacyChartShorthand(trimmed)) return null;

  const typeMatch = trimmed.match(/\btype=(bar|line|area)\b/i);
  const chartType =
    (typeMatch?.[1].toLowerCase() as LegacyChartShorthand["type"]) || "bar";

  const chartTitle = extractLegacyChartTitle(trimmed);

  const labelsRaw = extractArrayForKey(trimmed, "labels");
  const dataRaw = extractArrayForKey(trimmed, "data");
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
    parsedLabels.length > MAX_LABELS ||
    // Reject nested arrays/objects as labels — String(nestedArray) recurses
    // through Array.prototype.join and can throw on deeply nested input.
    !parsedLabels.every((l) =>
      ["string", "number", "boolean"].includes(typeof l),
    )
  ) {
    return null;
  }
  const safeLabels = parsedLabels.map((l) => String(l));

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
      { label: chartTitle || "Value", data: parsedData, color: topLevelColor },
    ];
  } else if (
    Array.isArray(parsedData) &&
    parsedData.length > 0 &&
    // Reject rather than silently truncate an over-limit series count:
    // presenting a partial chart as complete is worse than plain text.
    parsedData.length <= MAX_SERIES &&
    parsedData.every(
      (d) =>
        d &&
        typeof d === "object" &&
        isValidSeriesData((d as { data?: unknown }).data),
    )
  ) {
    chartSeries = (
      parsedData as { label?: unknown; data: number[]; color?: unknown }[]
    ).map((d, idx) => ({
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

// Wraps any line matching the legacy shorthand shape in a fenced code block
// tagged `chart-shorthand`, so it routes through markdownComponents.pre()
// like any other language fence instead of rendering as inert prose.
// Fence/indented-code tracking mirrors ../../shared/markdown-block-split.ts
// (marker char + length, indented-code detection) so real code blocks —
// including ~~~ fences, longer-than-3 fences, and 4-space/tab indented code —
// are never mistaken for chat prose and rewritten.
export function wrapLegacyChartShorthandLines(markdown: string): string {
  if (!markdown.includes("labels=") || !markdown.includes("data=")) {
    return markdown;
  }
  let fenceMarker = ""; // non-empty while inside a ``` or ~~~ fence
  const lines = markdown.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    // CommonMark: a line indented 4+ spaces (or a tab) is an indented code
    // block, not a fence marker. Check this first so a literal four-space
    // "    ```" example in a message doesn't toggle fence state.
    if (/^(?: {4}|\t)/.test(line)) {
      out.push(line);
      continue;
    }
    const trimmed = line.trimStart();
    if (fenceMarker) {
      out.push(line);
      const closeMatch = /^(`{3,}|~{3,})\s*$/.exec(trimmed);
      if (
        closeMatch &&
        closeMatch[1].charAt(0) === fenceMarker.charAt(0) &&
        closeMatch[1].length >= fenceMarker.length
      ) {
        fenceMarker = "";
      }
      continue;
    }
    const openMatch = /^(`{3,}|~{3,})/.exec(trimmed);
    if (openMatch) {
      fenceMarker = openMatch[1].charAt(0).repeat(openMatch[1].length);
      out.push(line);
      continue;
    }
    if (looksLikeLegacyChartShorthand(line)) {
      // Preserve the line's own indentation on the emitted fence so
      // shorthand inside a list item or blockquote continuation stays part
      // of that container instead of being dedented to a top-level block.
      const leadingWs = line.match(/^\s*/)?.[0] ?? "";
      out.push(
        leadingWs + "```" + LEGACY_CHART_SHORTHAND_LANG,
        leadingWs + line.trim(),
        leadingWs + "```",
      );
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

export function LegacyChartShorthandFallback({ text }: { text: string }) {
  return <span style={{ whiteSpace: "pre-wrap" }}>{text}</span>;
}

export function LegacyChartShorthandChart({
  parsed,
}: {
  parsed: LegacyChartShorthand;
}) {
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
  const gridLineCount = 4;
  const gridLines = Array.from({ length: gridLineCount + 1 }, (_, g) => {
    const y = padding.top + (innerH * g) / gridLineCount;
    const val = Math.round(maxVal - (maxVal * g) / gridLineCount);
    return { y, val };
  });

  const colorFor = (s: LegacyChartShorthand["series"][number], si: number) =>
    s.color || LEGACY_CHART_PALETTE[si % LEGACY_CHART_PALETTE.length];

  return (
    <div className="my-4 rounded-lg border border-border bg-muted/20 p-3">
      {title && (
        <div className="mb-1 text-sm font-medium text-foreground">{title}</div>
      )}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full text-muted-foreground"
        role="img"
        aria-label={title || "Chart"}
      >
        {gridLines.map(({ y, val }, i) => (
          <React.Fragment key={i}>
            <line
              x1={padding.left}
              y1={y}
              x2={width - padding.right}
              y2={y}
              stroke="currentColor"
              strokeOpacity={0.1}
            />
            <text
              x={padding.left - 8}
              y={y + 4}
              textAnchor="end"
              fontSize={10}
              fill="currentColor"
              fillOpacity={0.6}
            >
              {val}
            </text>
          </React.Fragment>
        ))}

        {type === "bar" &&
          labels.map((_, li) => {
            const groupPad = groupW * 0.15;
            const barsW = groupW - groupPad * 2;
            const barW = barsW / series.length;
            return series.map((s, si) => {
              const value = s.data[li] ?? 0;
              const barH = (Math.max(0, value) / maxVal) * innerH;
              const x = padding.left + li * groupW + groupPad + si * barW;
              const y = padding.top + (innerH - barH);
              return (
                <rect
                  key={`${li}-${si}`}
                  x={x}
                  y={y}
                  width={Math.max(1, barW - 2)}
                  height={Math.max(0, barH)}
                  fill={colorFor(s, si)}
                  rx={2}
                />
              );
            });
          })}

        {type !== "bar" &&
          series.map((s, si) => {
            const coords = labels.map((_, li) => {
              const value = s.data[li] ?? 0;
              const x = padding.left + groupW * li + groupW / 2;
              const y =
                padding.top + innerH - (Math.max(0, value) / maxVal) * innerH;
              return { x, y };
            });
            if (coords.length === 1) {
              // A single point has no line segment to draw — render a marker
              // instead of an invisible zero-length polyline.
              return (
                <circle
                  key={si}
                  cx={coords[0].x}
                  cy={coords[0].y}
                  r={4}
                  fill={colorFor(s, si)}
                />
              );
            }
            const points = coords
              .map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`)
              .join(" ");
            const baseY = padding.top + innerH;
            const firstX = padding.left + groupW / 2;
            const lastX =
              padding.left + groupW * (labels.length - 1) + groupW / 2;
            return (
              <React.Fragment key={si}>
                {type === "area" && (
                  <polygon
                    points={`${firstX.toFixed(1)},${baseY.toFixed(1)} ${points} ${lastX.toFixed(1)},${baseY.toFixed(1)}`}
                    fill={colorFor(s, si)}
                    fillOpacity={0.15}
                  />
                )}
                <polyline
                  points={points}
                  fill="none"
                  stroke={colorFor(s, si)}
                  strokeWidth={2}
                />
              </React.Fragment>
            );
          })}

        {labels.map((label, li) => {
          const x = padding.left + groupW * li + groupW / 2;
          const y = height - padding.bottom + 16;
          const truncated =
            label.length > 12 ? `${label.slice(0, 11)}...` : label;
          return (
            <text
              key={li}
              x={x}
              y={y}
              textAnchor="middle"
              fontSize={10}
              fill="currentColor"
              fillOpacity={0.7}
            >
              {truncated}
            </text>
          );
        })}
      </svg>
      {series.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {series.map((s, si) => (
            <span key={si} className="inline-flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: colorFor(s, si) }}
              />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
