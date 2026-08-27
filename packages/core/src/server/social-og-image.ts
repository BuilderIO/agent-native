import {
  defineEventHandler,
  getHeader,
  getMethod,
  getQuery,
  getRequestURL,
  type H3Event,
} from "h3";

import { isFirstPartyApp } from "../app-config/app-identity.js";
import { getAppConfig } from "../app-config/index.js";
import { ssrfSafeFetch } from "../extensions/url-safety.js";
import {
  resolveBuiltInAuthMarketing,
  resolveBuiltInAuthMarketingByName,
} from "./auth-marketing.js";
import {
  OG_ARABIC_FONT_FAMILY,
  OG_FONT_FAMILY,
  resolveOgFontFiles,
} from "./og-fonts.js";

export interface AgentNativeOgImageInput {
  appName?: string | null;
  logoUrl?: string | null;
  brand?: "agent-native" | "custom";
  title?: string | null;
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
const GRID_SIZE = 48;
const DEFAULT_FONT_FAMILY = `${OG_FONT_FAMILY}, Arial, Helvetica, system-ui, sans-serif`;
const ARABIC_FONT_FAMILY = `${OG_ARABIC_FONT_FAMILY}, ${OG_FONT_FAMILY}, Arial, Helvetica, system-ui, sans-serif`;
const DEFAULT_ACCENT_TEXT = "100% free and open source";
const DEFAULT_APP_NAME = "App";
const MAX_LOGO_BYTES = 2_000_000;
const LOGO_CONTENT_TYPE_RE = /^image\/(?:png|jpe?g|gif|webp|svg\+xml)$/i;
const LOGO_DATA_URL_RE = new RegExp(
  `^data:image\\/(?:png|jpe?g|gif|webp|svg\\+xml);base64,[A-Za-z0-9+/]+={0,2}$`,
  "i",
);

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
  return titleCase(slug) || DEFAULT_APP_NAME;
}

function packageDisplayName(
  packageName: string | undefined,
): string | undefined {
  if (!packageName || packageName.startsWith("@agent-native/")) {
    return undefined;
  }
  const leaf = packageName.split("/").pop()?.trim();
  if (!leaf) return undefined;
  return titleCase(leaf);
}

function sanitizeLogoUrl(input: string | null | undefined): string | undefined {
  const value = cleanText(input);
  if (!value) return undefined;
  if (value.length <= MAX_LOGO_BYTES && LOGO_DATA_URL_RE.test(value)) {
    return value;
  }
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    // coercion-ok: invalid optional logo input is treated as absent.
    return undefined;
  }
}

function isAgentNativeHost(value: string | undefined): boolean {
  const host = value?.split(",")[0]?.trim().split(":")[0].toLowerCase();
  return (
    host === "agent-native.com" || host?.endsWith(".agent-native.com") === true
  );
}

