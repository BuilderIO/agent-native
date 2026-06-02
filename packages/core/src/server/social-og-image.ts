import {
  defineEventHandler,
  getHeader,
  getMethod,
  getQuery,
  getRequestURL,
  type H3Event,
} from "h3";
import { resolveBuiltInAuthMarketing } from "./auth-marketing.js";
import { getAppName } from "./app-name.js";

export interface AgentNativeOgImageInput {
  appName?: string | null;
  title?: string | null;
  subtitle?: string | null;
  accentText?: string | null;
}

export const AGENT_NATIVE_OG_IMAGE_WIDTH = 1200;
export const AGENT_NATIVE_OG_IMAGE_HEIGHT = 630;
export const AGENT_NATIVE_OG_IMAGE_CACHE_CONTROL =
  "public, max-age=60, stale-while-revalidate=604800, stale-if-error=3600";
export const AGENT_NATIVE_OG_IMAGE_NETLIFY_CACHE_CONTROL =
  "public, durable, max-age=60, stale-while-revalidate=604800, stale-if-error=3600";

const WIDTH = AGENT_NATIVE_OG_IMAGE_WIDTH;
const HEIGHT = AGENT_NATIVE_OG_IMAGE_HEIGHT;
const BRAND_BLUE = "#00B5FF";
const BRAND_MINT = "#48FFE4";
const BG = "#000000";
const FG = "#f5f5f5";
const FONT_FAMILY =
  "Inter, Liberation Sans, Arial, Helvetica, system-ui, sans-serif";
const DEFAULT_ACCENT_TEXT = "100% free and open source";

const LOGO_MARK = `
  <path d="M24.5537 65.7695H0L15.0859 39.4619L37.708 0L60.4912 39.4619H39.6396L24.5537 65.7695Z" fill="white"/>
  <path d="M89.446 0H114L76.2921 65.7704H51.7383L89.446 0Z" fill="url(#brand)"/>
`;

