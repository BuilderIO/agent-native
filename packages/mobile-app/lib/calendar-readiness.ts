export interface CalendarEventLike {
  id: string;
  title?: string | null;
  startDate: string | Date;
  endDate: string | Date;
  allDay?: boolean;
  status?: string | null;
  timeZone?: string | null;
  url?: string | null;
  location?: string | null;
  notes?: string | null;
}

export interface CalendarLike {
  accessLevel?: string | null;
  isVisible?: boolean;
  isSynced?: boolean;
}

export interface UpcomingMeeting {
  id: string;
  title: string;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  timeZone?: string;
  joinUrl?: string;
}

export function isReadableCalendar(calendar: CalendarLike): boolean {
  return (
    calendar.accessLevel?.toLowerCase() !== "none" &&
    calendar.isVisible !== false &&
    calendar.isSynced !== false
  );
}

function parseHttpUrl(candidate: string): string | undefined {
  try {
    const url = new URL(candidate);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function trimUrlPunctuation(candidate: string): string {
  return candidate.replace(/[),.;!?\]}]+$/u, "");
}

export function deriveMeetingJoinUrl(
  event: Pick<CalendarEventLike, "url" | "location" | "notes">,
): string | undefined {
  const fields = [event.url, event.location, event.notes];
  for (const field of fields) {
    if (!field) continue;

    const directUrl = parseHttpUrl(field.trim());
    if (directUrl) return directUrl;

    for (const match of field.matchAll(/https?:\/\/[^\s<>"']+/giu)) {
      const embeddedUrl = parseHttpUrl(trimUrlPunctuation(match[0]));
      if (embeddedUrl) return embeddedUrl;
    }
  }
  return undefined;
}

function toDate(value: string | Date): Date | undefined {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export function findNextUpcomingMeeting(
  events: CalendarEventLike[],
  now = new Date(),
): UpcomingMeeting | undefined {
  const nowMs = now.getTime();
  return events
    .flatMap((event): UpcomingMeeting[] => {
      if (
        ["canceled", "cancelled"].includes(event.status?.toLowerCase() ?? "")
      ) {
        return [];
      }
      const startDate = toDate(event.startDate);
      const endDate = toDate(event.endDate);
      if (!startDate || !endDate || endDate.getTime() <= nowMs) return [];

      return [
        {
          id: event.id,
          title: event.title?.trim() || "Untitled meeting",
          startDate,
          endDate,
          allDay: Boolean(event.allDay),
          timeZone: event.timeZone || undefined,
          joinUrl: deriveMeetingJoinUrl(event),
        },
      ];
    })
    .sort(
      (left, right) => left.startDate.getTime() - right.startDate.getTime(),
    )[0];
}

function validTimeZone(timeZone: string | undefined): string | undefined {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone }).format();
    return timeZone;
  } catch {
    return undefined;
  }
}

function dateParts(date: Date, timeZone: string | undefined) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone,
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function dayDistance(
  startDate: Date,
  now: Date,
  timeZone: string | undefined,
): number {
  const start = dateParts(startDate, timeZone);
  const current = dateParts(now, timeZone);
  return Math.round(
    (Date.UTC(start.year, start.month - 1, start.day) -
      Date.UTC(current.year, current.month - 1, current.day)) /
      86_400_000,
  );
}

function sentenceCase(value: string, locale: string | undefined): string {
  return value
    ? `${value[0].toLocaleUpperCase(locale)}${value.slice(1)}`
    : value;
}

export function formatUpcomingMeetingTiming(
  meeting: Pick<
    UpcomingMeeting,
    "startDate" | "endDate" | "allDay" | "timeZone"
  >,
  now = new Date(),
  locale?: string,
): string {
  const timeZone = validTimeZone(meeting.timeZone);
  const relativeDay = dayDistance(meeting.startDate, now, timeZone);
  const dayLabel =
    relativeDay >= -1 && relativeDay <= 1
      ? sentenceCase(
          new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
            relativeDay,
            "day",
          ),
          locale,
        )
      : new Intl.DateTimeFormat(locale, {
          day: "numeric",
          month: "short",
          weekday: "short",
          timeZone,
        }).format(meeting.startDate);

  if (meeting.allDay) return `${dayLabel} · All day`;

  const timeFormatter = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  });
  const timeRange = `${timeFormatter.format(meeting.startDate)} – ${timeFormatter.format(meeting.endDate)}`;

  if (
    meeting.startDate.getTime() <= now.getTime() &&
    meeting.endDate.getTime() > now.getTime()
  ) {
    return `Happening now · Ends ${timeFormatter.format(meeting.endDate)}`;
  }
  return `${dayLabel} · ${timeRange}`;
}
