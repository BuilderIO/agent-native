import { defineAction } from "@agent-native/core";
import { z } from "zod";
import type { ChartJSNodeCanvas as ChartJSNodeCanvasType } from "chartjs-node-canvas";
import type { ChartConfiguration, ChartType } from "chart.js";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "path";
import { getAnalyticsMediaDir } from "../server/lib/media-dir.js";
import { signedSvgMediaUrl } from "../server/lib/signed-media.js";

const THEMES = {
  dark: {
    background: "#09090b",
    gridColor: "#27272a",
    tickColor: "#a1a1aa",
    titleColor: "#fafafa",
    labelColor: "#fafafa",
  },
  light: {
    background: "#ffffff",
    gridColor: "#d4d4d8",
    tickColor: "#71717a",
    titleColor: "#09090b",
    labelColor: "#09090b",
  },
} as const;

const PALETTES = {
  dark: [
    "#00B5FF",
    "#48FFE4",
    "#22c55e",
    "#f59e0b",
    "#0ea5e9",
    "#ef4444",
    "#14b8a6",
    "#f97316",
  ],
  light: [
    "#0284C7",
    "#0D9488",
    "#16a34a",
    "#d97706",
    "#0369a1",
    "#dc2626",
    "#0f766e",
    "#ea580c",
  ],
} as const;

