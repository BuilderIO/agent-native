/**
 * A blocked CDN request leaves a screen rendering as unstyled default HTML with
 * nothing in its own markup to explain it. Rewriting at render time rather than
 * at generation time also repairs every design already stored.
 *
 * Export keeps the CDN on purpose: a downloaded file runs outside this app.
 */

import tailwindRuntimeUrl from "@tailwindcss/browser?url";
import alpineRuntimeUrl from "alpinejs/dist/cdn.min.js?url";
import { parse } from "parse5";

/**
 * Only the major version this app vendors may be substituted. Swapping v3's Play
 * CDN for the v4 runtime looks equivalent and is not: v4 resolves spacing and
 * radius through theme variables a v3 document never defines, so `px-8` computes
 * to 0 and `rounded-full` to garbage.
 */
function substitutable(src: string, pinned: RegExp, vendored: RegExp): boolean {
  const version = pinned.exec(src);
  return !version || vendored.test(version[1] ?? "");
}

function tailwindReplacement(src: string): boolean {
  if (!/tailwindcss\/browser/i.test(src)) return false;
  return substitutable(src, /@tailwindcss\/browser@(\d+)/i, /^4$/);
}

/**
 * Core Alpine only. `@alpinejs/persist`, `/focus`, `/mask` and friends all carry
 * "alpinejs" in their URL, and swapping one for the core bundle drops the plugin
 * entirely while loading Alpine a second time.
 */
function alpineReplacement(src: string): boolean {
  if (/@alpinejs\//i.test(src)) return false;
  if (!/(^|[/@])alpinejs(@|\/|$)/i.test(src)) return false;
  return substitutable(src, /alpinejs@(\d+)/i, /^3$/);
}

/**
 * Absolute, because a srcdoc document resolves relative URLs against the parent
 * document rather than against the app root it was composed for.
 */
function absolute(url: string): string {
  if (/^[a-z]+:\/\//i.test(url)) return url;
  if (typeof window === "undefined") return url;
  return new URL(url, window.location.origin).href;
}

export function localRuntimeUrls(): { tailwind: string; alpine: string } {
  return {
    tailwind: absolute(tailwindRuntimeUrl),
    alpine: absolute(alpineRuntimeUrl),
  };
}

interface SrcSpan {
  start: number;
  end: number;
  replacement: string;
}

/**
 * Spans come from the parser, never from a source-wide regex: a runtime URL
 * written inside a `<script>` body, an HTML comment, or another element's
 * attribute is user content, and rewriting it makes the preview diverge from
 * the stored and exported document.
 */
function runtimeSrcSpans(
  html: string,
  urls: { tailwind: string; alpine: string },
): SrcSpan[] {
  const spans: SrcSpan[] = [];

  const visit = (node: unknown) => {
    const element = node as {
      tagName?: string;
      attrs?: Array<{ name: string; value: string }>;
      childNodes?: unknown[];
      content?: { childNodes?: unknown[] };
      sourceCodeLocation?: {
        attrs?: Record<string, { startOffset: number; endOffset: number }>;
      } | null;
    };
    if (element.tagName === "script") {
      const src = element.attrs?.find((attr) => attr.name === "src")?.value;
      const at = element.sourceCodeLocation?.attrs?.src;
      if (src && at) {
        const replacement = tailwindReplacement(src)
          ? urls.tailwind
          : alpineReplacement(src)
            ? urls.alpine
            : null;
        if (replacement) {
          spans.push({ start: at.startOffset, end: at.endOffset, replacement });
        }
      }
    }
    for (const child of [
      ...(element.childNodes ?? []),
      ...(element.content?.childNodes ?? []),
    ]) {
      visit(child);
    }
  };
  visit(parse(html, { sourceCodeLocationInfo: true }));

  return spans.sort((left, right) => left.start - right.start);
}

export function withLocalRuntimes(
  html: string,
  urls: { tailwind: string; alpine: string } = localRuntimeUrls(),
): string {
  if (!html || !/<script/i.test(html)) return html;
  const spans = runtimeSrcSpans(html, urls);
  if (spans.length === 0) return html;

  let out = "";
  let cursor = 0;
  for (const span of spans) {
    out += `${html.slice(cursor, span.start)}src="${span.replacement}"`;
    cursor = span.end;
  }
  return out + html.slice(cursor);
}
