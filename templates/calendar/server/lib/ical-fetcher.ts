import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { isBlockedToolUrl } from "@agent-native/core/tools/url-safety";

import type { CalendarEvent } from "../../shared/api.js";

function normalizeUrl(url: string): string {
  return url.replace(/^webcal:\/\//i, "https://");
}

/**
 * Reject iCal URLs that point at private/internal addresses or non-https
 * schemes. The URL flows in from user input (the `add-external-calendar`
 * action) so without this guard a malicious URL like
 * `http://169.254.169.254/latest/meta-data/iam/security-credentials/` would
 * cause the production server to fetch AWS IAM creds and (for
 * fetchICalEvents) return them through the action response.
 */
function assertSafeICalUrl(httpUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(httpUrl);
  } catch {
    throw new Error("Invalid iCal URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Only https iCal URLs are allowed");
  }
  if (isBlockedToolUrl(httpUrl)) {
    throw new Error("This iCal URL is not allowed");
  }
}

function unfoldLines(raw: string): string[] {
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

function parseICSDate(
  value: string,
  params: Record<string, string>,
): { iso: string; allDay: boolean } {
  const isDateOnly = params["VALUE"] === "DATE" || /^\d{8}$/.test(value.trim());

  if (isDateOnly) {
    const v = value.trim();
    const iso = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
    return { iso, allDay: true };
  }

  const v = value.trim().replace("Z", "");
  const year = v.slice(0, 4);
  const month = v.slice(4, 6);
  const day = v.slice(6, 8);
  const hour = v.slice(9, 11);
  const min = v.slice(11, 13);
  const sec = v.slice(13, 15) || "00";

  if (value.trim().endsWith("Z")) {
    return {
      iso: `${year}-${month}-${day}T${hour}:${min}:${sec}Z`,
      allDay: false,
    };
  }

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
        if (!current.end && current.start) {
          current.end = current.start;
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

function nameFromUrl(url: string): string {
  try {
    const u = new URL(url.replace(/^webcal:/i, "https:"));
    const parts = u.hostname.replace(/^www\./, "").split(".");
    return parts[0].charAt(0).toUpperCase() + parts[0].slice(1) + " Calendar";
  } catch {
    return "External Calendar";
  }
}

export async function fetchICalName(url: string): Promise<string> {
  const httpUrl = normalizeUrl(url);
  try {
    assertSafeICalUrl(httpUrl);
  } catch {
    return nameFromUrl(url);
  }
  try {
    const response = await ssrfSafeFetch(
      httpUrl,
      {
        signal: AbortSignal.timeout(10_000),
        headers: { "User-Agent": "CalendarApp/1.0" },
      },
      { maxRedirects: 3 },
    );
    if (!response.ok) return nameFromUrl(url);
    const icsText = await response.text();
    const lines = unfoldLines(icsText);
    return parseCalendarName(lines) ?? nameFromUrl(url);
  } catch {
    return nameFromUrl(url);
  }
}

export async function fetchICalEvents(
  feedId: string,
  feedName: string,
  url: string,
  color: string,
  from: string,
  to: string,
  options: { throwOnError?: boolean } = {},
): Promise<CalendarEvent[]> {
  const httpUrl = normalizeUrl(url);

  try {
    assertSafeICalUrl(httpUrl);
  } catch {
    if (options.throwOnError) throw new Error("ICS feed URL is not allowed");
    return [];
  }

  let icsText: string;
  try {
    const response = await ssrfSafeFetch(
      httpUrl,
      {
        signal: AbortSignal.timeout(10_000),
        headers: { "User-Agent": "CalendarApp/1.0" },
      },
      { maxRedirects: 3 },
    );
    if (!response.ok) {
      if (options.throwOnError) throw new Error("ICS feed request failed");
      return [];
    }
    icsText = await response.text();
  } catch (error) {
    if (options.throwOnError) {
      throw error instanceof Error
        ? error
        : new Error("ICS feed request failed");
    }
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
      titleIsGenerated: !e.summary,
      description: e.description || "",
      start: e.start,
      end: e.end,
      location: e.location || "",
      allDay: e.allDay,
      source: "ical" as const,
      sourceId: feedId,
      color,
      createdAt: now,
      updatedAt: now,
    }));
}