function getTheme(): "dark" | "light" {
  try {
    const themeFile = join(getAnalyticsMediaDir(), "theme.json");
    if (existsSync(themeFile)) {
      const data = JSON.parse(readFileSync(themeFile, "utf8"));
      if (data.theme === "light") return "light";
    }
  } catch {}
  return "dark";
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

interface SeriesData {
  label: string;
  data: number[];
  color?: string;
}

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeColor(value: string | undefined, fallback: string): string {
  const candidate = value?.trim();
  if (candidate && /^#[0-9a-fA-F]{3,8}$/.test(candidate)) {
    return candidate;
  }
  return fallback;
}

function numeric(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatTick(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}b`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

function filenameStem(title: string, explicitFilename?: string): string {
  const stem = slugify(explicitFilename || title) || "chart";
  return explicitFilename ? stem : `${stem}-${Date.now()}`;
}

function chartUrl(filename: string): string {
  const relativePath = `/api/media/${filename}`;
  const origin = process.env.APP_ORIGIN || "";
  const cacheBuster = `?v=${Date.now()}`;
  return origin
    ? `${origin}${relativePath}${cacheBuster}`
    : `${relativePath}${cacheBuster}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function renderStaticChartSvg({
  title,
  subtitle,
  labels,
  datasets,
  type,
  width,
  height,
  theme,
  palette,
  primaryColor,
  stacked,
}: {
  title: string;
  subtitle: string;
  labels: string[];
  datasets: SeriesData[];
  type: "bar" | "line" | "area";
  width: number;
  height: number;
  theme: (typeof THEMES)["dark" | "light"];
  palette: readonly string[];
  primaryColor: string;
  stacked: boolean;
}): string {
  const safeWidth = Math.max(360, Math.min(2000, Math.round(width)));
  const safeHeight = Math.max(240, Math.min(1200, Math.round(height)));
  const chartLeft = 58;
  const chartRight = safeWidth - 28;
  const chartTop = subtitle ? 88 : 66;
  const chartBottom = safeHeight - 48;
  const plotWidth = Math.max(1, chartRight - chartLeft);
  const plotHeight = Math.max(1, chartBottom - chartTop);
  const normalizedLabels = labels.map((label) => String(label ?? ""));
  const series = datasets.map((dataset, index) => ({
    label: dataset.label || `Series ${index + 1}`,
    color: safeColor(
      dataset.color,
      index === 0 ? primaryColor : palette[index % palette.length],
    ),
    data: normalizedLabels.map((_, dataIndex) =>
      Math.max(0, numeric(dataset.data?.[dataIndex])),
    ),
  }));
  const usableSeries = series.length
    ? series
    : [
        {
          label: title,
          color: safeColor(primaryColor, palette[0]),
          data: normalizedLabels.map(() => 0),
        },
      ];

  const stackedTotals = normalizedLabels.map((_, dataIndex) =>
    usableSeries.reduce((sum, dataset) => sum + dataset.data[dataIndex], 0),
  );
  const maxValue = Math.max(
    1,
    ...(stacked && type === "bar"
      ? stackedTotals
      : usableSeries.flatMap((dataset) => dataset.data)),
  );
  const yFor = (value: number) =>
    chartBottom - (Math.max(0, value) / maxValue) * plotHeight;
  const slot = plotWidth / Math.max(normalizedLabels.length, 1);
  const labelStep = Math.max(1, Math.ceil(normalizedLabels.length / 8));

  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = (maxValue / 4) * (4 - index);
    const y = yFor(value);
    return `<line x1="${chartLeft}" x2="${chartRight}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${theme.gridColor}" stroke-width="0.8"/><text x="${chartLeft - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${theme.tickColor}">${escapeXml(formatTick(value))}</text>`;
  }).join("");

  const xLabels = normalizedLabels
    .map((label, index) => {
      if (index % labelStep !== 0 && index !== normalizedLabels.length - 1) {
        return "";
      }
      const x = chartLeft + slot * index + slot / 2;
      const text =
        label.length > 14 ? `${label.slice(0, 12).trimEnd()}...` : label;
      return `<text x="${x.toFixed(1)}" y="${safeHeight - 18}" text-anchor="middle" font-size="11" fill="${theme.tickColor}">${escapeXml(text)}</text>`;
    })
    .join("");

  let marks = "";
  if (type === "bar") {
    if (stacked) {
      marks = normalizedLabels
        .map((_, labelIndex) => {
          const x = chartLeft + slot * labelIndex + slot * 0.2;
          const barWidth = Math.max(5, slot * 0.6);
          let baseline = chartBottom;
          return usableSeries
            .map((dataset) => {
              const value = dataset.data[labelIndex];
              const nextY = yFor(
                chartBottom === baseline
                  ? value
                  : ((chartBottom - baseline) / plotHeight) * maxValue + value,
              );
              const height = Math.max(0, baseline - nextY);
              baseline = nextY;
              return `<rect x="${x.toFixed(1)}" y="${nextY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${height.toFixed(1)}" rx="4" fill="${dataset.color}"/>`;
            })
            .join("");
        })
        .join("");
    } else {
      const groupWidth = slot * 0.72;
      const barWidth = Math.max(4, groupWidth / usableSeries.length - 2);
      marks = normalizedLabels
        .map((_, labelIndex) =>
          usableSeries
            .map((dataset, seriesIndex) => {
              const value = dataset.data[labelIndex];
              const x =
                chartLeft +
                slot * labelIndex +
                slot * 0.14 +
                seriesIndex * (barWidth + 2);
              const y = yFor(value);
              const barHeight = Math.max(2, chartBottom - y);
              return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="4" fill="${dataset.color}"/>`;
            })
            .join(""),
        )
        .join("");
    }
  } else {
    marks = usableSeries
      .map((dataset) => {
        const points = dataset.data.map((value, index) => {
          const x = chartLeft + slot * index + slot / 2;
          return `${x.toFixed(1)},${yFor(value).toFixed(1)}`;
        });
        if (!points.length) return "";
        const path = points
          .map((point, index) => `${index === 0 ? "M" : "L"} ${point}`)
          .join(" ");
        const area =
          type === "area"
            ? `<path d="${path} L ${chartLeft + slot * (points.length - 0.5)},${chartBottom} L ${chartLeft + slot / 2},${chartBottom} Z" fill="${dataset.color}" fill-opacity="0.18"/>`
            : "";
        return `${area}<path d="${path}" fill="none" stroke="${dataset.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
      })
      .join("");
  }

  const legend =
    usableSeries.length > 1
      ? `<g transform="translate(${chartLeft},${subtitle ? 58 : 42})">${usableSeries
          .map((dataset, index) => {
            const x = index * 148;
            return `<rect x="${x}" y="0" width="12" height="12" rx="3" fill="${dataset.color}"/><text x="${x + 18}" y="11" font-size="12" fill="${theme.labelColor}">${escapeXml(dataset.label)}</text>`;
          })
          .join("")}</g>`
      : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}" role="img" aria-label="${escapeXml(title)}">
  <rect width="${safeWidth}" height="${safeHeight}" rx="8" fill="${theme.background}"/>
  <text x="24" y="32" font-family="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="22" font-weight="700" fill="${theme.titleColor}">${escapeXml(title)}</text>
  ${subtitle ? `<text x="24" y="54" font-family="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="13" fill="${theme.tickColor}">${escapeXml(subtitle)}</text>` : ""}
  ${legend}
  <g font-family="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif">
    ${grid}
    <line x1="${chartLeft}" x2="${chartRight}" y1="${chartBottom}" y2="${chartBottom}" stroke="${theme.gridColor}" stroke-width="1"/>
    ${marks}
    ${xLabels}
  </g>
</svg>`;
}

/**
 * Returned alongside any validation `error` so the agent gets an unambiguous
 * recovery path. The previous behavior (a bare error string) led to retry
 * loops where the agent reformatted JSON until it gave up — and from the
 * user's chair, the chat said "I'll do something else" and no chart appeared.
 *
 * For in-chat data questions the right answer is always the live `/chart`
 * embed (see AGENTS.md "Inline Charts in Chat"). Only `save-analysis`
 * artifacts need a static image, and those flows have full data in hand
 * before they call here.
 */
const CHART_FALLBACK_HINT =
  "If you're answering an in-chat data question, do not retry generate-chart. Switch to the live /chart embed described in AGENTS.md ('Inline Charts in Chat') — it accepts a SqlPanel object directly and doesn't require pre-stringified JSON params. Only use generate-chart when you're building a save-analysis artifact.";

export default defineAction({
  description:
    "Render a static chart image to the media directory **for save-analysis artifacts only**. Uses PNG when the native renderer is available and a portable SVG fallback otherwise. For an in-chat answer to a data question, do NOT call this — emit a live `/chart` embed instead (see AGENTS.md 'Inline Charts in Chat'). The static image path exists for analyses that need to render outside this app (exports, archived reports). If validation here fails, switch to the live embed rather than retrying.",
  schema: z.object({
    title: z.string().optional().describe("Chart title (required)"),
    labels: z.string().optional().describe("JSON array of x-axis labels"),
    data: z
      .string()
      .optional()
      .describe("JSON array of numbers or array of {label,data,color} objects"),
    type: z
      .enum(["bar", "line", "area"])
      .optional()
      .describe("Chart type: bar, line, or area"),
    subtitle: z.string().optional().describe("Chart subtitle"),
    width: z.coerce
      .number()
      .optional()
      .describe("Width in pixels (default 800)"),
    height: z.coerce
      .number()
      .optional()
      .describe("Height in pixels (default 400)"),
    theme: z
      .enum(["dark", "light"])
      .optional()
      .describe("Theme: dark or light"),
    color: z.string().optional().describe("Primary color hex"),
    stacked: z.coerce.boolean().optional().describe("Stack bars"),
    filename: z
      .string()
      .optional()
      .describe("Output filename stem (without extension)"),
  }),
  http: false,
  run: async (args) => {
    if (!args.title) {
      return { error: "--title is required", fallback: CHART_FALLBACK_HINT };
    }
    if (!args.labels) {
      return {
        error: "--labels is required (JSON array)",
        fallback: CHART_FALLBACK_HINT,
      };
    }
    if (!args.data) {
      return {
        error:
          "--data is required (JSON array of numbers or array of {label,data,color})",
        fallback: CHART_FALLBACK_HINT,
      };
    }

    const chartType = args.type || "bar";
    const title = args.title;
    const subtitle = args.subtitle || "";
    const width = args.width ?? 800;
    const height = args.height ?? 400;
    const themeName = args.theme || getTheme();
    const theme = THEMES[themeName];
    const palette = PALETTES[themeName];
    const primaryColor = args.color || palette[0];

    let labels: string[];
    try {
      labels = JSON.parse(args.labels);
    } catch {
      return {
        error: "--labels must be valid JSON array",
        fallback: CHART_FALLBACK_HINT,
      };
    }

    let datasets: SeriesData[];
    try {
      const parsed = JSON.parse(args.data);
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        typeof parsed[0] === "object" &&
        "data" in parsed[0]
      ) {
        datasets = parsed as SeriesData[];
      } else {
        datasets = [
          { label: title, data: parsed as number[], color: primaryColor },
        ];
      }
    } catch {
      return {
        error: "--data must be valid JSON array",
        fallback: CHART_FALLBACK_HINT,
      };
    }

    const isArea = chartType === "area";
    const isStacked = args.stacked === true;
    const jsChartType: ChartType = isArea ? "line" : chartType;

    const chartConfig: ChartConfiguration = {
      type: jsChartType,
      data: {
        labels,
        datasets: datasets.map((ds, i) => {
          const color = ds.color || palette[i % palette.length];
          return {
            label: ds.label,
            data: ds.data,
            backgroundColor: isArea ? color + "33" : color,
            borderColor: jsChartType === "line" ? color : "transparent",
            borderWidth: jsChartType === "line" ? 2.5 : 0,
            borderRadius: jsChartType === "bar" ? 3 : 0,
            ...(isStacked && jsChartType === "bar" ? { stack: "stack1" } : {}),
            fill: isArea,
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 4,
          };
        }),
      },
      options: {
        responsive: false,
        animation: false as any,
        layout: { padding: { top: 16, right: 24, bottom: 16, left: 16 } },
        plugins: {
          title: {
            display: true,
            text: title,
            color: theme.titleColor,
            font: { size: 22, weight: "bold" as const },
            padding: { bottom: subtitle ? 2 : 20 },
            align: "start" as const,
          },
          subtitle: {
            display: !!subtitle,
            text: subtitle,
            color: theme.tickColor,
            font: { size: 14, weight: "normal" as const },
            padding: { bottom: 16 },
            align: "start" as const,
          },
          legend: {
            display: datasets.length > 1,
            labels: {
              color: theme.labelColor,
              boxWidth: 14,
              padding: 18,
              font: { size: 13 },
            },
          },
          tooltip: { enabled: false },
        },
        scales: {
          x: {
            stacked: isStacked,
            grid: { color: "transparent" },
            ticks: {
              color: theme.tickColor,
              font: { size: 13 },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 8,
            },
            border: { color: theme.gridColor },
          },
          y: {
            stacked: isStacked,
            grid: { color: theme.gridColor, lineWidth: 0.5 },
            ticks: {
              color: theme.tickColor,
              font: { size: 13 },
              padding: 10,
              maxTicksLimit: 5,
            },
            border: { display: false },
            beginAtZero: true,
          },
        },
      },
      plugins: [
        {
          id: "bg",
          beforeDraw: (chart) => {
            const ctx = chart.ctx;
            ctx.save();
            ctx.fillStyle = theme.background;
            ctx.roundRect(0, 0, chart.width, chart.height, 8);
            ctx.fill();
            ctx.restore();
          },
        },
      ],
    };

    const mediaDir = getAnalyticsMediaDir();

    const stem = filenameStem(title, args.filename);
    const pngFilename = `${stem}.png`;
    const pngFilepath = join(mediaDir, pngFilename);

    try {
      const { ChartJSNodeCanvas } = await import("chartjs-node-canvas");
      const canvas: ChartJSNodeCanvasType = new ChartJSNodeCanvas({
        width,
        height,
        backgroundColour: theme.background,
      });
      const buffer = await canvas.renderToBuffer(chartConfig);
      writeFileSync(pngFilepath, buffer);

      return {
        filename: pngFilename,
        url: chartUrl(pngFilename),
        width,
        height,
        renderer: "png",
      };
    } catch (error) {
      const svgFilename = `${stem}.svg`;
      const svg = renderStaticChartSvg({
        title,
        subtitle,
        labels,
        datasets,
        type: chartType,
        width,
        height,
        theme,
        palette,
        primaryColor,
        stacked: isStacked,
      });
      writeFileSync(join(mediaDir, svgFilename), svg, "utf8");

      return {
        filename: svgFilename,
        url: signedSvgMediaUrl(svgFilename, svg) || chartUrl(svgFilename),
        width,
        height,
        renderer: "svg-fallback",
        fallbackReason: errorMessage(error),
        svg,
      };
    }
  },
});