function escapeSvg(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cleanText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value: string): string {
  return value
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function titleFromAppName(appName: string): string {
  if (appName) return appName;
  const basePath =
    process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH || "";
  const slug = basePath.split("/").filter(Boolean)[0] || "";
  return titleCase(slug) || "Agent-Native";
}

interface WrappedText {
  lines: string[];
  truncated: boolean;
}

interface TitleLayout {
  lines: string[];
  fontSize: number;
  lineHeight: number;
}

function estimateTextWidth(value: string, fontSize: number): number {
  let units = 0;
  for (const char of value) {
    if (char === " ") {
      units += 0.28;
    } else if (/[MW@#%&]/.test(char)) {
      units += 0.86;
    } else if (/[A-Z]/.test(char)) {
      units += 0.64;
    } else if (/[ilI.,:;|!']/u.test(char)) {
      units += 0.26;
    } else if (/[0-9]/.test(char)) {
      units += 0.56;
    } else {
      units += 0.54;
    }
  }
  return units * fontSize;
}

function trimTextToWidth(
  value: string,
  fontSize: number,
  maxWidth: number,
): string {
  const ellipsis = "...";
  let trimmed = value.trim();
  while (
    trimmed.length > 0 &&
    estimateTextWidth(`${trimmed}${ellipsis}`, fontSize) > maxWidth
  ) {
    trimmed = trimmed.slice(0, -1).trimEnd();
  }
  return trimmed ? `${trimmed}${ellipsis}` : ellipsis;
}

function wrapTextToWidth(
  value: string,
  fontSize: number,
  maxWidth: number,
  maxLines: number,
): WrappedText {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let truncated = false;

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (estimateTextWidth(next, fontSize) <= maxWidth) {
      current = next;
      continue;
    }
    if (!current) {
      lines.push(trimTextToWidth(word, fontSize, maxWidth));
      truncated = true;
      current = "";
    } else {
      lines.push(current);
      current = word;
    }
    if (lines.length === maxLines) {
      truncated = true;
      break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);

  const usedWordCount = lines.join(" ").split(/\s+/).filter(Boolean).length;
  if (usedWordCount < words.length && lines.length > 0) {
    lines[lines.length - 1] = trimTextToWidth(
      lines[lines.length - 1],
      fontSize,
      maxWidth,
    );
    truncated = true;
  }

  return {
    lines: lines.length ? lines : [trimTextToWidth(value, fontSize, maxWidth)],
    truncated,
  };
}

function getTitleLayout(title: string): TitleLayout {
  const maxTitleWidth = 900;
  if (estimateTextWidth(title, 88) <= maxTitleWidth) {
    return {
      lines: [title],
      fontSize: 88,
      lineHeight: 96,
    };
  }

  for (const fontSize of [76, 70, 64, 58, 52]) {
    const wrapped = wrapTextToWidth(title, fontSize, maxTitleWidth, 2);
    if (!wrapped.truncated) {
      const lineHeight = Math.round(fontSize * 1.1);
      return {
        lines: wrapped.lines,
        fontSize,
        lineHeight,
      };
    }
  }

  const fallbackFontSize = 52;
  const wrapped = wrapTextToWidth(title, fallbackFontSize, maxTitleWidth, 2);
  return {
    lines: wrapped.lines,
    fontSize: fallbackFontSize,
    lineHeight: 60,
  };
}

function textBlock({
  lines,
  x,
  y,
  fontSize,
  lineHeight,
  weight,
  fill,
  anchor = "start",
}: {
  lines: string[];
  x: number;
  y: number;
  fontSize: number;
  lineHeight: number;
  weight: number;
  fill: string;
  anchor?: "start" | "middle";
}): string {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${FONT_FAMILY}" font-size="${fontSize}" font-weight="${weight}" fill="${fill}">${lines
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeSvg(line)}</tspan>`,
    )
    .join("")}</text>`;
}

function resolveDefaultAppName(event?: H3Event): string {
  const requestHost = event
    ? (getHeader(event, "x-forwarded-host") ?? getHeader(event, "host"))
    : undefined;
  const requestPath = event ? getRequestURL(event).pathname : undefined;
  return (
    getAppName() ??
    resolveBuiltInAuthMarketing({ requestHost, requestPath })?.appName ??
    "Agent-Native"
  );
}

function queryStringValue(
  value: unknown,
  maxLength: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = cleanText(value).slice(0, maxLength);
  return clean || undefined;
}

export function renderAgentNativeOgImageSvg(
  input: AgentNativeOgImageInput = {},
): string {
  const appName = cleanText(input.appName) || resolveDefaultAppName();
  const title = cleanText(input.title) || titleFromAppName(appName);
  const accentText = cleanText(input.accentText) || DEFAULT_ACCENT_TEXT;
  const titleLayout = getTitleLayout(title);
  const titleY = titleLayout.lines.length > 1 ? 288 : 330;
  const accentY =
    titleY + titleLayout.lineHeight * (titleLayout.lines.length - 1) + 70;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <title>${escapeSvg(title)} - Agent-Native preview</title>
  <defs>
    <linearGradient id="brand" x1="101.702" y1="67.4791" x2="113.672" y2="-37.4275" gradientUnits="userSpaceOnUse">
      <stop stop-color="${BRAND_BLUE}"/>
      <stop offset="1" stop-color="${BRAND_MINT}"/>
    </linearGradient>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#ffffff" stroke-opacity="0.07" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${BG}"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#grid)"/>
  <g transform="translate(80 116) scale(0.94)">
    ${LOGO_MARK}
  </g>
  <g>
    ${textBlock({
      lines: titleLayout.lines,
      x: 80,
      y: titleY,
      fontSize: titleLayout.fontSize,
      lineHeight: titleLayout.lineHeight,
      weight: 850,
      fill: FG,
    })}
    <text x="84" y="${accentY}" font-family="${FONT_FAMILY}" font-size="34" font-weight="800" fill="${BRAND_BLUE}">${escapeSvg(accentText)}</text>
  </g>
</svg>`;
}

export async function renderAgentNativeOgImagePng(
  input: AgentNativeOgImageInput = {},
): Promise<Uint8Array> {
  const { Resvg } = await import(/* @vite-ignore */ "@resvg/resvg-js");
  const image = new Resvg(renderAgentNativeOgImageSvg(input), {
    fitTo: { mode: "width", value: WIDTH },
    font: {
      loadSystemFonts: true,
      defaultFontFamily: "Arial",
      sansSerifFamily: "Arial",
    },
  }).render();
  return image.asPng();
}

export function agentNativeOgImageResponseHeaders(
  byteLength: number,
): Record<string, string> {
  return {
    "Content-Type": "image/png",
    "Content-Length": String(byteLength),
    "Cache-Control": AGENT_NATIVE_OG_IMAGE_CACHE_CONTROL,
    "CDN-Cache-Control": AGENT_NATIVE_OG_IMAGE_CACHE_CONTROL,
    "Netlify-CDN-Cache-Control": AGENT_NATIVE_OG_IMAGE_NETLIFY_CACHE_CONTROL,
    "Cross-Origin-Resource-Policy": "cross-origin",
  };
}

export function createAgentNativeOgImageHandler(
  options: AgentNativeOgImageInput = {},
) {
  return defineEventHandler(async (event) => {
    const query = getQuery(event);
    const appName = cleanText(options.appName) || resolveDefaultAppName(event);
    const png = await renderAgentNativeOgImagePng({
      ...options,
      appName,
      title: cleanText(options.title) || queryStringValue(query.title, 140),
      subtitle:
        cleanText(options.subtitle) || queryStringValue(query.subtitle, 140),
      accentText:
        cleanText(options.accentText) || queryStringValue(query.accentText, 80),
    });
    const body = png.buffer.slice(
      png.byteOffset,
      png.byteOffset + png.byteLength,
    ) as ArrayBuffer;

    return new Response(getMethod(event) === "HEAD" ? null : body, {
      headers: agentNativeOgImageResponseHeaders(png.byteLength),
    });
  });
}
