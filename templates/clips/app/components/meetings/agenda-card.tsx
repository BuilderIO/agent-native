/**
 * <AgendaCard /> — the Meetings tab's rolling agenda.
 *
 * One bordered card of list rows, not a grid of tiles — see
 * `desktop/design-refs/granola-ux.md` §2. It is a Zoom-style rolling window
 * rather than a strict future list: `view=agenda` reaches 24h back, so the
 * calls you already had today stay on your day, with a "now" marker between
 * what has happened and what has not. Anything older falls out to the Past tab.
 *
 * Recording is a desktop gesture, so a row never offers a web "record" button
 * that cannot work; the imminent row offers Join and Open notes instead.
 */
import { useT } from "@agent-native/core/client/i18n";
import { IconExternalLink } from "@tabler/icons-react";
import { Fragment } from "react";
import { NavLink } from "react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { AttendeeStack, type AttendeeStackParticipant } from "./attendee-stack";

export interface AgendaMeeting {
  id: string;
  title: string;
  scheduledStart: string;
  scheduledEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  joinUrl?: string | null;
  participants?: AttendeeStackParticipant[];
}

type Translate = (key: string, params?: Record<string, unknown>) => string;

/**
 * Whether a meeting has actually finished. Agenda intentionally keeps
 * already-ended meetings (see module doc), so "is this over" has to be its
 * own check — `relativeStartLabel`'s `soon` only looks at scheduledStart and
 * stays true for up to 2h after start regardless of whether the call ended.
 */
export function meetingHasEnded(
  meeting: Pick<AgendaMeeting, "actualEnd" | "scheduledEnd" | "scheduledStart">,
  nowMs: number = Date.now(),
): boolean {
  const endMs = Date.parse(
    meeting.actualEnd ?? meeting.scheduledEnd ?? meeting.scheduledStart,
  );
  return !Number.isNaN(endMs) && endMs < nowMs;
}

function formatTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Index of the first meeting that has not finished yet — where the "now"
 * marker goes. Returns -1 when every meeting is still ahead, so a day that
 * hasn't started yet doesn't get a marker pinned above its first row.
 */
export function nowMarkerIndex(
  meetings: AgendaMeeting[],
  nowMs: number,
): number {
  const firstUnfinished = meetings.findIndex((m) => {
    const endMs = Date.parse(m.actualEnd ?? m.scheduledEnd ?? m.scheduledStart);
    return Number.isNaN(endMs) || endMs >= nowMs;
  });
  return firstUnfinished > 0 ? firstUnfinished : -1;
}

/** Human "now" / "in 5 min" / "in 2 hr" label for an upcoming row. */
export function relativeStartLabel(
  iso: string,
  t: Translate,
): { text: string; soon: boolean } {
  const start = Date.parse(iso);
  if (Number.isNaN(start)) return { text: "", soon: false };
  const diffMin = Math.round((start - Date.now()) / 60000);
  if (diffMin <= 0 && diffMin > -120)
    return { text: t("meetingCard.now"), soon: true };
  if (diffMin <= 0) return { text: t("meetingCard.started"), soon: false };
  if (diffMin < 60)
    return {
      text: t("meetingCard.inMinutes", { count: diffMin }),
      soon: diffMin <= 5,
    };
  const hrs = Math.round(diffMin / 60);
  return { text: t("meetingCard.inHours", { count: hrs }), soon: false };
}

interface DayParts {
  dayNumber: string;
  month: string;
  weekday: string;
}

function dayParts(iso: string): DayParts {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { dayNumber: "", month: "", weekday: "" };
  }
  return {
    dayNumber: d.toLocaleDateString([], { day: "numeric" }),
    month: d.toLocaleDateString([], { month: "long" }),
    weekday: d.toLocaleDateString([], { weekday: "short" }),
  };
}

function groupByCalendarDay(
  meetings: AgendaMeeting[],
): Array<[string, AgendaMeeting[]]> {
  const groups = new Map<string, AgendaMeeting[]>();
  for (const m of meetings) {
    const d = new Date(m.scheduledStart);
    const key = Number.isNaN(d.getTime())
      ? m.scheduledStart
      : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const list = groups.get(key) ?? [];
    list.push(m);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    list.sort(
      (a, b) =>
        Date.parse(a.scheduledStart) - Date.parse(b.scheduledStart) || 0,
    );
  }
  return Array.from(groups.entries());
}

