import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { RenderedImage, ResvgRenderOptions } from "@resvg/resvg-js";

export interface BookingOgImageInput {
  title?: string | null;
  description?: string | null;
  duration?: number | null;
  durations?: number[] | null;
  username?: string | null;
  ownerEmail?: string | null;
  bookingPageTitle?: string | null;
  profileImageDataUrl?: string | null;
}

const WIDTH = 1200;
const HEIGHT = 630;
const BRAND_BLUE = "#00B5FF";
const BRAND_MINT = "#48FFE4";
const BG = "#000000";
const SURFACE = "#0a0a0a";
const BORDER = "#1f1f1f";
const FG = "#ededed";
const MUTED = "#a0a0a0";
const FONT_FAMILY = "Liberation Sans, Arial, system-ui, sans-serif";
const FONT_FILES = [
  fileURLToPath(
    new URL("../../assets/fonts/LiberationSans-Regular.ttf", import.meta.url),
  ),
  fileURLToPath(
    new URL("../../assets/fonts/LiberationSans-Bold.ttf", import.meta.url),
  ),
].filter((fontFile) => existsSync(fontFile));
const AVATAR_CX = 996;
const AVATAR_CY = 170;
const AVATAR_SIZE = 172;

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

function displayNameFromIdentifier(
  username?: string | null,
  ownerEmail?: string | null,
): string {
  const usernameName = titleCase(cleanText(username));
  const emailName = titleCase(cleanText(ownerEmail).split("@")[0]);
  if (emailName.split(/\s+/).length > usernameName.split(/\s+/).length) {
    return emailName;
  }
  return usernameName || emailName || "Host";
}

function hostNameFromBookingPageTitle(title?: string | null): string | null {
  const clean = cleanText(title);
  const match = clean.match(/^book(?:\s+a)?\s+meeting\s+with\s+(.+)$/i);
  if (match?.[1]) return cleanText(match[1]);
  const meetMatch = clean.match(/^meet\s+(.+)$/i);
  if (meetMatch?.[1]) return cleanText(meetMatch[1]);
  return null;
}

function isGenericMeetingTitle(title: string): boolean {
  return /^(book\s+a\s+meeting|meeting)$/i.test(title);
}

function displayTitle(input: BookingOgImageInput, hostName: string): string {
  const title = cleanText(input.title);
  const pageTitle = cleanText(input.bookingPageTitle);
  if (title && !isGenericMeetingTitle(title)) return title;
  return hostName
    ? `Meet with ${hostName}`
    : pageTitle || title || "Book a meeting";
}

function durationLabel(input: BookingOgImageInput): string {
  const durations = Array.isArray(input.durations)
    ? input.durations.filter((value) => Number.isFinite(value) && value > 0)
    : [];
  if (durations.length > 1) {
    return `${durations.slice(0, 3).join(" / ")} min options`;
  }
  const duration = durations[0] ?? input.duration ?? 30;
  return `${duration} min meeting`;
}

function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "AN";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function validProfileImageDataUrl(value: string | null | undefined): string {
  const dataUrl = cleanText(value);
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl) ? dataUrl : "";
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

function wrapText(
  value: string,
  fontSize: number,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (estimateTextWidth(next, fontSize) <= maxWidth) {
      current = next;
      continue;
    }
    if (!current) {
      lines.push(trimTextToWidth(word, fontSize, maxWidth));
      current = "";
    } else {
      lines.push(current);
      current = word;
    }
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);

  const usedWordCount = lines.join(" ").split(/\s+/).filter(Boolean).length;
  if (usedWordCount < words.length && lines.length > 0) {
    lines[lines.length - 1] = trimTextToWidth(
      lines[lines.length - 1],
      fontSize,
      maxWidth,
    );
  }

  return lines.length ? lines : [trimTextToWidth(value, fontSize, maxWidth)];
}

