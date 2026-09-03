import type {
  CalendarEvent,
  GoogleAuthStatus,
  GoogleCalendarSource,
} from "@shared/api";
import { CALENDAR_COLORS } from "@shared/calendar-view-preferences";

export function isSharedCalendarDemo(): boolean {
  return (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("calendarDemo") === "shared"
  );
}

export const SHARED_CALENDAR_DEMO_STATUS: GoogleAuthStatus = {
  connected: true,
  configured: true,
  accounts: [
    { email: "alice@builder.io" },
    { email: "emdistal@gmail.com" },
    { email: "tempoimmaterial@gmail.com" },
  ],
};

export const SHARED_CALENDAR_DEMO_SOURCES: GoogleCalendarSource[] = [
  {
    sourceKey: "demo:builder-primary",
    canonicalKey: "demo:builder-primary",
    accountEmail: "alice@builder.io",
    calendarId: "alice@builder.io",
    name: "Alice · Builder",
    color: CALENDAR_COLORS[1],
    selected: true,
    primary: true,
    accessRole: "owner",
    readOnly: false,
  },
  {
    sourceKey: "demo:personal-primary",
    canonicalKey: "demo:personal-primary",
    accountEmail: "emdistal@gmail.com",
    calendarId: "emdistal@gmail.com",
    name: "Alice Alexandra",
    color: CALENDAR_COLORS[2],
    selected: true,
    primary: true,
    accessRole: "owner",
    readOnly: false,
  },
  {
    sourceKey: "demo:friends",
    canonicalKey: "demo:friends",
    accountEmail: "emdistal@gmail.com",
    calendarId: "friends@example.com",
    name: "Friends",
    color: CALENDAR_COLORS[3],
    selected: true,
    primary: false,
    accessRole: "reader",
    readOnly: true,
  },
  {
    sourceKey: "demo:tempo-primary",
    canonicalKey: "demo:tempo-primary",
    accountEmail: "tempoimmaterial@gmail.com",
    calendarId: "tempoimmaterial@gmail.com",
    name: "Tempo Immaterial",
    color: CALENDAR_COLORS[5],
    selected: true,
    primary: true,
    accessRole: "owner",
    readOnly: false,
  },
  {
    sourceKey: "demo:studio",
    canonicalKey: "demo:studio",
    accountEmail: "tempoimmaterial@gmail.com",
    calendarId: "studio@example.com",
    name: "Studio schedule",
    color: CALENDAR_COLORS[4],
    selected: false,
    primary: false,
    accessRole: "reader",
    readOnly: true,
  },
];

const now = "2026-09-01T12:00:00.000Z";

export const SHARED_CALENDAR_DEMO_EVENTS: CalendarEvent[] = [
  demoEvent({
    id: "google-builder-enablement",
    title: "GTM Enablement",
    start: "2026-09-02T12:00:00-04:00",
    end: "2026-09-02T13:00:00-04:00",
    accountEmail: "alice@builder.io",
    calendarId: "alice@builder.io",
    calendarName: "Alice · Builder",
    color: CALENDAR_COLORS[1],
  }),
  demoEvent({
    id: "google-personal-dermatology",
    title: "dermatology appt",
    start: "2026-09-01T15:20:00-04:00",
    end: "2026-09-01T16:20:00-04:00",
    accountEmail: "emdistal@gmail.com",
    calendarId: "emdistal@gmail.com",
    calendarName: "Alice Alexandra",
    color: CALENDAR_COLORS[2],
  }),
  demoEvent({
    id: "google-friends-cottage",
    title: "Magpie Cottage Sale",
    start: "2026-09-05T10:00:00-04:00",
    end: "2026-09-05T16:00:00-04:00",
    accountEmail: "emdistal@gmail.com",
    calendarId: "friends@example.com",
    calendarName: "Friends",
    calendarAccessRole: "reader",
    calendarReadOnly: true,
    color: CALENDAR_COLORS[3],
  }),
  demoEvent({
    id: "google-friends-birthday",
    title: "Matt’s 33⅓ Birthday",
    start: "2026-09-04T18:00:00-04:00",
    end: "2026-09-04T19:00:00-04:00",
    accountEmail: "emdistal@gmail.com",
    calendarId: "friends@example.com",
    calendarName: "Friends",
    calendarAccessRole: "reader",
    calendarReadOnly: true,
    color: CALENDAR_COLORS[3],
  }),
  demoEvent({
    id: "google-personal-dinner",
    title: "dinner with sarah",
    start: "2026-09-03T17:30:00-04:00",
    end: "2026-09-03T20:00:00-04:00",
    accountEmail: "emdistal@gmail.com",
    calendarId: "emdistal@gmail.com",
    calendarName: "Alice Alexandra",
    color: CALENDAR_COLORS[2],
  }),
  demoEvent({
    id: "google-tempo-studio",
    title: "Open studio",
    start: "2026-09-03T14:00:00-04:00",
    end: "2026-09-03T16:00:00-04:00",
    accountEmail: "tempoimmaterial@gmail.com",
    calendarId: "studio@example.com",
    calendarName: "Studio schedule",
    calendarAccessRole: "reader",
    calendarReadOnly: true,
    color: CALENDAR_COLORS[4],
  }),
];

function demoEvent(
  event: Pick<
    CalendarEvent,
    | "id"
    | "title"
    | "start"
    | "end"
    | "accountEmail"
    | "calendarId"
    | "calendarName"
    | "calendarAccessRole"
    | "calendarReadOnly"
    | "color"
  >,
): CalendarEvent {
  const source = SHARED_CALENDAR_DEMO_SOURCES.find(
    (candidate) =>
      candidate.accountEmail === event.accountEmail &&
      candidate.calendarId === event.calendarId,
  );
  return {
    ...event,
    calendarSourceKey: source?.sourceKey ?? "",
    canonicalKey: source?.canonicalKey,
    calendarPrimary: source?.primary,
    description: "",
    location: "",
    allDay: false,
    source: "google",
    googleEventId: event.id.replace(/^google-/, ""),
    htmlLink: "https://calendar.google.com/calendar/u/0/r",
    createdAt: now,
    updatedAt: now,
  };
}
