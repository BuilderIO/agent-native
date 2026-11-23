import type { ReactNode } from "react";

import { appLocale } from "@/i18n/locale";
import { searchResultDateMessages as messages } from "@/i18n/messages/search-result-dates";
import { getCachedDateTimeFormat } from "@/lib/intl-cache";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Match tokens are whitespace-separated; only the first few are highlighted. */
const MAX_HIGHLIGHT_TOKENS = 6;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function foldSearchChar(char: string): string {
  return char
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function foldSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function foldTextWithMap(text: string): {
  folded: string;
  starts: number[];
  ends: number[];
} {
  let folded = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let index = 0;
  for (const char of text) {
    const nextIndex = index + char.length;
    const piece = foldSearchChar(char);
    for (let i = 0; i < piece.length; i += 1) {
      folded += piece[i];
      starts.push(index);
      ends.push(nextIndex);
    }
    index = nextIndex;
  }
  return { folded, starts, ends };
}

/**
 * Wraps every query token found in `text` in a <mark>. Returns the plain string
 * when the query is empty, so non-search titles are untouched.
 */
export function highlightQuery(text: string, query: string): ReactNode {
  const rawTokens = query
    .trim()
    .split(/\s+/)
    .map(foldSearchText)
    .filter(Boolean)
    .slice(0, MAX_HIGHLIGHT_TOKENS);
  if (rawTokens.length === 0) return text;

  const tokens = Array.from(new Set(rawTokens)).sort(
    (a, b) => b.length - a.length,
  );
  const { folded, starts, ends } = foldTextWithMap(text);
  const pattern = new RegExp(tokens.map(escapeRegExp).join("|"), "g");
  const matches = Array.from(folded.matchAll(pattern));
  if (matches.length === 0) return text;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const [i, match] of matches.entries()) {
    const matchIndex = match.index;
    const matchLength = match[0].length;
    if (matchLength === 0) continue;
    const origStart = starts[matchIndex];
    const origEnd = ends[matchIndex + matchLength - 1];
    if (
      origStart === undefined ||
      origEnd === undefined ||
      origStart < cursor
    ) {
      continue;
    }
    if (origStart > cursor) {
      nodes.push(text.slice(cursor, origStart));
    }
    const segment = text.slice(origStart, origEnd);
    nodes.push(
      <mark className="ws-search-mark" key={`${segment}-${origStart}-${i}`}>
        {segment}
      </mark>,
    );
    cursor = origEnd;
  }
  if (nodes.length === 0) return text;
  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }
  return nodes;
}

function formatter(): Intl.DateTimeFormat {
  // The app renders in its own locale (app/i18n/locale.ts pins en-US); a formatter
  // that follows the browser's locale would print the same list in two languages.
  return getCachedDateTimeFormat(appLocale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Recent results read as elapsed time; older ones as an absolute date. An
 * unparseable timestamp renders nothing instead of a stand-in date.
 */
export function formatResultDate(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";

  const elapsed = Date.now() - time;
  const absolute = Math.abs(elapsed);
  if (absolute >= 7 * DAY_MS) return formatter().format(time);

  const seconds = Math.round(absolute / 1000);
  const minutes = Math.round(absolute / 60_000);
  const hours = Math.round(absolute / HOUR_MS);
  const days = Math.round(absolute / DAY_MS);
  const label =
    seconds <= 1
      ? messages.second
      : seconds < 45
        ? messages.seconds.replace("{{count}}", String(seconds))
        : minutes <= 1
          ? messages.minute
          : minutes < 45
            ? messages.minutes.replace("{{count}}", String(minutes))
            : hours <= 1
              ? messages.hour
              : hours < 22
                ? messages.hours.replace("{{count}}", String(hours))
                : days <= 1
                  ? messages.day
                  : messages.days.replace("{{count}}", String(days));
  return (elapsed >= 0 ? messages.past : messages.future).replace(
    "{{value}}",
    label,
  );
}

export const SEARCH_FIELD_LABELS: Record<
  "title" | "description" | "cellContents",
  string
> = {
  title: "Title",
  description: "Description",
  cellContents: "Cell contents",
};

export const SEARCH_DATE_LABELS: Record<"24h" | "7d" | "30d" | "90d", string> =
  {
    "24h": "Past 24 hours",
    "7d": "Past 7 days",
    "30d": "Past 30 days",
    "90d": "Past 90 days",
  };

/** Only same-app paths are navigable workspace results. */
export function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}