interface AgentNativeOgImageBrand {
  appName: string;
  logoUrl?: string;
  mode: "agent-native" | "custom";
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

function containsArabicText(value: string): boolean {
  return /[\u0600-\u06ff\u0750-\u077f\u0870-\u089f\ufb50-\ufdff\ufe70-\ufeff]/u.test(
    value,
  );
}

function fontFamilyForText(value: string): string {
  return containsArabicText(value) ? ARABIC_FONT_FAMILY : DEFAULT_FONT_FAMILY;
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
  direction,
  fontFamily = DEFAULT_FONT_FAMILY,
}: {
  lines: string[];
  x: number;
  y: number;
  fontSize: number;
  lineHeight: number;
  weight: number;
  fill: string;
  anchor?: "start" | "middle" | "end";
  direction?: "ltr" | "rtl";
  fontFamily?: string;
}): string {
  const directionAttrs = direction
    ? ` direction="${direction}" unicode-bidi="plaintext"`
    : "";
  return `<text x="${x}" y="${y}" text-anchor="${anchor}"${directionAttrs} font-family="${fontFamily}" font-size="${fontSize}" font-weight="${weight}" fill="${fill}">${lines
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeSvg(line)}</tspan>`,
    )
    .join("")}</text>`;
}

export function resolveAgentNativeOgImageAppName(event?: H3Event): string {
  const app = getAppConfig().app;
  const explicitAppName = cleanText(app.name);
  const requestHost = event
    ? (getHeader(event, "x-forwarded-host") ?? getHeader(event, "host"))
    : undefined;
  const requestPath = event ? getRequestURL(event).pathname : undefined;
  if (explicitAppName) {
    if (isFirstPartyApp(app)) {
      return (
        resolveBuiltInAuthMarketingByName(explicitAppName)?.appName ??
        explicitAppName
      );
    }
    return explicitAppName;
  }

  const builtInAppName = resolveBuiltInAuthMarketing({
    requestHost,
    requestPath,
  })?.appName;
  if (builtInAppName) return builtInAppName;

  const appName = app.name;
  if (appName) {
    return resolveBuiltInAuthMarketingByName(appName)?.appName ?? appName;
  }

  const packageName = packageDisplayName(getAppConfig().app.packageName);
  if (packageName) return packageName;

  return (
    resolveBuiltInAuthMarketing({
      requestHost,
      requestPath,
    })?.appName || titleFromAppName("")
  );
}

function resolveAgentNativeOgImageBrand(
  event?: H3Event,
): AgentNativeOgImageBrand {
  const app = getAppConfig().app;
  const requestHost = event
    ? (getHeader(event, "x-forwarded-host") ?? getHeader(event, "host"))
    : undefined;
  const requestPath = event ? getRequestURL(event).pathname : undefined;
  const configuredFirstParty = isFirstPartyApp(app);
  const trustedFirstPartyHost = isAgentNativeHost(requestHost);
  const hasCustomIdentity = Boolean(
    !configuredFirstParty &&
    !trustedFirstPartyHost &&
    (cleanText(app.name) || packageDisplayName(app.packageName)),
  );
  const requestMarketing = hasCustomIdentity
    ? undefined
    : resolveBuiltInAuthMarketing({
        requestHost,
        requestPath,
      });
  const isFirstParty = Boolean(
    configuredFirstParty || requestMarketing || trustedFirstPartyHost,
  );
  const mode = isFirstParty ? "agent-native" : "custom";

  if (mode === "agent-native") {
    return {
      appName:
        requestMarketing?.appName ||
        (trustedFirstPartyHost
          ? "Agent-Native"
          : resolveAgentNativeOgImageAppName(event)),
      mode,
    };
  }

  const customAppName =
    cleanText(app.name) || packageDisplayName(app.packageName);
  return {
    appName: customAppName || resolveAgentNativeOgImageAppName(event),
    logoUrl: sanitizeLogoUrl(app.logoUrl),
    mode,
  };
}

function queryStringValue(
  value: unknown,
  maxLength: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = cleanText(value).slice(0, maxLength);
  return clean || undefined;
}

function pngBody(bytes: Uint8Array): ArrayBuffer {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return body;
}

function textByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function hasLogoSignature(contentType: string, bytes: Uint8Array): boolean {
  const normalizedContentType = contentType.toLowerCase();
  if (normalizedContentType === "image/png") {
    if (bytes.byteLength < 8) return false;
    return bytes
      .subarray(0, 8)
      .every(
        (byte, index) =>
          [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index] === byte,
      );
  }
  if (
    normalizedContentType === "image/jpeg" ||
    normalizedContentType === "image/jpg"
  ) {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (normalizedContentType === "image/gif") {
    const signature = String.fromCharCode(...bytes.subarray(0, 6));
    return signature === "GIF87a" || signature === "GIF89a";
  }
  if (normalizedContentType === "image/webp") {
    return (
      String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
    );
  }
  return /<svg(?:\s|>)/i.test(new TextDecoder().decode(bytes));
}

async function loadLogoDataUrl(
  logoUrl: string | null | undefined,
): Promise<string | undefined> {
  const url = sanitizeLogoUrl(logoUrl);
  if (!url || url.startsWith("data:")) return url;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2_500);
  try {
    const response = await ssrfSafeFetch(
      url,
      {
        headers: { "User-Agent": "Agent-Native OG Image" },
        signal: controller.signal,
      },
      { httpsOnly: true, maxRedirects: 2 },
    );
    if (!response.ok) {
      await response.body?.cancel();
      return undefined;
    }

    const contentType =
      response.headers.get("content-type")?.split(";")[0]?.trim() || "";
    if (!LOGO_CONTENT_TYPE_RE.test(contentType)) {
      await response.body?.cancel();
      return undefined;
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_LOGO_BYTES) {
      await response.body?.cancel();
      return undefined;
    }

    const body = response.body;
    if (!body) return undefined;
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        byteLength += value.byteLength;
        if (byteLength > MAX_LOGO_BYTES) {
          await reader.cancel();
          return undefined;
        }
        chunks.push(value);
      }

      const bytes = new Uint8Array(byteLength);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      if (!hasLogoSignature(contentType, bytes)) return undefined;
      return `data:${contentType};base64,${bytesToBase64(bytes)}`;
    } finally {
      reader.releaseLock();
    }
  } catch {
    // coercion-ok: an unreadable optional remote logo is intentionally omitted.
    return undefined;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function isResvgRuntimeUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    /@resvg\/resvg-js|resvgjs\.[\w-]+\.node|native binding/i.test(message) &&
    // "no such module" is workerd's wording when the package is externalized
    // out of the Cloudflare worker bundle.
    /cannot find|no such module|err_module_not_found|dlopen|invalid elf|wrong architecture|not a valid win32|native binding/i.test(
      message,
    )
  );
}

export function renderAgentNativeOgImageSvg(
  input: AgentNativeOgImageInput = {},
): string {
  const configuredBrand = resolveAgentNativeOgImageBrand();
  const appName = cleanText(input.appName) || configuredBrand.appName;
  const mode = input.brand ?? configuredBrand.mode;
  const logoUrl =
    mode === "custom"
      ? sanitizeLogoUrl(
          input.logoUrl !== undefined ? input.logoUrl : configuredBrand.logoUrl,
        )
      : undefined;
  const title = cleanText(input.title) || titleFromAppName(appName);
  const accentText =
    cleanText(input.accentText) ||
    (mode === "agent-native" ? DEFAULT_ACCENT_TEXT : "");
  const titleLayout = getTitleLayout(title);
  const titleIsRtl = containsArabicText(title);
  const textX = titleIsRtl ? WIDTH - 80 : 80;
  const accentX = titleIsRtl ? WIDTH - 84 : 84;
  const textAnchor = titleIsRtl ? "end" : "start";
  const titleY = titleLayout.lines.length > 1 ? 288 : 330;
  const accentY =
    titleY + titleLayout.lineHeight * (titleLayout.lines.length - 1) + 70;
  const logo = logoUrl
    ? `<image x="0" y="0" width="114" height="66" href="${escapeSvg(logoUrl)}" preserveAspectRatio="xMidYMid meet"/>`
    : mode === "agent-native"
      ? LOGO_MARK
      : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <title>${escapeSvg(title)}${mode === "agent-native" ? " - Agent-Native preview" : " preview"}</title>
  <defs>
    ${
      mode === "agent-native"
        ? `<linearGradient id="brand" x1="101.702" y1="67.4791" x2="113.672" y2="-37.4275" gradientUnits="userSpaceOnUse">
      <stop stop-color="${BRAND_BLUE}"/>
      <stop offset="1" stop-color="${BRAND_MINT}"/>
    </linearGradient>`
        : ""
    }
    <pattern id="grid" width="${GRID_SIZE}" height="${GRID_SIZE}" patternUnits="userSpaceOnUse">
      <path d="M 0 0.5 H ${GRID_SIZE} M 0.5 0 V ${GRID_SIZE}" fill="none" stroke="#ffffff" stroke-opacity="0.07" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${BG}"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#grid)"/>
  ${logo ? `<g transform="translate(80 116) scale(0.94)">${logo}</g>` : ""}
  <g>
    ${textBlock({
      lines: titleLayout.lines,
      x: textX,
      y: titleY,
      fontSize: titleLayout.fontSize,
      lineHeight: titleLayout.lineHeight,
      // resvg's fontdb maps font-weight 850 to the Regular face (only 400/700
      // exist for Liberation Sans); 800 resolves to Bold, the heaviest face we
      // bundle, which is the intended look for the display title.
      weight: 800,
      fill: FG,
      anchor: textAnchor,
      direction: titleIsRtl ? "rtl" : undefined,
      fontFamily: fontFamilyForText(title),
    })}
    ${
      accentText
        ? textBlock({
            lines: [accentText],
            x: accentX,
            y: accentY,
            fontSize: 34,
            lineHeight: 40,
            weight: 800,
            fill: BRAND_BLUE,
            anchor: textAnchor,
            fontFamily: fontFamilyForText(accentText),
          })
        : ""
    }
  </g>
</svg>`;
}

