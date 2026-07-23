import { resolveOgFontFiles } from "@agent-native/core/server";
import type { RenderedImage, ResvgRenderOptions } from "@resvg/resvg-js";

export interface FormOgImageInput {
  title?: string | null;
  description?: string | null;
  profileImageDataUrl?: string | null;
}

interface FormOgRenderOptions {
  fontFiles?: string[];
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

const BADGE_CX = 996;
const BADGE_CY = 170;

const LOGO_MARK = `
  <path d="M24.5537 65.7695H0L15.0859 39.4619L37.708 0L60.4912 39.4619H39.6396L24.5537 65.7695Z" fill="white"/>
  <path d="M89.446 0H114L76.2921 65.7704H51.7383L89.446 0Z" fill="url(#brand)"/>
`;

const AVATAR_DATA_URL_RE =
  /^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/i;

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

function validProfileImageDataUrl(
  value: string | null | undefined,
): string | undefined {
  const image = value?.trim();
  if (!image || image.length > 2_000_000 || !AVATAR_DATA_URL_RE.test(image)) {
    return undefined;
  }
  return image;
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

function initialsFor(title: string): string {
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "AN";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
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

export function renderFormOgImageSvg(input: FormOgImageInput = {}): string {
  const title = cleanText(input.title) || "Agent-Native Form";
  const description = cleanText(input.description);
  const titleFitsSingleLine = estimateTextWidth(title, 82) <= 820;
  const titleLines = titleFitsSingleLine
    ? [title]
    : wrapText(title, 66, 820, 2);
  const descriptionLines = description ? wrapText(description, 28, 820, 2) : [];
  const titleFontSize = titleFitsSingleLine ? 82 : 66;
  const titleLineHeight = titleLines.length > 1 ? 76 : 92;
  const titleGroupY = titleLines.length > 1 ? 332 : 382;
  const descriptionY = titleLineHeight * (titleLines.length - 1) + 88;
  const initials = initialsFor(title);
  const profileImageDataUrl = validProfileImageDataUrl(
    input.profileImageDataUrl,
  );
  const avatarContent = profileImageDataUrl
    ? `<image x="${BADGE_CX - 86}" y="${BADGE_CY - 86}" width="172" height="172" href="${escapeSvg(profileImageDataUrl)}" preserveAspectRatio="xMidYMid slice" mask="url(#avatarMask)"/>`
    : `<circle cx="${BADGE_CX}" cy="${BADGE_CY}" r="72" fill="url(#brand)" fill-opacity="0.2"/>
       <text x="${BADGE_CX}" y="${BADGE_CY + 20}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="56" font-weight="800" fill="${FG}">${escapeSvg(initials)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <title>${escapeSvg(title)} - Agent-Native Forms preview</title>
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
      <circle cx="${BADGE_CX}" cy="${BADGE_CY}" r="78" fill="white"/>
    </mask>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${BG}"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#grid)"/>
  <g transform="translate(80 86)">
    <g transform="scale(0.62)">
      ${LOGO_MARK}
    </g>
    <text x="90" y="31" font-family="${FONT_FAMILY}" font-size="28" font-weight="800" fill="${FG}">Agent-Native</text>
    <text x="91" y="58" font-family="${FONT_FAMILY}" font-size="18" font-weight="600" fill="${MUTED}">Forms</text>
  </g>
  <g>
    <circle cx="${BADGE_CX}" cy="${BADGE_CY}" r="86" fill="${SURFACE}" stroke="${BORDER}" stroke-width="2"/>
    ${avatarContent}
    <circle cx="${BADGE_CX}" cy="${BADGE_CY}" r="78" fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="1"/>
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
    ${
      descriptionLines.length
        ? textBlock({
            lines: descriptionLines,
            x: 0,
            y: descriptionY,
            fontSize: 28,
            lineHeight: 38,
            weight: 500,
            fill: MUTED,
          })
        : ""
    }
  </g>
</svg>`;
}

export function formOgResvgOptions(
  options: FormOgRenderOptions = {},
): ResvgRenderOptions {
  const fontFiles = options.fontFiles?.length
    ? options.fontFiles
    : resolveOgFontFiles();
  const hasBundledFonts = Boolean(fontFiles?.length);
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
  return import("@resvg/resvg-js");
}

export async function renderFormOgImage(
  input: FormOgImageInput = {},
  options: FormOgRenderOptions = {},
): Promise<RenderedImage> {
  const { Resvg } = await loadResvg();
  return new Resvg(
    renderFormOgImageSvg(input),
    formOgResvgOptions(options),
  ).render();
}

export async function renderFormOgImagePng(
  input: FormOgImageInput = {},
  options: FormOgRenderOptions = {},
): Promise<Uint8Array> {
  return (await renderFormOgImage(input, options)).asPng();
}
