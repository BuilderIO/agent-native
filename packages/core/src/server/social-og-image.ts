import {
  defineEventHandler,
  getHeader,
  getMethod,
  getQuery,
  getRequestURL,
  setResponseHeader,
  type H3Event,
} from "h3";

import { isFirstPartyApp } from "../app-config/app-identity.js";
import { getAppConfig } from "../app-config/index.js";
import { ssrfSafeFetch } from "../extensions/url-safety.js";
import { getAppStatus } from "../shared/app-status.js";
import {
  resolveBuiltInAuthMarketing,
  resolveBuiltInAuthMarketingByName,
  resolveBuiltInAuthMarketingPresentation,
} from "./auth-marketing.js";
import { AGENT_NATIVE_OG_BACKGROUND_DATA_URL } from "./og-background-data.js";
import {
  OG_ARABIC_FONT_FAMILY,
  OG_FONT_FAMILY,
  OG_GEIST_FONT_FAMILY,
  OG_GEIST_MONO_FONT_FAMILY,
  resolveOgFontFiles,
} from "./og-fonts.js";

export interface AgentNativeOgImagePresentation {
  appLabel: string;
  status: string;
  headline: string;
  description: string;
}

export interface AgentNativeOgImageInput {
  appName?: string | null;
  logoUrl?: string | null;
  brand?: "agent-native" | "custom";
  title?: string | null;
  accentText?: string | null;
  presentation?: AgentNativeOgImagePresentation | null;
}

export const AGENT_NATIVE_OG_IMAGE_WIDTH = 1200;
export const AGENT_NATIVE_OG_IMAGE_HEIGHT = 630;
export const AGENT_NATIVE_OG_IMAGE_CACHE_CONTROL =
  "public, max-age=60, stale-while-revalidate=604800, stale-if-error=3600";
export const AGENT_NATIVE_OG_IMAGE_NETLIFY_CACHE_CONTROL =
  "public, durable, max-age=60, stale-while-revalidate=604800, stale-if-error=3600";

const WIDTH = AGENT_NATIVE_OG_IMAGE_WIDTH;
const HEIGHT = AGENT_NATIVE_OG_IMAGE_HEIGHT;
// guard:allow-raw-color — fixed brand palette for a generated social-preview image, not app UI theming
const FG = "#FAF9F5";
// guard:allow-raw-color — fixed brand palette for a generated social-preview image, not app UI theming
const ACCENT_FG = "#9A9997";
const DEFAULT_FONT_FAMILY = `${OG_FONT_FAMILY}, Arial, Helvetica, system-ui, sans-serif`;
const ARABIC_FONT_FAMILY = `${OG_ARABIC_FONT_FAMILY}, ${OG_FONT_FAMILY}, Arial, Helvetica, system-ui, sans-serif`;
const GEIST_FONT_FAMILY = `${OG_GEIST_FONT_FAMILY}, ${OG_FONT_FAMILY}, Arial, Helvetica, system-ui, sans-serif`;
const GEIST_MONO_FONT_FAMILY = `${OG_GEIST_MONO_FONT_FAMILY}, ui-monospace, monospace`;
// guard:allow-raw-color — exact auth-page palette mirrored in a generated social-preview image
const STATUS_BADGE_FG = "#141414";
// guard:allow-raw-color — exact auth-page palette mirrored in a generated social-preview image
const OSS_BADGE_BG = "#1B1B1B";
// guard:allow-raw-color — exact auth-page palette mirrored in a generated social-preview image
const OSS_BADGE_BORDER = "#2E2E2E";
const OSS_BADGE_TEXT = "FREE & OPEN SOURCE";
const GEIST_WIDTH_RATIO = 0.97;
const GEIST_MONO_ADVANCE = 0.6;
const CONTENT_X = 80;
const CONTENT_WIDTH = WIDTH - CONTENT_X * 2;
const DEFAULT_ACCENT_TEXT = "100% free and open source";
const DEFAULT_APP_NAME = "App";
const MAX_LOGO_BYTES = 2_000_000;
const LOGO_CONTENT_TYPE_RE = /^image\/(?:png|jpe?g|gif|webp|svg\+xml)$/i;
const LOGO_DATA_URL_RE = new RegExp(
  `^data:image\\/(?:png|jpe?g|gif|webp|svg\\+xml);base64,[A-Za-z0-9+/]+={0,2}$`,
  "i",
);

