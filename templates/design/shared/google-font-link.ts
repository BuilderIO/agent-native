import {
  googleFontStylesheetUrl,
  resolveGoogleFont,
} from "@agent-native/toolkit/design-tweaks/google-fonts";

/**
 * String-based twin of the editor's `ensureGoogleFontLinkInHtml`
 * (`app/pages/design-editor/code-layer-state.ts`), which needs `DOMParser` and
 * so cannot run in an action. `google-font-link.parity.spec.ts` keeps the two
 * producing the same links; change them together.
 */

export type GoogleFontLinkStatus = "added" | "already-linked" | "unlisted";

export interface GoogleFontLinkResult {
  html: string;
  status: GoogleFontLinkStatus;
  /** The built-in-list family the value resolved to; set unless `unlisted`. */
  family?: string;
}

const GOOGLE_STYLESHEET_HOST = "fonts.googleapis.com";
const PRECONNECT_STYLESHEET_ORIGIN = "https://fonts.googleapis.com";
const PRECONNECT_FILE_ORIGIN = "https://fonts.gstatic.com";

const LATO_MEDIUM_FACE_URL =
  "https://raw.githubusercontent.com/google/fonts/809e4d8b8d7e9364a914909bb777679606c178b8/ofl/lato/Lato-Medium.ttf";
const LATO_PINNED_FACE_MARKER = "Lato-500";
const LATO_PINNED_FACE_STYLE = `<style data-agent-native-font-face="${LATO_PINNED_FACE_MARKER}">/* Lato Medium; Copyright (c) 2011-2015 tyPoland, Lukasz Dziedzic; SIL Open Font License 1.1. */
@font-face {
  font-family: 'Lato';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('${LATO_MEDIUM_FACE_URL}') format('truetype');
}</style>`;

export function primaryFontFamilyName(value: string): string {
  const first = value.split(",")[0]?.trim() ?? "";
  if (
    (first.startsWith('"') && first.endsWith('"')) ||
    (first.startsWith("'") && first.endsWith("'"))
  ) {
    return first.slice(1, -1).trim();
  }
  return first;
}