function AgendaRow({ meeting }: { meeting: AgendaMeeting }) {
  const t = useT();
  const isLive = !!(meeting.actualStart && !meeting.actualEnd);
  const hasEnded = meetingHasEnded(meeting);
  const { text: whenText, soon } = relativeStartLabel(
    meeting.scheduledStart,
    t,
  );
  const active = isLive || (soon && !hasEnded);
  const start = formatTime(meeting.scheduledStart);
  const end = formatTime(meeting.scheduledEnd);

  return (
    // Wraps rather than compressing: at ~375px the title, avatars and both
    // buttons cannot share a line, and a nowrap row silently slides the
    // buttons on top of the title instead of pushing them down.
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex min-w-0 flex-1 basis-48 items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "w-0.5 self-stretch rounded-full",
            active ? "bg-foreground/40" : "bg-border",
          )}
        />
        <NavLink
          to={`/meetings/${meeting.id}`}
          className="min-w-0 flex-1 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="truncate text-sm font-medium text-foreground">
            {meeting.title || t("meetingDetail.untitledMeeting")}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs tabular-nums text-muted-foreground">
            {isLive ? (
              <span className="inline-flex items-center gap-1 font-medium text-destructive">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-destructive" />
                </span>
                {t("meetingCard.live")}
              </span>
            ) : whenText && !hasEnded ? (
              <span className={cn(soon && "font-medium text-foreground")}>
                {whenText}
              </span>
            ) : null}
            {(isLive || whenText) && start ? <span>·</span> : null}
            {start ? <span>{end ? `${start} – ${end}` : start}</span> : null}
          </div>
        </NavLink>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="hidden sm:inline-flex">
          <AttendeeStack participants={meeting.participants ?? []} size="xs" />
        </span>
        {active ? (
          <div className="flex shrink-0 items-center gap-1.5">
            {meeting.joinUrl ? (
              <Button
                asChild
                size="sm"
                variant="outline"
                className="h-7 gap-1 px-2 text-xs cursor-pointer"
              >
                <a
                  href={meeting.joinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <IconExternalLink className="h-3.5 w-3.5" />
                  {t("meetingCard.join")}
                </a>
              </Button>
            ) : null}
            <Button
              asChild
              size="sm"
              className="h-7 px-2.5 text-xs cursor-pointer"
            >
              <NavLink to={`/meetings/${meeting.id}`}>
                {t("meetingCard.openNotes")}
              </NavLink>
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Zoom's orange current-time rule: what is behind you, and what is not. */
function NowMarker() {
  const t = useT();
  return (
    <div className="flex items-center gap-2" aria-hidden>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-primary">
        {t("meetingsRoute.now", { defaultValue: "Now" })}
      </span>
      <span className="h-px flex-1 bg-primary/40" />
    </div>
  );
}

export function AgendaCard({ meetings }: { meetings: AgendaMeeting[] }) {
  if (meetings.length === 0) return null;
  const days = groupByCalendarDay(meetings);
  // The marker index is computed over the flat, already-sorted list, then
  // matched back per day — a day group cannot know how many meetings preceded
  // it, and the marker belongs between two rows, not at a day boundary.
  const markerIndex = nowMarkerIndex(meetings, Date.now());
  let flatIndex = 0;

  return (
    <Card>
      <CardContent className="divide-y divide-border p-0">
        {days.map(([key, items]) => {
          const { dayNumber, month, weekday } = dayParts(
            items[0]!.scheduledStart,
          );
          const dayStartIndex = flatIndex;
          flatIndex += items.length;
          return (
            <div key={key} className="flex gap-4 px-4 py-3">
              <div className="w-14 shrink-0">
                <div className="text-xl font-semibold leading-none tabular-nums text-foreground">
                  {dayNumber}
                </div>
                <div className="mt-1 text-[11px] leading-tight text-muted-foreground">
                  {month}
                </div>
                <div className="text-[11px] leading-tight text-muted-foreground">
                  {weekday}
                </div>
              </div>
              <div className="min-w-0 flex-1 space-y-2.5">
                {items.map((m, i) => (
                  <Fragment key={m.id}>
                    {dayStartIndex + i === markerIndex ? <NowMarker /> : null}
                    <AgendaRow meeting={m} />
                  </Fragment>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function AgendaCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-background">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="flex gap-4 border-b border-border px-4 py-3">
          <div className="w-14 shrink-0 space-y-1.5">
            <div className="h-5 w-7 animate-pulse rounded bg-muted" />
            <div className="h-2.5 w-10 animate-pulse rounded bg-muted/70" />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-2/5 animate-pulse rounded bg-muted" />
            <div className="h-3 w-24 animate-pulse rounded bg-muted/70" />
          </div>
        </div>
      ))}
    </div>
  );
}
