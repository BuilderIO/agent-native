/**
 * <MeetingHistoryRow /> — one past meeting, one line.
 *
 * Granola renders history as Apple-Notes-style rows: attendee avatars, title,
 * who was on the call, time. No card border, no summary preview, no
 * status pills — see `desktop/design-refs/granola-ux.md` §2. Status badges on
 * every row read as noise at list scale; the meeting detail page is where
 * transcript/notes state belongs.
 *
 * `snippet` replaces the attendee subtitle in search results, where the reason
 * a row matched is the only thing worth reading.
 */
import { useSession } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconFileText } from "@tabler/icons-react";
import { NavLink } from "react-router";

import { AttendeeStack, type AttendeeStackParticipant } from "./attendee-stack";

export interface MeetingHistoryItem {
  id: string;
  title: string;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  participants?: AttendeeStackParticipant[];
}

function formatTime(iso?: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

/**
 * "Elaine" · "Lisa, Cody & 2 others" — Granola's attendee subtitle.
 *
 * The viewer is dropped: the subtitle answers "who was I with", and repeating
 * the reader's own name down every row of their own history says nothing. A
 * solo note keeps an empty subtitle rather than rendering just the viewer.
 */
export function formatParticipantNames(
  participants: AttendeeStackParticipant[],
  viewerEmail?: string | null,
): string {
  const viewer = viewerEmail?.trim().toLowerCase();
  const names = participants
    .filter((p) => !viewer || p.email?.trim().toLowerCase() !== viewer)
    .map((p) => p.name?.trim() || p.email?.trim().replace(/@.*$/, "") || "")
    .filter(Boolean);
  if (names.length === 0) return "";
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} & ${names.length - 2} others`;
}

export function MeetingHistoryRow({
  meeting,
  snippet,
}: {
  meeting: MeetingHistoryItem;
  snippet?: string | null;
}) {
  const t = useT();
  const { session } = useSession();
  const participants = meeting.participants ?? [];
  const subtitle =
    snippet?.trim() || formatParticipantNames(participants, session?.email);
  const time = formatTime(meeting.actualStart ?? meeting.scheduledStart);

  return (
    <NavLink
      to={`/meetings/${meeting.id}`}
      className="group flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {participants.length > 0 ? (
        <AttendeeStack participants={participants} size="md" max={2} />
      ) : (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <IconFileText className="h-3.5 w-3.5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-foreground">
          {meeting.title || t("meetingDetail.untitledMeeting")}
        </div>
        {subtitle ? (
          <div className="truncate text-xs text-muted-foreground">
            {subtitle}
          </div>
        ) : null}
      </div>
      {time ? (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {time}
        </span>
      ) : null}
    </NavLink>
  );
}

export function MeetingHistoryRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-2 py-2">
      <div className="h-7 w-7 shrink-0 animate-pulse rounded-md bg-muted" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-3.5 w-2/5 animate-pulse rounded bg-muted" />
        <div className="h-3 w-24 animate-pulse rounded bg-muted/70" />
      </div>
      <div className="h-3 w-12 animate-pulse rounded bg-muted/70" />
    </div>
  );
}