function textBlock({
  lines,
  x,
  y,
  fontSize,
  lineHeight,
  weight,
  fill,
}: {
  lines: string[];
  x: number;
  y: number;
  fontSize: number;
  lineHeight: number;
  weight: number;
  fill: string;
}): string {
  return `<text x="${x}" y="${y}" font-family="${FONT_FAMILY}" font-size="${fontSize}" font-weight="${weight}" fill="${fill}">${lines
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeSvg(line)}</tspan>`,
    )
    .join("")}</text>`;
}

export function renderBookingOgImageSvg(input: BookingOgImageInput): string {
  const inferredHost =
    hostNameFromBookingPageTitle(input.bookingPageTitle) ??
    displayNameFromIdentifier(input.username, input.ownerEmail);
  const title = displayTitle(input, inferredHost);
  const titleFitsSingleLine = estimateTextWidth(title, 82) <= 820;
  const titleLines = titleFitsSingleLine
    ? [title]
    : wrapText(title, 66, 820, 2);
  const duration = durationLabel(input);
  const initials = initialsFor(inferredHost);
  const profileImageDataUrl = validProfileImageDataUrl(
    input.profileImageDataUrl,
  );
  const titleFontSize = titleFitsSingleLine ? 82 : 66;
  const titleLineHeight = titleLines.length > 1 ? 76 : 92;
  const titleGroupY = titleLines.length > 1 ? 332 : 382;
  const durationBadge =
    titleLines.length === 1
      ? `<g transform="translate(0 150)">
      <rect x="0" y="-34" width="${Math.max(246, duration.length * 17 + 54)}" height="58" rx="29" fill="${SURFACE}" stroke="${BORDER}"/>
      <circle cx="31" cy="-5" r="8" fill="${BRAND_MINT}"/>
      <text x="54" y="4" font-family="${FONT_FAMILY}" font-size="27" font-weight="700" fill="${FG}">${escapeSvg(duration)}</text>
    </g>`
      : "";
  const avatarContent = profileImageDataUrl
    ? `<image x="${AVATAR_CX - AVATAR_SIZE / 2}" y="${AVATAR_CY - AVATAR_SIZE / 2}" width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" href="${escapeSvg(profileImageDataUrl)}" preserveAspectRatio="xMidYMid slice" mask="url(#avatarMask)"/>`
    : `<circle cx="${AVATAR_CX}" cy="${AVATAR_CY}" r="72" fill="url(#brand)" fill-opacity="0.2"/>
       <text x="${AVATAR_CX}" y="${AVATAR_CY + 20}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="56" font-weight="800" fill="${FG}">${escapeSvg(initials)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <title>Agent-Native Calendar booking link</title>
  <defs>
    <linearGradient id="brand" x1="101.702" y1="67.4791" x2="113.672" y2="-37.4275" gradientUnits="userSpaceOnUse">
      <stop stop-color="${BRAND_BLUE}"/>
      <stop offset="1" stop-color="${BRAND_MINT}"/>
    </linearGradient>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#ffffff" stroke-opacity="0.07" stroke-width="1"/>
    </pattern>
    <mask id="avatarMask">
      <rect width="${WIDTH}" height="${HEIGHT}" fill="black"/>
      <circle cx="${AVATAR_CX}" cy="${AVATAR_CY}" r="78" fill="white"/>
    </mask>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${BG}"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#grid)"/>
  <rect x="64" y="64" width="1072" height="502" rx="28" fill="${BG}" fill-opacity="0.72" stroke="${BORDER}" stroke-width="1"/>
  <path d="M80 154 H1120" stroke="${BORDER}"/>
  <g transform="translate(80 86)">
    <g transform="scale(0.62)">
      ${LOGO_MARK}
    </g>
    <text x="90" y="31" font-family="${FONT_FAMILY}" font-size="28" font-weight="800" fill="${FG}">Agent-Native</text>
    <text x="91" y="58" font-family="${FONT_FAMILY}" font-size="18" font-weight="600" fill="${MUTED}">Calendar</text>
  </g>
  <g>
    <circle cx="${AVATAR_CX}" cy="${AVATAR_CY}" r="86" fill="${SURFACE}" stroke="${BORDER}" stroke-width="2"/>
    ${avatarContent}
    <circle cx="${AVATAR_CX}" cy="${AVATAR_CY}" r="78" fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="1"/>
  </g>
  <g transform="translate(80 ${titleGroupY})">
    ${textBlock({
      lines: titleLines,
      x: 0,
      y: 0,
      fontSize: titleFontSize,
      lineHeight: titleLineHeight,
      weight: 800,
      fill: FG,
    })}
    ${durationBadge}
  </g>
</svg>`;
}

interface BookingOgRenderOptions {
  fontFiles?: string[];
}

function bookingOgResvgOptions(
  options: BookingOgRenderOptions = {},
): ResvgRenderOptions {
  const fontFiles = (
    options.fontFiles?.length ? options.fontFiles : FONT_FILES
  ).filter((fontFile) => existsSync(fontFile));
  const hasBundledFonts = fontFiles.length > 0;
  return {
    fitTo: { mode: "width", value: WIDTH },
    font: {
      loadSystemFonts: !hasBundledFonts,
      ...(hasBundledFonts ? { fontFiles } : {}),
      defaultFontFamily: "Liberation Sans",
      sansSerifFamily: "Liberation Sans",
    },
  };
}

async function loadResvg(): Promise<typeof import("@resvg/resvg-js")> {
  return import(/* @vite-ignore */ "@resvg/resvg-js");
}

export async function renderBookingOgImage(
  input: BookingOgImageInput,
  options: BookingOgRenderOptions = {},
): Promise<RenderedImage> {
  const { Resvg } = await loadResvg();
  return new Resvg(renderBookingOgImageSvg(input), {
    ...bookingOgResvgOptions(options),
  }).render();
}

export async function renderBookingOgImagePng(
  input: BookingOgImageInput,
  options: BookingOgRenderOptions = {},
): Promise<Uint8Array> {
  return (await renderBookingOgImage(input, options)).asPng();
}
