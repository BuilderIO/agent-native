import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "path";

import { defineAction } from "@agent-native/core";
import type { ChartConfiguration, ChartType } from "chart.js";
import type { ChartJSNodeCanvas as ChartJSNodeCanvasType } from "chartjs-node-canvas";
import { z } from "zod";

import { getAnalyticsMediaDir } from "../server/lib/media-dir.js";
import {
  CHART_PALETTES,
  CHART_THEMES,
  renderStaticChartSvg,
} from "../server/lib/report-chart-svg.js";
import { signedSvgMediaUrl } from "../server/lib/signed-media.js";
import { cliBoolean } from "./schema-helpers";

export { renderStaticChartSvg };

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

/**
 * Returned alongside any validation `error` so the agent gets an unambiguous
 * recovery path. The previous behavior (a bare error string) led to retry
 * loops where the agent reformatted JSON until it gave up — and from the
 * user's chair, the chat said "I'll do something else" and no chart appeared.
 *
 * For in-chat data questions the right answer is always the live `/chart`
 * embed (see the `data-querying` skill's "Inline Charts In Chat" section for
 * the full shape). Only `save-analysis` artifacts need a static image, and
 * those flows have full data in hand before they call here.
 */
const CHART_FALLBACK_HINT =
  "If you're answering an in-chat data question, do not retry generate-chart, and do not type this action's title/labels/data/type parameters as plain chat text (e.g. `/chart type=bar title=... labels=[...] data=[...]`) — that is not the supported syntax and only a best-effort compatibility fallback may recover a chart from it. Switch to the live /chart embed instead — it accepts a SqlPanel object directly and doesn't require pre-stringified JSON params. See the data-querying skill's \"Inline Charts In Chat\" section for the exact ```embed fence syntax. Only use generate-chart when you're building a save-analysis artifact.";

export default defineAction({
  description:
    "Render a static chart image to the media directory **for save-analysis artifacts only**. Uses PNG when the native renderer is available and a portable SVG fallback otherwise. For an in-chat answer to a data question, do NOT call this — emit a live `/chart` embed instead (see the data-querying skill's \"Inline Charts In Chat\" section for the embed syntax). Never write this action's `title`/`labels`/`data`/`type` parameters as literal chat text (e.g. `/chart type=bar title=... labels=[...] data=[...]`) — that is not the supported syntax; a best-effort compatibility fallback may recover a simple chart from it, but it rejects malformed input and never re-queries live data like the embed does. The static image path exists for analyses that need to render outside this app (exports, archived reports). If validation here fails, switch to the live embed rather than retrying.",
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
    stacked: cliBoolean.optional().describe("Stack bars"),
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
    const theme = CHART_THEMES[themeName];
    const palette = CHART_PALETTES[themeName];
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
