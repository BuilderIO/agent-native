import { useMemo } from "react";
import { NavLink } from "react-router";
import {
  IconCalendar,
  IconCalendarPlus,
  IconCheck,
  IconClock,
  IconExternalLink,
  IconKey,
  IconLoader2,
  IconUsers,
  IconVideo,
} from "@tabler/icons-react";
import { useActionQuery } from "@agent-native/core/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function meta() {
  return [{ title: "Meetings · Clips" }];
}

interface MeetingParticipant {
  id?: string;
  email: string;
  name?: string | null;
  isOrganizer?: boolean;
}

interface Meeting {
  id: string;
  title: string;
  scheduledStart: string;
  scheduledEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  platform?: "zoom" | "meet" | "teams" | "adhoc" | string;
  joinUrl?: string | null;
  recordingId?: string | null;
  transcriptStatus?: "pending" | "ready" | "failed" | "in_progress" | string;
  source?: "calendar" | "adhoc";
  participants?: MeetingParticipant[];
}

interface CalendarAccount {
  id: string;
  provider: "google" | "icloud" | "microsoft" | string;
  email?: string | null;
  lastSyncedAt?: string | null;
}

function formatTime(iso?: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function dayKey(iso: string): string {
  try {
    const d = new Date(iso);
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    const sameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();

    if (sameDay(d, today)) return "Today";
    if (sameDay(d, tomorrow)) return "Tomorrow";
    return d.toLocaleDateString([], {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "Upcoming";
  }
}

function groupByDay(meetings: Meeting[]): Map<string, Meeting[]> {
  const groups = new Map<string, Meeting[]>();
  for (const m of meetings) {
    const key = dayKey(m.scheduledStart);
    const arr = groups.get(key) ?? [];
    arr.push(m);
    groups.set(key, arr);
  }
  // Sort meetings within each day by start time
  for (const arr of groups.values()) {
    arr.sort(
      (a, b) =>
        new Date(a.scheduledStart).getTime() -
        new Date(b.scheduledStart).getTime(),
    );
  }
  return groups;
}

function initialsFor(p: MeetingParticipant): string {
  const src = p.name?.trim() || p.email?.trim() || "?";
  const parts = src
    .replace(/@.*$/, "")
    .split(/\s+|[._-]/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]![0] ?? "") + (parts[1]![0] ?? "")).toUpperCase();
}

function ParticipantStack({
  participants,
}: {
  participants: MeetingParticipant[];
}) {
  if (!participants || participants.length === 0) return null;
  const visible = participants.slice(0, 4);
  const extra = participants.length - visible.length;
  return (
    <div className="flex items-center -space-x-1.5">
      {visible.map((p, i) => (
        <Avatar
          key={`${p.email}-${i}`}
          className="h-6 w-6 ring-2 ring-background"
          title={p.name || p.email}
        >
          <AvatarImage alt={p.name || p.email} />
          <AvatarFallback className="text-[9px] font-medium">
            {initialsFor(p)}
          </AvatarFallback>
        </Avatar>
      ))}
      {extra > 0 && (
        <span className="ml-2 text-[10px] text-muted-foreground">+{extra}</span>
      )}
    </div>
  );
}

function MeetingCard({ meeting }: { meeting: Meeting }) {
  const transcriptReady = meeting.transcriptStatus === "ready";
  const inProgress =
    meeting.actualStart && !meeting.actualEnd
      ? true
      : meeting.transcriptStatus === "in_progress";

  return (
    <NavLink
      to={`/meetings/${meeting.id}`}
      className="group block focus:outline-none"
    >
      <Card className="transition-colors hover:bg-accent/40 hover:border-primary/30 cursor-pointer">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-medium leading-tight line-clamp-2 flex-1">
              {meeting.title || "Untitled meeting"}
            </h3>
            {inProgress ? (
              <Badge
                variant="secondary"
                className="bg-red-500/10 text-red-500 border-red-500/20 text-[10px] gap-1"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                Live
              </Badge>
            ) : transcriptReady ? (
              <Badge
                variant="secondary"
                className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px] gap-1"
              >
                <IconCheck className="h-3 w-3" />
                Transcript
              </Badge>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <IconClock className="h-3.5 w-3.5" />
            <span>{formatTime(meeting.scheduledStart)}</span>
            {meeting.scheduledEnd && (
              <span> – {formatTime(meeting.scheduledEnd)}</span>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <ParticipantStack participants={meeting.participants ?? []} />
            {meeting.recordingId && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <IconVideo className="h-3 w-3" />
                Recording
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </NavLink>
  );
}

function MeetingSection({
  title,
  meetings,
}: {
  title: string;
  meetings: Meeting[];
}) {
  if (meetings.length === 0) return null;
  const groups = groupByDay(meetings);
  return (
    <section className="space-y-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">
        {title}
      </h2>
      {Array.from(groups.entries()).map(([day, items]) => (
        <div key={day} className="space-y-2">
          <div className="text-xs font-medium text-foreground/70 px-1">
            {day}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map((m) => (
              <MeetingCard key={m.id} meeting={m} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function ConnectCalendarEmptyState() {
  // Mirrors ConnectBuilderCard layout: prominent CTA card, secondary
  // "Add API key" disclosure underneath. Single card, no clutter.
  const handleConnect = () => {
    // Optimistic — fire and forget; parent agent owns the action.
    fetch("/_agent-native/actions/connect-calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "google" }),
    })
      .then((r) => r.json())
      .then((data: { authUrl?: string } | null) => {
        if (data?.authUrl) {
          window.open(
            data.authUrl,
            "_blank",
            "noopener,noreferrer,width=600,height=700",
          );
        }
      })
      .catch(() => {});
  };

  return (
    <div className="max-w-xl mx-auto mt-12 space-y-3">
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="flex items-start gap-3 px-4 py-3.5 bg-gradient-to-br from-primary/5 via-transparent to-transparent">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
            <IconCalendar className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-foreground">
              Connect Google Calendar
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
              See your upcoming meetings, get a notification a few minutes
              before, and one-click record + transcribe.
            </p>
            <div className="mt-3">
              <Button
                size="sm"
                onClick={handleConnect}
                className="gap-1.5 cursor-pointer"
              >
                Connect Google Calendar
                <IconExternalLink className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-1 cursor-pointer">
          <IconKey className="h-3.5 w-3.5" />
          Add API key instead
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 rounded-md border border-border bg-accent/20 px-3 py-2.5 text-xs text-muted-foreground space-y-1.5">
            <p>
              You can also paste a Google service-account or OAuth client API
              key directly in Settings → Secrets:
            </p>
            <NavLink
              to="/settings#secrets:GOOGLE_CALENDAR_API_KEY"
              className="inline-flex items-center gap-1 text-foreground hover:underline"
            >
              Open settings
              <IconExternalLink className="h-3 w-3" />
            </NavLink>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function MeetingsHeader({
  hasCalendar,
  onAddManual,
}: {
  hasCalendar: boolean;
  onAddManual: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 mb-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <IconCalendar className="h-6 w-6" />
          Meetings
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Upcoming and past meetings with live transcripts and AI notes.
        </p>
      </div>
      {hasCalendar && (
        <Button
          size="sm"
          variant="outline"
          onClick={onAddManual}
          className="gap-1.5 cursor-pointer"
        >
          <IconCalendarPlus className="h-4 w-4" />
          New meeting
        </Button>
      )}
    </div>
  );
}

export default function MeetingsIndexRoute() {
  const accounts = useActionQuery<{ accounts: CalendarAccount[] } | undefined>(
    "list-calendar-accounts",
    {},
    { retry: false },
  );
  const meetingsQuery = useActionQuery<
    { meetings: Meeting[] } | Meeting[] | undefined
  >("list-meetings", {}, { retry: false });

  const meetings: Meeting[] = useMemo(() => {
    const data = meetingsQuery.data;
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return data.meetings ?? [];
  }, [meetingsQuery.data]);

  const hasCalendar = (accounts.data?.accounts?.length ?? 0) > 0;
  const isLoading = accounts.isLoading || meetingsQuery.isLoading;

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const upcoming: Meeting[] = [];
    const past: Meeting[] = [];
    for (const m of meetings) {
      const start = new Date(m.scheduledStart).getTime();
      const end = m.scheduledEnd
        ? new Date(m.scheduledEnd).getTime()
        : start + 30 * 60 * 1000;
      if (end < now && !(m.actualStart && !m.actualEnd)) {
        past.push(m);
      } else {
        upcoming.push(m);
      }
    }
    upcoming.sort(
      (a, b) =>
        new Date(a.scheduledStart).getTime() -
        new Date(b.scheduledStart).getTime(),
    );
    past.sort(
      (a, b) =>
        new Date(b.scheduledStart).getTime() -
        new Date(a.scheduledStart).getTime(),
    );
    return { upcoming, past };
  }, [meetings]);

  const handleAddManual = () => {
    // Optimistic create — POST and on success navigate. We don't await because
    // the user expects an instant response; the detail page will load the row
    // via polling once it lands.
    fetch("/_agent-native/actions/create-meeting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Untitled meeting",
        scheduledStart: new Date().toISOString(),
        source: "adhoc",
      }),
    })
      .then((r) => r.json())
      .then((data: { id?: string } | null) => {
        if (data?.id && typeof window !== "undefined") {
          window.location.assign(`/meetings/${data.id}`);
        }
      })
      .catch(() => {});
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-6xl mx-auto w-full">
        <div className="space-y-2 mb-6">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (accounts.isError && meetingsQuery.isError) {
    return (
      <div className="p-6 max-w-2xl mx-auto w-full">
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Couldn't load meetings. Try again in a moment.
        </div>
      </div>
    );
  }

  if (!hasCalendar && meetings.length === 0) {
    return (
      <div className="p-6 w-full">
        <MeetingsHeader hasCalendar={false} onAddManual={handleAddManual} />
        <ConnectCalendarEmptyState />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto w-full">
      <MeetingsHeader hasCalendar={hasCalendar} onAddManual={handleAddManual} />

      {meetings.length === 0 ? (
        <div
          className={cn(
            "rounded-md border border-dashed border-border bg-accent/20",
            "px-6 py-12 text-center",
          )}
        >
          <IconUsers className="h-8 w-8 text-muted-foreground/60 mx-auto" />
          <p className="mt-2 text-sm text-muted-foreground">
            No meetings yet. They'll appear here as your calendar syncs.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          <MeetingSection title="Upcoming" meetings={upcoming} />
          <MeetingSection title="Past" meetings={past} />
        </div>
      )}

      {meetingsQuery.isLoading && (
        <div className="flex items-center justify-center mt-6 text-xs text-muted-foreground gap-1.5">
          <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
          Refreshing…
        </div>
      )}
    </div>
  );
}
