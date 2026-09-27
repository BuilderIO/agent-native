import {
  registerActionChatRenderer,
  type ToolRendererProps,
} from "@agent-native/core/client/agentkit-chat";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { buildOpenRouteLink } from "@agent-native/core/client/navigation";
import {
  IconArrowUpRight,
  IconCalendarCheck,
  IconVideo,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

type EventResult = Record<string, unknown> & {
  title: string;
  start: string;
  end: string;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseEvent(value: unknown): EventResult | null {
  const event = asRecord(value);
  return event &&
    typeof event.title === "string" &&
    typeof event.start === "string" &&
    typeof event.end === "string"
    ? (event as EventResult)
    : null;
}

type TimeZoneResult =
  | { kind: "absent" }
  | { kind: "valid"; value: string }
  | { kind: "invalid" };

function timeZone(value: unknown): TimeZoneResult {
  if (typeof value !== "string" || !value) return { kind: "absent" };
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return { kind: "valid", value };
  } catch {
    return { kind: "invalid" };
  }
}

function dateKey(value: string, zone?: string): string | null {
  if (DATE_ONLY.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    ...(zone ? { timeZone: zone } : {}),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (name: string) =>
    parts.find((item) => item.type === name)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function shiftDate(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

function formatDateKey(
  value: string,
  formatDate: ReturnType<typeof useFormatters>["formatDate"],
): string {
  const [year, month, day] = value.split("-").map(Number);
  return formatDate(new Date(Date.UTC(year, month - 1, day, 12)), {
    dateStyle: "medium",
    timeZone: "UTC",
  });
}

function eventDateTime(
  event: EventResult,
  args: Record<string, unknown>,
  formatDate: ReturnType<typeof useFormatters>["formatDate"],
  t: ReturnType<typeof useT>,
): string | null {
  const startZoneResult = timeZone(event.startTimeZone);
  const endZoneResult = timeZone(event.endTimeZone ?? event.startTimeZone);
  if (startZoneResult.kind === "invalid" || endZoneResult.kind === "invalid") {
    return null;
  }
  const startZone =
    startZoneResult.kind === "valid" ? startZoneResult.value : undefined;
  const endZone =
    endZoneResult.kind === "valid" ? endZoneResult.value : undefined;
  const fullDayOutOfOffice =
    args.eventType === "outOfOffice" &&
    (args.fullDay === true || args.fullDay === "true");
  const allDay =
    event.allDay === true ||
    (DATE_ONLY.test(event.start) && DATE_ONLY.test(event.end)) ||
    fullDayOutOfOffice;

  if (allDay) {
    const start =
      fullDayOutOfOffice && typeof args.start === "string"
        ? args.start
        : dateKey(event.start, startZone);
    const endExclusive = dateKey(event.end, endZone);
    const end =
      fullDayOutOfOffice && typeof args.end === "string"
        ? args.end
        : endExclusive && shiftDate(endExclusive, -1);
    if (!start || !end) return null;
    const range =
      start === end
        ? formatDateKey(start, formatDate)
        : `${formatDateKey(start, formatDate)} – ${formatDateKey(end, formatDate)}`;
    return `${t("eventForm.allDay", { defaultValue: "All day" })} · ${range}`;
  }

  const startDate = dateKey(event.start, startZone);
  const endDate = dateKey(event.end, endZone);
  if (!startDate || !endDate) return null;
  const startTime = formatDate(event.start, {
    timeStyle: "short",
    ...(startZone ? { timeZone: startZone } : {}),
  });
  const endTime = formatDate(event.end, {
    timeStyle: "short",
    ...(endZone ? { timeZone: endZone } : {}),
  });
  const startLabel = formatDate(event.start, {
    dateStyle: "medium",
    ...(startZone ? { timeZone: startZone } : {}),
  });
  const endLabel = formatDate(event.end, {
    dateStyle: "medium",
    ...(endZone ? { timeZone: endZone } : {}),
  });
  return startDate === endDate
    ? `${startLabel} · ${startTime} – ${endTime}`
    : `${startLabel} ${startTime} – ${endLabel} ${endTime}`;
}

function eventStartDate(
  event: EventResult,
  args: Record<string, unknown>,
): string | null {
  const zoneResult = timeZone(event.startTimeZone);
  if (zoneResult.kind === "invalid") return null;
  const fullDayOutOfOffice =
    args.eventType === "outOfOffice" &&
    (args.fullDay === true || args.fullDay === "true");
  return fullDayOutOfOffice && typeof args.start === "string"
    ? args.start
    : dateKey(
        event.start,
        zoneResult.kind === "valid" ? zoneResult.value : undefined,
      );
}

type MeetingLinkResult =
  | { kind: "absent" }
  | { kind: "safe"; url: string }
  | { kind: "invalid" };

function meetingLink(event: EventResult): MeetingLinkResult {
  const entries = asRecord(event.conferenceData)?.entryPoints;
  const videoEntry = Array.isArray(entries)
    ? entries.map(asRecord).find((entry) => entry?.entryPointType === "video")
        ?.uri
    : undefined;
  const candidate = [event.hangoutLink, event.meetingLink, videoEntry].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (!candidate) return { kind: "absent" };
  try {
    const url = new URL(candidate);
    return url.protocol === "https:"
      ? { kind: "safe", url: url.href }
      : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

export function CalendarEventCreatedCard({ context }: ToolRendererProps) {
  const t = useT();
  const { formatDate } = useFormatters();
  if (context.toolName !== "create-event" || context.isRunning) return null;

  const event = parseEvent(context.resultJson);
  if (!event) return null;

  const when = eventDateTime(event, context.args, formatDate, t);
  const location =
    typeof event.location === "string" ? event.location.trim() : "";
  const meeting = meetingLink(event);
  const joinUrl = meeting.kind === "safe" ? meeting.url : undefined;
  const eventId = typeof event.id === "string" ? event.id : "";
  const startDate = eventStartDate(event, context.args);
  const openUrl =
    eventId && startDate
      ? buildOpenRouteLink({
          app: "calendar",
          view: "calendar",
          params: { eventId, date: startDate },
        }).url
      : undefined;
  const zoomWarning =
    event.videoConferenceError === "zoom"
      ? t("eventCreation.zoomNotAdded", {
          defaultValue: "The event was created, but Zoom could not be added.",
        })
      : "";
  const details = [when, location, zoomWarning].filter(Boolean).join(" · ");
  const trailingUrl = openUrl ?? joinUrl;
  const trailingLabel = openUrl
    ? t("eventCreation.openInCalendar", {
        defaultValue: "Open event in Calendar",
      })
    : joinUrl
      ? t("eventForm.joinMeeting", { defaultValue: "Join meeting" })
      : undefined;

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        role="img"
        aria-label={t("eventCreation.created", {
          defaultValue: "Event created",
        })}
        className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"
      >
        <IconCalendarCheck aria-hidden="true" className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {event.title || t("eventForm.event", { defaultValue: "Event" })}
        </p>
        {(details || (joinUrl && openUrl)) && (
          <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {details ? (
              <span className="min-w-0 truncate" title={details}>
                {details}
              </span>
            ) : null}
            {joinUrl && openUrl ? (
              <a
                href={joinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline"
              >
                <IconVideo aria-hidden="true" className="size-3.5" />
                {t("eventForm.joinMeeting", { defaultValue: "Join meeting" })}
              </a>
            ) : null}
          </p>
        )}
      </div>
      {trailingUrl && trailingLabel ? (
        <Button asChild className="shrink-0" size="sm" variant="outline">
          <a
            href={trailingUrl}
            {...(joinUrl && trailingUrl === joinUrl
              ? { rel: "noopener noreferrer", target: "_blank" }
              : {})}
          >
            {trailingLabel}
            {openUrl ? (
              <IconArrowUpRight aria-hidden="true" className="size-3.5" />
            ) : null}
          </a>
        </Button>
      ) : null}
    </div>
  );
}

registerActionChatRenderer({
  id: "calendar.event-created",
  renderer: "calendar.event-created",
  Component: CalendarEventCreatedCard,
});