export async function renderAgentNativeOgImagePng(
  input: AgentNativeOgImageInput = {},
): Promise<Uint8Array> {
  const overridePackage =
    typeof process !== "undefined"
      ? process.env.AGENT_NATIVE_RESVG_PACKAGE
      : undefined;
  const resvgPackage = overridePackage || "@resvg/resvg-js";
  const { Resvg } = await import(/* @vite-ignore */ resvgPackage);
  const configuredLogoUrl =
    input.logoUrl !== undefined
      ? input.logoUrl
      : resolveAgentNativeOgImageBrand().logoUrl;
  const logoUrl = await loadLogoDataUrl(configuredLogoUrl);
  // Feed resvg the embedded Liberation Sans font explicitly. System fonts can't
  // be relied on: Linux serverless runtimes (Netlify/Lambda) ship neither Arial
  // nor Inter, so without a bundled font every `<text>` rendered blank.
  const fontFiles = resolveOgFontFiles();
  const hasBundledFonts = Boolean(fontFiles?.length);
  const render = (renderLogoUrl: string | null) =>
    new Resvg(
      renderAgentNativeOgImageSvg({
        ...input,
        logoUrl: renderLogoUrl,
      }),
      {
        fitTo: { mode: "width", value: WIDTH },
        font: {
          loadSystemFonts: !hasBundledFonts,
          ...(hasBundledFonts ? { fontFiles } : {}),
          defaultFontFamily: OG_FONT_FAMILY,
          serifFamily: OG_FONT_FAMILY,
          sansSerifFamily: OG_FONT_FAMILY,
        },
      },
    ).render();
  let image;
  try {
    image = render(logoUrl ?? null);
  } catch (error) {
    if (logoUrl === undefined) throw error;
    image = render(null);
  }
  return image.asPng();
}

