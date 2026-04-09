import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import type { ChartConfiguration, ChartType } from "chart.js";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const MEDIA_DIR = join(import.meta.dirname, "../media");

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

const PALETTE = [
  "#18B4F4",
  "#8b5cf6",
  "#22c55e",
  "#f59e0b",
  "#6366f1",
  "#ef4444",
  "#14b8a6",
  "#f97316",
];

function getTheme(): "dark" | "light" {
  try {
    const themeFile = join(MEDIA_DIR, "theme.json");
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

export default defineAction({
  description:
    "Generate a chart image (bar, line, or area) and save it to the media directory.",
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
    filename: z.string().optional().describe("Output filename (without .png)"),
  }),
  http: false,
  run: async (args) => {
    if (!args.title) return { error: "--title is required" };
    if (!args.labels) return { error: "--labels is required (JSON array)" };
    if (!args.data)
      return {
        error:
          "--data is required (JSON array of numbers or array of {label,data,color})",
      };

    const chartType = args.type || "bar";
    const title = args.title;
    const subtitle = args.subtitle || "";
    const width = args.width ?? 800;
    const height = args.height ?? 400;
    const themeName = args.theme || getTheme();
    const theme = THEMES[themeName];
    const primaryColor = args.color || PALETTE[0];

    let labels: string[];
    try {
      labels = JSON.parse(args.labels);
    } catch {
      return { error: "--labels must be valid JSON array" };
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
      return { error: "--data must be valid JSON array" };
    }

    const isArea = chartType === "area";
    const isStacked = args.stacked === true;
    const jsChartType: ChartType = isArea ? "line" : chartType;

    const chartConfig: ChartConfiguration = {
      type: jsChartType,
      data: {
        labels,
        datasets: datasets.map((ds, i) => {
          const color = ds.color || PALETTE[i % PALETTE.length];
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

    if (!existsSync(MEDIA_DIR)) {
      mkdirSync(MEDIA_DIR, { recursive: true });
    }

    const filename =
      (args.filename || `${slugify(title)}-${Date.now()}`) + ".png";
    const filepath = join(MEDIA_DIR, filename);

    const canvas = new ChartJSNodeCanvas({
      width,
      height,
      backgroundColour: theme.background,
    });
    const buffer = await canvas.renderToBuffer(chartConfig);
    writeFileSync(filepath, buffer);

    const relativePath = `/api/media/${filename}`;
    const origin = process.env.APP_ORIGIN || "";
    const cacheBuster = `?v=${Date.now()}`;
    const url = origin
      ? `${origin}${relativePath}${cacheBuster}`
      : `${relativePath}${cacheBuster}`;
    return { filename, url, width, height };
  },
});
