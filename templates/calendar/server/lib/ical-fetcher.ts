import type { CalendarEvent } from "../../shared/api.js";
import { nanoid } from "nanoid";

/** Convert a webcal:// URL to https:// */
function normalizeUrl(url: string): string {
  return url.replace(/^webcal:\/\//i, "https://");
}

/** Unfold ICS lines (continuation lines start with a space or tab) */
function unfoldLines(raw: string): string[] {
  // Normalize CRLF and CR to LF
  const normalized = raw.replace(/\r\n?/g, "\n");
  const lines: string[] = [];
  for (const line of normalized.split("\n")) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

/** Unescape ICS text values (\n → newline, \, → comma, \; → semicolon, \\ → backslash) */
function unescapeValue(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

interface ICSProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Parse a single ICS property line like "DTSTART;TZID=America/New_York:20250401T090000" */
function parseLine(line: string): ICSProperty | null {
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return null;
  const namePart = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);

  const segments = namePart.split(";");
  const name = segments[0].toUpperCase();
  const params: Record<string, string> = {};
  for (let i = 1; i < segments.length; i++) {
    const eqIdx = segments[i].indexOf("=");
    if (eqIdx !== -1) {
      params[segments[i].slice(0, eqIdx).toUpperCase()] = segments[i].slice(
        eqIdx + 1,
      );
    }
  }
  return { name, params, value };
}

/**
 * Parse an ICS date/datetime string into an ISO 8601 string.
 * Returns { iso: string, allDay: boolean }
 */
function parseICSDate(
  value: string,
  params: Record<string, string>,
): { iso: string; allDay: boolean } {
  const isDateOnly = params["VALUE"] === "DATE" || /^\d{8}$/.test(value.trim());

  if (isDateOnly) {
    // YYYYMMDD → YYYY-MM-DD
    const v = value.trim();
    const iso = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
    return { iso, allDay: true };
  }

  // YYYYMMDDTHHmmss[Z]
  const v = value.trim().replace("Z", "");
  const year = v.slice(0, 4);
  const month = v.slice(4, 6);
  const day = v.slice(6, 8);
  const hour = v.slice(9, 11);
  const min = v.slice(11, 13);
  const sec = v.slice(13, 15) || "00";

  if (value.trim().endsWith("Z")) {
    // UTC time
    return {
      iso: `${year}-${month}-${day}T${hour}:${min}:${sec}Z`,
      allDay: false,
    };
  }

  // Floating time or TZID — treat as local ISO string
  return {
    iso: `${year}-${month}-${day}T${hour}:${min}:${sec}`,
    allDay: false,
  };
}

interface RawEvent {
  uid: string;
  summary: string;
  description: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  status?: string;
}

/** Extract X-WR-CALNAME from the VCALENDAR block */
function parseCalendarName(lines: string[]): string | null {
  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) break;
    const prop = parseLine(line);
    if (prop?.name === "X-WR-CALNAME" && prop.value.trim()) {
      return unescapeValue(prop.value.trim());
    }
  }
  return null;
}

/** Parse all VEVENTs from unfolded ICS lines */
function parseEvents(lines: string[]): RawEvent[] {
  const events: RawEvent[] = [];
  let inEvent = false;
  let current: Partial<RawEvent> = {};

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      current = {};
      continue;
    }
    if (line === "END:VEVENT") {
      inEvent = false;
      if (current.uid && current.start && current.end) {
        events.push(current as RawEvent);
      }
      continue;
    }
    if (!inEvent) continue;

    const prop = parseLine(line);
    if (!prop) continue;

    switch (prop.name) {
      case "UID":
        current.uid = prop.value;
        break;
      case "SUMMARY":
        current.summary = unescapeValue(prop.value);
        break;
      case "DESCRIPTION":
        current.description = unescapeValue(prop.value);
        break;
      case "LOCATION":
        current.location = unescapeValue(prop.value);
        break;
      case "STATUS":
        current.status = prop.value;
        break;
      case "DTSTART": {
        const { iso, allDay } = parseICSDate(prop.value, prop.params);
        current.start = iso;
        current.allDay = allDay;
        break;
      }
      case "DTEND":
      case "DUE": {
        const { iso } = parseICSDate(prop.value, prop.params);
        current.end = iso;
        break;
      }
      case "DURATION": {
        // Handle simple durations like P1D, PT1H (only set if no DTEND yet)
        if (!current.end && current.start) {
          current.end = current.start; // fallback — duration parsing omitted
        }
        break;
      }
    }
  }

  return events;
}

export interface ICalFeedEvent {
  event: CalendarEvent;
  feedId: string;
  feedName: string;
  color: string;
}

/** Derive a display name from a URL (hostname + first path segment). */
function nameFromUrl(url: string): string {
  try {
    const u = new URL(url.replace(/^webcal:/i, "https:"));
    const parts = u.hostname.replace(/^www\./, "").split(".");
    return parts[0].charAt(0).toUpperCase() + parts[0].slice(1) + " Calendar";
  } catch {
    return "External Calendar";
  }
}

/**
 * Fetch an ICS feed and return its display name (X-WR-CALNAME or hostname fallback).
 */
export async function fetchICalName(url: string): Promise<string> {
  const httpUrl = normalizeUrl(url);
  try {
    const response = await fetch(httpUrl, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "CalendarApp/1.0" },
    });
    if (!response.ok) return nameFromUrl(url);
    const icsText = await response.text();
    const lines = unfoldLines(icsText);
    return parseCalendarName(lines) ?? nameFromUrl(url);
  } catch {
    return nameFromUrl(url);
  }
}

/**
 * Fetch an ICS feed URL and return parsed CalendarEvents within the given date range.
 * Returns an empty array on any error (gracefully degraded).
 */
export async function fetchICalEvents(
  feedId: string,
  feedName: string,
  url: string,
  color: string,
  from: string,
  to: string,
): Promise<CalendarEvent[]> {
  const httpUrl = normalizeUrl(url);

  let icsText: string;
  try {
    const response = await fetch(httpUrl, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "CalendarApp/1.0" },
    });
    if (!response.ok) return [];
    icsText = await response.text();
  } catch {
    return [];
  }

  const lines = unfoldLines(icsText);
  const rawEvents = parseEvents(lines);

  const fromTs = new Date(from).getTime();
  const toTs = new Date(to).getTime();

  const now = new Date().toISOString();

  return rawEvents
    .filter((e) => {
      const endTs = new Date(e.end).getTime();
      const startTs = new Date(e.start).getTime();
      return endTs >= fromTs && startTs <= toTs;
    })
    .map((e) => ({
      id: `ical-${feedId}-${e.uid}`,
      title: e.summary || "(No title)",
      description: e.description || "",
      start: e.start,
      end: e.end,
      location: e.location || "",
      allDay: e.allDay,
      source: "ical" as const,
      color,
      createdAt: now,
      updatedAt: now,
    }));
}
