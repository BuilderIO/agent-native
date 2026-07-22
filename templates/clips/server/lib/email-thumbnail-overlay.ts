/**
 * Composites a static play button + duration badge onto a recording's
 * thumbnail for the "shared with you" email. Email clients can't reliably
 * render CSS overlays (absolute positioning, backdrop blur), so this bakes
 * the same look as the live player's paused-state overlay into one flattened
 * image instead.
 */

import {
  OG_FONT_FAMILY,
  probeRasterImageDimensions,
  renderSvgToPng,
} from "@agent-native/core/server";

const FONT_FAMILY = `${OG_FONT_FAMILY}, Arial, Helvetica, sans-serif`;
const FALLBACK_ASPECT_RATIO = 16 / 9;
// 2x the 488px width the email template renders the thumbnail at.
const CANVAS_WIDTH = 976;

/**
 * Mirrors the live player's `formatWatchDuration` (paused-overlay pill text)
 * so the email thumbnail reads the same way as the actual video view.
 */
export function formatEmailDurationLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours} hr ${minutes} min` : `${hours} hr`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes} min ${seconds} sec` : `${minutes} min`;
  }
  return `${seconds} sec`;
}

function escapeSvg(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface EmailThumbnailOverlayInput {
  imageBytes: Uint8Array;
  mimeType: string;
  durationMs: number;
}

export async function renderEmailThumbnailSvg(
  input: EmailThumbnailOverlayInput,
): Promise<string> {
  const dims = await probeRasterImageDimensions(input.imageBytes);
  const aspectRatio = dims ? dims.width / dims.height : FALLBACK_ASPECT_RATIO;
  const width = CANVAS_WIDTH;
  const height = Math.max(1, Math.round(width / aspectRatio));

  const base64 = Buffer.from(input.imageBytes).toString("base64");
  const dataUri = `data:${input.mimeType};base64,${base64}`;

  const cx = width / 2;
  const cy = height / 2;
  // Matches the live player's `clamp(3rem, 13cqw, 6rem)` play button sizing.
  const playRadius = Math.min(96, Math.max(56, Math.min(width, height) * 0.14));
  const triangleSize = playRadius * 0.62;
  // Nudge the triangle right of center, like the player's `ml-[6%]` icon offset.
  const triLeft = cx - triangleSize * 0.42;
  const triRight = cx + triangleSize * 0.62;
  const triTop = cy - triangleSize * 0.58;
  const triBottom = cy + triangleSize * 0.58;

  const durationLabel = formatEmailDurationLabel(input.durationMs);
  const durationFontSize = 24;
  const pillPaddingX = 22;
  const pillHeight = 46;
  const pillY = cy + playRadius + 26;
  const pillWidth = durationLabel
    ? Math.max(
        96,
        durationLabel.length * (durationFontSize * 0.6) + pillPaddingX * 2,
      )
    : 0;

  const durationBadge = durationLabel
    ? `
      <rect x="${cx - pillWidth / 2}" y="${pillY}" width="${pillWidth}" height="${pillHeight}" rx="10" fill="black" fill-opacity="0.75" />
      <text x="${cx}" y="${pillY + pillHeight / 2 + durationFontSize * 0.35}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="${durationFontSize}" font-weight="700" fill="white">${escapeSvg(durationLabel)}</text>
    `
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <image href="${dataUri}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" />
  <rect width="${width}" height="${height}" fill="black" fill-opacity="0.15" />
  <circle cx="${cx}" cy="${cy}" r="${playRadius}" fill="white" fill-opacity="0.96" />
  <path d="M ${triLeft} ${triTop} L ${triLeft} ${triBottom} L ${triRight} ${cy} Z" fill="black" />
  ${durationBadge}
</svg>`;
}

export async function renderEmailThumbnailPng(
  input: EmailThumbnailOverlayInput,
): Promise<Uint8Array> {
  const svg = await renderEmailThumbnailSvg(input);
  return renderSvgToPng(svg);
}
