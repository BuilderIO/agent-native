import { Resvg } from "@resvg/resvg-js";

export interface BookingOgImageInput {
  title?: string | null;
  description?: string | null;
  duration?: number | null;
  durations?: number[] | null;
  username?: string | null;
  ownerEmail?: string | null;
  bookingPageTitle?: string | null;
}

const WIDTH = 1200;
const HEIGHT = 630;

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
  if (pageTitle && !isGenericMeetingTitle(pageTitle)) return pageTitle;
  return hostName ? `Meet ${hostName}` : title || pageTitle || "Book a meeting";
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

function wrapText(value: string, maxChars: number, maxLines: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);

  if (lines.length > maxLines) return lines.slice(0, maxLines);
  const last = lines[lines.length - 1];
  const remainingWords = words.slice(lines.join(" ").split(/\s+/).length);
  if (remainingWords.length > 0 && last) {
    lines[lines.length - 1] =
      last.length > maxChars - 1
        ? `${last.slice(0, Math.max(0, maxChars - 1)).trim()}...`
        : `${last}...`;
  }
  return lines.length ? lines : [value.slice(0, maxChars)];
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
  return `<text x="${x}" y="${y}" font-family="Inter, Arial, system-ui, sans-serif" font-size="${fontSize}" font-weight="${weight}" fill="${fill}">${lines
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
  const titleLines = wrapText(title, title.length > 34 ? 23 : 28, 2);
  const description = cleanText(input.description);
  const descriptionLines = description
    ? wrapText(description, 52, 2)
    : [`Pick a time with ${inferredHost}`];
  const duration = durationLabel(input);
  const initials = initialsFor(inferredHost);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#050505"/>
      <stop offset="0.56" stop-color="#0a0d0f"/>
      <stop offset="1" stop-color="#020202"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#00d1ff"/>
      <stop offset="1" stop-color="#7cffc4"/>
    </linearGradient>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#ffffff" stroke-opacity="0.055" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#grid)"/>
  <path d="M0 518 C190 456 294 460 482 506 C702 560 866 546 1200 438 L1200 630 L0 630 Z" fill="#ffffff" fill-opacity="0.035"/>
  <path d="M80 78 H1120" stroke="#ffffff" stroke-opacity="0.11"/>
  <g transform="translate(80 112)">
    <rect x="0" y="0" width="58" height="58" rx="16" fill="url(#accent)"/>
    <text x="29" y="38" text-anchor="middle" font-family="Inter, Arial, system-ui, sans-serif" font-size="22" font-weight="800" fill="#020202">AN</text>
    <text x="78" y="25" font-family="Inter, Arial, system-ui, sans-serif" font-size="28" font-weight="800" fill="#ffffff">Agent-Native</text>
    <text x="78" y="51" font-family="Inter, Arial, system-ui, sans-serif" font-size="20" font-weight="600" fill="#94a3b8">Calendar</text>
  </g>
  <g transform="translate(904 112)">
    <circle cx="92" cy="92" r="86" fill="#0e1113" stroke="#ffffff" stroke-opacity="0.14" stroke-width="2"/>
    <circle cx="92" cy="92" r="64" fill="url(#accent)" fill-opacity="0.18"/>
    <text x="92" y="112" text-anchor="middle" font-family="Inter, Arial, system-ui, sans-serif" font-size="54" font-weight="800" fill="#ffffff">${escapeSvg(initials)}</text>
  </g>
  <g transform="translate(80 342)">
    ${textBlock({
      lines: titleLines,
      x: 0,
      y: 0,
      fontSize: titleLines.length > 1 ? 66 : 78,
      lineHeight: titleLines.length > 1 ? 76 : 88,
      weight: 800,
      fill: "#f8fafc",
    })}
    ${textBlock({
      lines: descriptionLines,
      x: 2,
      y: titleLines.length > 1 ? 174 : 116,
      fontSize: 29,
      lineHeight: 40,
      weight: 500,
      fill: "#94a3b8",
    })}
    <g transform="translate(0 ${titleLines.length > 1 ? 250 : 192})">
      <rect x="0" y="-34" width="${Math.max(246, duration.length * 17 + 54)}" height="58" rx="29" fill="#ffffff" fill-opacity="0.09" stroke="#ffffff" stroke-opacity="0.16"/>
      <circle cx="31" cy="-5" r="8" fill="#7cffc4"/>
      <text x="54" y="4" font-family="Inter, Arial, system-ui, sans-serif" font-size="27" font-weight="700" fill="#ffffff">${escapeSvg(duration)}</text>
    </g>
  </g>
</svg>`;
}

export function renderBookingOgImagePng(
  input: BookingOgImageInput,
): Uint8Array {
  return new Resvg(renderBookingOgImageSvg(input), {
    fitTo: { mode: "width", value: WIDTH },
    font: { loadSystemFonts: true },
  })
    .render()
    .asPng();
}
