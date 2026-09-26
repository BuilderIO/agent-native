import type { CalendarEvent, OverlayPerson } from "@shared/api";
export {
  GOOGLE_EVENT_COLOR_OPTIONS,
  getGoogleEventColorHex,
} from "@shared/google-event-colors";
import type {
  CalendarColorMode,
  CalendarColorSourceKey,
} from "./calendar-view-preferences";
import { isPersonCalendarId } from "./person-calendar";


export const EVENT_CATEGORY_COLORS = {
  focus: "#7C9C6B", // sage — self-holds, focus time
  internal1on1: "#5B9BD5", // steel blue — internal 1:1
  internalGroup: "#B07CC6", // amethyst — internal group
  external1on1: "#D4A053", // amber — external 1:1
  externalGroup: "#CD6B6B", // coral — external group
  allDay: "#8B8FA3", // slate — all-day, OOO
  fallback: "#5B9BD5", // steel blue
} as const;

export type EventCategory = keyof typeof EVENT_CATEGORY_COLORS;

export interface CalendarColorPreferences {
  /** @deprecated legacy global fallback, used only when no per-account entry exists */
  colorMode?: CalendarColorMode;
  /** @deprecated legacy global fallback, used only when no per-account entry exists */
  singleColor?: string;
  accountColorModes?: Record<CalendarColorSourceKey, CalendarColorMode>;
  accountColors?: Record<CalendarColorSourceKey, string>;
  googleCalendarColors?: Record<string, string>;
}

export function applyOverlayOwnerMarkers(
  events: CalendarEvent[],
  people: OverlayPerson[],
): CalendarEvent[] {
  const ownersByEmail = new Map(
    people.map((person) => [person.email.trim().toLowerCase(), person]),
  );

  return events.map((event) => {
    const ownerEmail =
      event.overlayEmail ??
      (event.source === "google" &&
      event.calendarPrimary === false &&
      event.calendarId &&
      isPersonCalendarId(event.calendarId)
        ? event.calendarId
        : undefined);
    const owner = ownerEmail
      ? ownersByEmail.get(ownerEmail.trim().toLowerCase())
      : undefined;
    return owner
      ? { ...event, ownerColor: owner.color, ownerName: owner.name }
      : event;
  });
}


const FREE_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
]);

function getDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}


export function classifyEvent(event: CalendarEvent): EventCategory {
  if (event.allDay) return "allDay";

  const attendees = event.attendees;

  if (!attendees || attendees.length === 0) return "focus";

  const others = attendees.filter((a) => !a.self);

  if (others.length === 0) return "focus";

  const selfAttendee = attendees.find((a) => a.self);
  const userEmail = event.accountEmail || selfAttendee?.email || "";
  const userDomain = getDomain(userEmail);

  if (!userDomain || FREE_DOMAINS.has(userDomain)) {
    return others.length === 1 ? "internal1on1" : "internalGroup";
  }

  const allInternal = others.every((a) => getDomain(a.email) === userDomain);
  const anyInternal = others.some((a) => getDomain(a.email) === userDomain);

  if (others.length === 1) {
    return allInternal ? "internal1on1" : "external1on1";
  }

  if (allInternal) return "internalGroup";
  if (!anyInternal) return "externalGroup";
  return "externalGroup";
}


export function allOtherDeclined(event: CalendarEvent): boolean {
  const attendees = event.attendees;
  if (!attendees || attendees.length < 2) return false;
  if (event.responseStatus === "declined") return false;
  const others = attendees.filter((a) => !a.self);
  if (others.length === 0) return false;
  return others.every((a) => a.responseStatus === "declined");
}


export function getEventAutoColor(event: CalendarEvent): string {
  if (event.color) return event.color;
  if (event.calendarColor) return event.calendarColor;

  if (event.source !== "google") return "hsl(var(--primary))";

  const category = classifyEvent(event);
  return EVENT_CATEGORY_COLORS[category];
}

export function getEventDisplayColor(
  event: CalendarEvent,
  preferences?: CalendarColorPreferences,
): string {
  if (event.ownerColor) return event.ownerColor;

  if (event.source === "google" && !event.overlayEmail && preferences) {
    const sourceColor = event.canonicalKey
      ? preferences.googleCalendarColors?.[event.canonicalKey]
      : undefined;
    if (sourceColor) return sourceColor;

    const accountKey = event.accountEmail;
    const accountMode = accountKey
      ? preferences.accountColorModes?.[accountKey]
      : undefined;
    const accountColor = accountKey
      ? preferences.accountColors?.[accountKey]
      : undefined;

    const colorMode = accountMode ?? preferences.colorMode;
    if (colorMode === "multi") {
      return EVENT_CATEGORY_COLORS[classifyEvent(event)];
    }

    if (accountMode === "single" && accountColor) return accountColor;
    if (
      !accountMode &&
      preferences.colorMode === "single" &&
      preferences.singleColor
    ) {
      return accountColor ?? preferences.singleColor;
    }
  }
  return getEventAutoColor(event);
}