// Same-length blanking keeps indexes aligned with the original, so scans never
// see markup that sits inside a comment or a script/style/textarea body.
const INERT_MARKUP =
  /<!--[\s\S]*?(?:-->|$)|(<(script|style|textarea)\b(?:"[^"]*"|'[^']*'|[^>"'])*>)([\s\S]*?)(<\/\2\s*>|$)/gi;

function maskInertMarkup(html: string): string {
  return html.replace(
    INERT_MARKUP,
    (match, open?: string, _tag?: string, body?: string, close?: string) =>
      open === undefined
        ? " ".repeat(match.length)
        : `${open}${" ".repeat(body?.length ?? 0)}${close ?? ""}`,
  );
}

const TAG_ATTRIBUTES = `(?:"[^"]*"|'[^']*'|[^>"'])*`;
const HEAD_OPEN = new RegExp(`<head(?=[\\s/>])${TAG_ATTRIBUTES}>`, "i");
const HEAD_CLOSE = /<\/head\s*>/i;
const BODY_OPEN = /<body(?=[\s/>])/i;
const HTML_OPEN = new RegExp(`<html(?=[\\s/>])${TAG_ATTRIBUTES}>`, "i");
const DOCTYPE = /^\s*<!doctype[^>]*>/i;
const LINK_TAG = new RegExp(`<link(?=[\\s/>])${TAG_ATTRIBUTES}>`, "gi");

function attributeValue(tag: string, name: string): string | null {
  const match = new RegExp(
    `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ).exec(tag);
  if (!match) return null;
  return (match[1] || match[2] || match[3] || "").replace(/&amp;/g, "&");
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function linkAttributesIn(
  html: string,
  masked: string,
  from: number,
  to: number,
): Array<{ rel: string | null; href: string | null }> {
  const links: Array<{ rel: string | null; href: string | null }> = [];
  for (const match of masked.slice(from, to).matchAll(LINK_TAG)) {
    const start = from + match.index;
    const tag = html.slice(start, start + match[0].length);
    links.push({
      rel: attributeValue(tag, "rel"),
      href: attributeValue(tag, "href"),
    });
  }
  return links;
}

function loadsFamily(href: string, family: string, fontHref: string): boolean {
  let normalized = href;
  try {
    normalized = decodeURIComponent(href);
  } catch {
    // coercion-ok: a malformed legacy URL is matched raw, which only risks a duplicate link.
  }
  normalized = normalized.replace(/\+/g, " ").toLowerCase();
  const key = family.toLowerCase();
  return (
    href === fontHref ||
    normalized.includes(`family=${key}:`) ||
    normalized.includes(`family=${key}&`)
  );
}

function insertTags(
  html: string,
  masked: string,
  head: { start: number; end: number },
  tags: string[],
): string {
  if (head.end >= 0) {
    const lineStart = masked.lastIndexOf("\n", head.end - 1) + 1;
    const leading = masked.slice(lineStart, head.end);
    if (/^[ \t]*$/.test(leading)) {
      const indent = `${leading}  `;
      return `${html.slice(0, lineStart)}${tags
        .map((tag) => `${indent}${tag}\n`)
        .join("")}${html.slice(lineStart)}`;
    }
    return `${html.slice(0, head.end)}${tags.join("")}${html.slice(head.end)}`;
  }
  if (head.start >= 0) {
    return `${html.slice(0, head.start)}${tags.join("")}${html.slice(head.start)}`;
  }
  const headBlock = `<head>${tags.join("")}</head>`;
  const htmlOpen = HTML_OPEN.exec(masked);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return `${html.slice(0, at)}${headBlock}${html.slice(at)}`;
  }
  const at = DOCTYPE.exec(masked)?.[0].length ?? 0;
  return `${html.slice(0, at)}${tags.join("")}${html.slice(at)}`;
}

/**
 * Adds the Google Fonts `<link>` for the primary family of a `font-family`
 * value, plus the `preconnect` hints and Lato's pinned 500 face the editor
 * adds. Idempotent. Like the editor it consults only the toolkit's built-in
 * font list: `unlisted` means the family is not in that list (a system or
 * generic family, or a Google family the list lacks), and the HTML comes back
 * unchanged.
 */
export function ensureGoogleFontLinkInHtmlString(
  html: string,
  fontFamilyValue: string,
): GoogleFontLinkResult {
  const font = resolveGoogleFont(primaryFontFamilyName(fontFamilyValue));
  const fontHref = font && googleFontStylesheetUrl(font);
  if (!font || !fontHref) return { html, status: "unlisted" };

  const masked = maskInertMarkup(html);
  const headOpen = HEAD_OPEN.exec(masked);
  const headStart = headOpen ? headOpen.index + headOpen[0].length : -1;
  const closeOffset =
    headStart >= 0 ? masked.slice(headStart).search(HEAD_CLOSE) : -1;
  const head = {
    start: headStart,
    end: closeOffset >= 0 ? headStart + closeOffset : -1,
  };
  const bodyIndex = masked.search(BODY_OPEN);
  const scanFrom = Math.max(head.start, 0);
  const scanTo =
    head.end >= 0
      ? head.end
      : bodyIndex >= scanFrom
        ? bodyIndex
        : masked.length;
  const links = linkAttributesIn(html, masked, scanFrom, scanTo);

  const alreadyLoaded = links.some(
    (link) =>
      link.href !== null &&
      link.href.includes(GOOGLE_STYLESHEET_HOST) &&
      loadsFamily(link.href, font.family, fontHref),
  );
  const hasPreconnect = (origin: string) =>
    links.some((link) => link.rel === "preconnect" && link.href === origin);

  const tags: string[] = [];
  if (
    font.family === "Lato" &&
    !new RegExp(
      `<style(?=[\\s/>])[^>]*\\sdata-agent-native-font-face\\s*=\\s*["']?${LATO_PINNED_FACE_MARKER}["']?`,
      "i",
    ).test(masked.slice(scanFrom, scanTo))
  ) {
    tags.push(LATO_PINNED_FACE_STYLE);
  }
  if (!alreadyLoaded) {
    if (!hasPreconnect(PRECONNECT_STYLESHEET_ORIGIN)) {
      tags.push(
        `<link rel="preconnect" href="${PRECONNECT_STYLESHEET_ORIGIN}">`,
      );
    }
    if (!hasPreconnect(PRECONNECT_FILE_ORIGIN)) {
      tags.push(
        `<link rel="preconnect" href="${PRECONNECT_FILE_ORIGIN}" crossorigin>`,
      );
    }
    tags.push(`<link rel="stylesheet" href="${escapeAttribute(fontHref)}">`);
  }
  if (tags.length === 0) {
    return { html, status: "already-linked", family: font.family };
  }
  return {
    html: insertTags(html, masked, head, tags),
    status: "added",
    family: font.family,
  };
}