export function agentNativeOgImageResponseHeaders(
  byteLength?: number,
  contentType = "image/png",
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": AGENT_NATIVE_OG_IMAGE_CACHE_CONTROL,
    "CDN-Cache-Control": AGENT_NATIVE_OG_IMAGE_CACHE_CONTROL,
    "Netlify-CDN-Cache-Control": AGENT_NATIVE_OG_IMAGE_NETLIFY_CACHE_CONTROL,
    "Cross-Origin-Resource-Policy": "cross-origin",
  };
  if (typeof byteLength === "number") {
    headers["Content-Length"] = String(byteLength);
  }
  return headers;
}

export function createAgentNativeOgImageHandler(
  options: AgentNativeOgImageInput = {},
) {
  return defineEventHandler(async (event) => {
    if (getMethod(event) === "HEAD") {
      return new Response(null, {
        headers: agentNativeOgImageResponseHeaders(),
      });
    }

    const query = getQuery(event);
    const brand = resolveAgentNativeOgImageBrand(event);
    const appName = cleanText(options.appName) || brand.appName;
    const input = {
      ...options,
      appName,
      brand: options.brand ?? brand.mode,
      logoUrl: options.logoUrl !== undefined ? options.logoUrl : brand.logoUrl,
      title: cleanText(options.title) || queryStringValue(query.title, 140),
      accentText:
        cleanText(options.accentText) || queryStringValue(query.accentText, 80),
    };

    let png: Uint8Array;
    try {
      png = await renderAgentNativeOgImagePng(input);
    } catch (error) {
      if (!isResvgRuntimeUnavailableError(error)) throw error;
      const svg = renderAgentNativeOgImageSvg(input);
      return new Response(svg, {
        headers: agentNativeOgImageResponseHeaders(
          textByteLength(svg),
          "image/svg+xml; charset=utf-8",
        ),
      });
    }

    return new Response(pngBody(png), {
      headers: agentNativeOgImageResponseHeaders(png.byteLength),
    });
  });
}