const GITHUB_ICON_PATH =
  "M9 19c-4.3 1.4 -4.3 -2.5 -6 -3m12 5v-3.5c0 -1 .1 -1.4 -.5 -2c2.8 -.3 5.5 -1.4 5.5 -6a4.6 4.6 0 0 0 -1.3 -3.2a4.2 4.2 0 0 0 -.1 -3.2s-1.1 -.3 -3.5 1.3a12.3 12.3 0 0 0 -6.2 0c-2.4 -1.6 -3.5 -1.3 -3.5 -1.3a4.2 4.2 0 0 0 -.1 3.2a4.6 4.6 0 0 0 -1.3 3.2c0 4.6 2.7 5.7 5.5 6c-.6 .6 -.6 1.2 -.5 2v3.5";

const LOGO_MARK = `
  <path d="M26.8789 71.999H0L16.5146 43.1992L41.2793 0L66.2197 43.1992H43.3945L26.8789 71.999Z" fill="white"/>
  <path d="M97.914 0H124.794L83.5143 72H56.6348L97.914 0Z" fill="white"/>
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
  presentation?: AgentNativeOgImagePresentation;
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
  letterSpacing,
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
  letterSpacing?: number;
}): string {
  const directionAttrs = direction
    ? ` direction="${direction}" unicode-bidi="plaintext"`
    : "";
  const letterSpacingAttr =
    letterSpacing === undefined
      ? ""
      : ` letter-spacing="${Number(letterSpacing.toFixed(2))}"`;
  return `<text x="${x}" y="${y}" text-anchor="${anchor}"${directionAttrs} font-family="${fontFamily}" font-size="${fontSize}" font-weight="${weight}"${letterSpacingAttr} fill="${fill}">${lines
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
    const appName =
      requestMarketing?.appName ||
      (trustedFirstPartyHost
        ? "Agent-Native"
        : resolveAgentNativeOgImageAppName(event));
    return {
      appName,
      mode,
      presentation:
        configuredFirstParty || trustedFirstPartyHost
          ? resolveAgentNativeOgImagePresentation(appName, {
              requestHost,
              requestPath,
            })
          : undefined,
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

function resolveAgentNativeOgImagePresentation(
  appName: string,
  opts: { requestHost?: string; requestPath?: string },
): AgentNativeOgImagePresentation | undefined {
  const appLabel = appName.replace(/^Agent-Native\s+/i, "").trim();
  if (!appLabel || appLabel.toLowerCase() === "agent-native") return undefined;
  const presentation = resolveBuiltInAuthMarketingPresentation(
    { appName, tagline: "" },
    opts,
  );
  if (!presentation) return undefined;
  return {
    appLabel,
    status: getAppStatus(appLabel),
    headline: presentation.headline,
    description: presentation.description,
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
    /cannot find|no such module|err_module_not_found|dlopen|invalid elf|wrong architecture|not a valid win32|native binding/i.test(
      message,
    )
  );
}

function backgroundImageTag(): string {
  return `<image x="0" y="0" width="${WIDTH}" height="${HEIGHT}" href="${AGENT_NATIVE_OG_BACKGROUND_DATA_URL}" preserveAspectRatio="xMidYMid slice"/>`;
}

function monoTextWidth(value: string, fontSize: number, tracking: number) {
  const length = [...value].length;
  return (
    length * GEIST_MONO_ADVANCE * fontSize + Math.max(0, length - 1) * tracking
  );
}

function getHeadlineLayout(headline: string): TitleLayout {
  const lines = headline.split("\n").map(cleanText).filter(Boolean);
  for (const fontSize of [68, 60, 54]) {
    if (
      lines.length <= 3 &&
      lines.every(
        (line) =>
          estimateTextWidth(line, fontSize) * GEIST_WIDTH_RATIO <=
          CONTENT_WIDTH,
      )
    ) {
      return { lines, fontSize, lineHeight: Math.round(fontSize * 1.15) };
    }
  }
  const fontSize = 48;
  return {
    lines: wrapTextToWidth(
      lines.join(" "),
      fontSize,
      CONTENT_WIDTH / GEIST_WIDTH_RATIO,
      3,
    ).lines,
    fontSize,
    lineHeight: Math.round(fontSize * 1.15),
  };
}

function renderPresentationOgImageSvg(
  presentation: AgentNativeOgImagePresentation,
): string {
  const appLabel = cleanText(presentation.appLabel);
  const status = cleanText(presentation.status).toUpperCase();
  const headline = getHeadlineLayout(presentation.headline);
  const descriptionFontSize = 30;
  const descriptionLineHeight = 40;
  const description = wrapTextToWidth(
    cleanText(presentation.description),
    descriptionFontSize,
    CONTENT_WIDTH / GEIST_WIDTH_RATIO,
    2,
  ).lines;

  const brandCenterY = 94;
  const markHeight = 44;
  const markScale = markHeight / 72;
  const nameX = CONTENT_X + Math.round(125 * markScale) + 20;
  const nameFontSize = 52;
  const badgeFontSize = 22;
  const badgeTracking = badgeFontSize * 0.02;
  const nameBaseline = Math.round(brandCenterY + (nameFontSize * 0.71) / 2);
  const badgeBaselineOffset = Math.round((badgeFontSize * 0.71) / 2);
  const nameTracking = -nameFontSize * 0.04;
  const nameWidth =
    estimateTextWidth(appLabel, nameFontSize) +
    Math.max(0, [...appLabel].length - 1) * nameTracking;
  const statusBadgeX = Math.round(nameX + nameWidth + 20);
  const statusBadgeWidth = Math.round(
    monoTextWidth(status, badgeFontSize, badgeTracking) + 32,
  );

  const ossBadgeHeight = 52;
  const ossBadgeY = HEIGHT - 72 - ossBadgeHeight;
  const ossIconSize = 25;
  const ossIconGap = 12;
  const ossTextX = CONTENT_X + 20 + ossIconSize + ossIconGap;
  const ossBadgeWidth = Math.round(
    ossTextX -
      CONTENT_X +
      monoTextWidth(OSS_BADGE_TEXT, badgeFontSize, badgeTracking) +
      20,
  );
  const descriptionY =
    ossBadgeY - 44 - descriptionLineHeight * (description.length - 1);
  const headlineY =
    descriptionY - 72 - headline.lineHeight * (headline.lines.length - 1);

  const statusBadge = status
    ? `<rect x="${statusBadgeX}" y="${brandCenterY - 20}" width="${statusBadgeWidth}" height="40" rx="20" fill="${FG}"/>
  ${textBlock({
    lines: [status],
    x: statusBadgeX + 16,
    y: brandCenterY + badgeBaselineOffset,
    fontSize: badgeFontSize,
    lineHeight: badgeFontSize,
    weight: 600,
    fill: STATUS_BADGE_FG,
    fontFamily: GEIST_MONO_FONT_FAMILY,
    letterSpacing: badgeTracking,
  })}`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <title>${escapeSvg(appLabel)} - Agent-Native preview</title>
  ${backgroundImageTag()}
  <g transform="translate(${CONTENT_X} ${brandCenterY - markHeight / 2}) scale(${Number(markScale.toFixed(4))})">${LOGO_MARK}</g>
  ${textBlock({
    lines: [appLabel],
    x: nameX,
    y: nameBaseline,
    fontSize: nameFontSize,
    lineHeight: nameFontSize,
    weight: 600,
    fill: FG,
    fontFamily: GEIST_FONT_FAMILY,
    letterSpacing: nameTracking,
  })}
  ${statusBadge}
  ${textBlock({
    lines: headline.lines,
    x: CONTENT_X,
    y: headlineY,
    fontSize: headline.fontSize,
    lineHeight: headline.lineHeight,
    weight: 400,
    fill: FG,
    fontFamily: GEIST_FONT_FAMILY,
    letterSpacing: -headline.fontSize * 0.04,
  })}
  ${textBlock({
    lines: description,
    x: CONTENT_X,
    y: descriptionY,
    fontSize: descriptionFontSize,
    lineHeight: descriptionLineHeight,
    weight: 400,
    fill: ACCENT_FG,
    fontFamily: GEIST_FONT_FAMILY,
  })}
  <rect x="${CONTENT_X + 0.5}" y="${ossBadgeY + 0.5}" width="${ossBadgeWidth - 1}" height="${ossBadgeHeight - 1}" rx="8" fill="${OSS_BADGE_BG}" stroke="${OSS_BADGE_BORDER}"/>
  <g transform="translate(${CONTENT_X + 20} ${ossBadgeY + (ossBadgeHeight - ossIconSize) / 2}) scale(${ossIconSize / 24})"><path d="${GITHUB_ICON_PATH}" fill="none" stroke="${FG}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g>
  ${textBlock({
    lines: [OSS_BADGE_TEXT],
    x: ossTextX,
    y: ossBadgeY + ossBadgeHeight / 2 + badgeBaselineOffset,
    fontSize: badgeFontSize,
    lineHeight: badgeFontSize,
    weight: 600,
    fill: FG,
    fontFamily: GEIST_MONO_FONT_FAMILY,
    letterSpacing: badgeTracking,
  })}
</svg>`;
}

export function renderAgentNativeOgImageSvg(
  input: AgentNativeOgImageInput = {},
): string {
  const configuredBrand = resolveAgentNativeOgImageBrand();
  const appName = cleanText(input.appName) || configuredBrand.appName;
  const mode = input.brand ?? configuredBrand.mode;
  const presentation =
    input.presentation !== undefined
      ? input.presentation
      : cleanText(input.appName)
        ? undefined
        : configuredBrand.presentation;
  if (
    mode === "agent-native" &&
    presentation &&
    !cleanText(input.title) &&
    !cleanText(input.accentText)
  ) {
    return renderPresentationOgImageSvg(presentation);
  }
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
  ${backgroundImageTag()}
  ${logo ? `<g transform="translate(80 116) scale(0.94)">${logo}</g>` : ""}
  <g>
    ${textBlock({
      lines: titleLayout.lines,
      x: textX,
      y: titleY,
      fontSize: titleLayout.fontSize,
      lineHeight: titleLayout.lineHeight,
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
            fill: ACCENT_FG,
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

export function stageOgImageResponseHeaders(
  event: H3Event,
  headers: Record<string, string>,
): Record<string, string> {
  for (const [name, value] of Object.entries(headers)) {
    setResponseHeader(event, name, value);
  }
  return headers;
}

export function createAgentNativeOgImageHandler(
  options: AgentNativeOgImageInput = {},
) {
  return defineEventHandler(async (event) => {
    if (getMethod(event) === "HEAD") {
      return new Response(null, {
        headers: stageOgImageResponseHeaders(
          event,
          agentNativeOgImageResponseHeaders(),
        ),
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
      presentation:
        options.presentation !== undefined
          ? options.presentation
          : cleanText(options.appName)
            ? null
            : (brand.presentation ?? null),
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
        headers: stageOgImageResponseHeaders(
          event,
          agentNativeOgImageResponseHeaders(
            textByteLength(svg),
            "image/svg+xml; charset=utf-8",
          ),
        ),
      });
    }

    return new Response(pngBody(png), {
      headers: stageOgImageResponseHeaders(
        event,
        agentNativeOgImageResponseHeaders(png.byteLength),
      ),
    });
  });
}
