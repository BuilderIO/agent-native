import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useSearchParams } from "react-router";
import { toast } from "sonner";
import {
  IconCalendar,
  IconCalendarOff,
  IconCalendarPlus,
  IconExternalLink,
  IconKey,
  IconLoader2,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { useActionQuery } from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  MeetingCard,
  MeetingCardSkeleton,
  type MeetingCardData,
} from "@/components/meetings/meeting-card";
import { DayHeader, formatDayLabel } from "@/components/meetings/day-header";
import type { AttendeeStackParticipant } from "@/components/meetings/attendee-stack";
import { PageHeader } from "@/components/library/page-header";

export function meta() {
  return [{ title: "Meetings · Clips" }];
}

interface Meeting extends MeetingCardData {
  source?: "calendar" | "adhoc";
  participants?: AttendeeStackParticipant[];
}

interface CalendarAccount {
  id: string;
  provider: "google" | "icloud" | "microsoft" | string;
  email?: string | null;
  lastSyncedAt?: string | null;
}

function groupByDay(meetings: Meeting[]): Array<[string, Meeting[]]> {
  const groups = new Map<string, Meeting[]>();
  for (const m of meetings) {
    const key = formatDayLabel(m.scheduledStart);
    const arr = groups.get(key) ?? [];
    arr.push(m);
    groups.set(key, arr);
  }
  for (const arr of groups.values()) {
    arr.sort(
      (a, b) =>
        new Date(a.scheduledStart).getTime() -
        new Date(b.scheduledStart).getTime(),
    );
  }
  return Array.from(groups.entries());
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
      <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground/80 px-1">
        {title}
      </h2>
      {groups.map(([day, items]) => (
        <div key={day} className="space-y-2">
          <DayHeader label={day} />
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

function ConnectCalendarEmptyState({
  onConnected,
}: {
  onConnected?: () => void;
}) {
  // Mirrors ConnectBuilderCard layout: prominent CTA card, secondary
  // "Add API key" disclosure underneath.
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleConnect = () => {
    setError(null);
    setPending(true);
    fetch("/_agent-native/actions/connect-calendar?provider=google")
      .then(async (r) => {
        const text = await r.text();
        let data: { url?: string; error?: string } = {};
        try {
          data = JSON.parse(text);
        } catch {
          /* fall through */
        }
        if (!r.ok) throw new Error(data.error || `Failed (${r.status})`);
        if (!data.url) throw new Error("No OAuth URL returned");
        window.open(
          data.url,
          "_blank",
          "noopener,noreferrer,width=600,height=700",
        );
        onConnected?.();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setPending(false));
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
                disabled={pending}
                className="gap-1.5 cursor-pointer"
              >
                {pending ? (
                  <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                Connect Google Calendar
                <IconExternalLink className="h-3.5 w-3.5" />
              </Button>
            </div>
            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
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
  onAddManual,
  query,
  onQueryChange,
}: {
  onAddManual: () => void;
  query: string;
  onQueryChange: (next: string) => void;
}) {
  return (
    <>
      <PageHeader>
        <h1 className="text-base font-semibold tracking-tight truncate">
          Meetings
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onAddManual}
            className="gap-1.5 cursor-pointer shrink-0 h-8"
          >
            <IconCalendarPlus className="h-4 w-4" />
            New meeting
          </Button>
        </div>
      </PageHeader>
      <div className="flex flex-col gap-4 mb-6">
        <p className="text-sm text-muted-foreground">
          Upcoming and past meetings with live transcripts and AI notes.
        </p>
        <div className="relative max-w-sm">
          <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search by title or attendee…"
            className="pl-8 pr-8 h-9 text-sm"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              aria-label="Clear search"
            >
              <IconX className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function meetingMatches(m: Meeting, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  if ((m.title || "").toLowerCase().includes(needle)) return true;
  for (const p of m.participants ?? []) {
    if ((p.name ?? "").toLowerCase().includes(needle)) return true;
    if ((p.email ?? "").toLowerCase().includes(needle)) return true;
  }
  return false;
}

export default function MeetingsIndexRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQ = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(initialQ);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQ);

  // Debounce 200ms — keep URL in sync for shareability.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(query);
      const next = new URLSearchParams(searchParams);
      if (query) next.set("q", query);
      else next.delete("q");
      setSearchParams(next, { replace: true });
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const accounts = useActionQuery<{ accounts: CalendarAccount[] } | undefined>(
    "list-calendar-accounts",
    {},
    { retry: false },
  );
  const meetingsQuery = useActionQuery<
    { meetings: Meeting[] } | Meeting[] | undefined
  >("list-meetings", { view: "all" }, { retry: false });

  const meetings: Meeting[] = useMemo(() => {
    const data = meetingsQuery.data;
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return data.meetings ?? [];
  }, [meetingsQuery.data]);

  const hasCalendar = (accounts.data?.accounts?.length ?? 0) > 0;
  const isLoading = accounts.isLoading || meetingsQuery.isLoading;

  // G6 — detect 0→1 calendar account transition and toast the success state.
  const prevAccountCountRef = useRef<number | null>(null);
  const prevMeetingCountRef = useRef<number>(0);
  useEffect(() => {
    const count = accounts.data?.accounts?.length ?? 0;
    const prev = prevAccountCountRef.current;
    prevAccountCountRef.current = count;
    if (prev === 0 && count >= 1) {
      toast.success("Calendar connected. Syncing your events…");
    }
  }, [accounts.data]);
  useEffect(() => {
    const next = meetings.length;
    const prev = prevMeetingCountRef.current;
    prevMeetingCountRef.current = next;
    if (hasCalendar && prev === 0 && next > 0 && prevAccountCountRef.current) {
      toast.success(
        `Synced ${next} event${next === 1 ? "" : "s"} from your calendar`,
      );
    }
  }, [meetings.length, hasCalendar]);

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const upcoming: Meeting[] = [];
    const past: Meeting[] = [];
    for (const m of meetings) {
      if (!meetingMatches(m, debouncedQuery)) continue;
      const start = new Date(m.scheduledStart).getTime();
      const end = m.scheduledEnd
        ? new Date(m.scheduledEnd).getTime()
        : start + 30 * 60 * 1000;
      const isLiveNow = !!(m.actualStart && !m.actualEnd);
      if (end < now && !isLiveNow) past.push(m);
      else upcoming.push(m);
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
  }, [meetings, debouncedQuery]);

  const handleAddManual = () => {
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
      .then((data: { meeting?: { id?: string }; id?: string } | null) => {
        const id = data?.meeting?.id ?? data?.id;
        if (id && typeof window !== "undefined") {
          window.location.assign(`/meetings/${id}`);
        }
      })
      .catch(() => toast.error("Couldn't create meeting"));
  };

  if (isLoading) {
    return (
      <>
        <PageHeader>
          <h1 className="text-base font-semibold tracking-tight truncate">
            Meetings
          </h1>
        </PageHeader>
        <div className="p-6 max-w-6xl mx-auto w-full">
          <div className="space-y-2 mb-6">
            <div className="h-7 w-40 rounded bg-muted animate-pulse" />
            <div className="h-4 w-64 rounded bg-muted/70 animate-pulse" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <MeetingCardSkeleton key={i} />
            ))}
          </div>
        </div>
      </>
    );
  }

  if (accounts.isError && meetingsQuery.isError) {
    return (
      <>
        <PageHeader>
          <h1 className="text-base font-semibold tracking-tight truncate">
            Meetings
          </h1>
        </PageHeader>
        <div className="p-6 max-w-2xl mx-auto w-full">
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            Couldn't load meetings. Try again in a moment.
          </div>
        </div>
      </>
    );
  }

  if (!hasCalendar && meetings.length === 0) {
    return (
      <div className="p-6 w-full">
        <MeetingsHeader
          onAddManual={handleAddManual}
          query={query}
          onQueryChange={setQuery}
        />
        <ConnectCalendarEmptyState />
      </div>
    );
  }

  const hasResults = upcoming.length + past.length > 0;

  return (
    <div className="p-6 max-w-6xl mx-auto w-full">
      <MeetingsHeader
        onAddManual={handleAddManual}
        query={query}
        onQueryChange={setQuery}
      />

      {meetings.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-accent/20 px-6 py-16 text-center">
          <IconCalendarOff className="h-10 w-10 text-muted-foreground/50 mx-auto" />
          <p className="mt-3 text-sm text-foreground font-medium">
            No upcoming meetings
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your calendar is clear. New events will appear here as they're
            added.
          </p>
        </div>
      ) : !hasResults ? (
        <div className="rounded-lg border border-dashed border-border bg-accent/20 px-6 py-12 text-center">
          <IconSearch className="h-7 w-7 text-muted-foreground/50 mx-auto" />
          <p className="mt-2 text-sm text-foreground">
            No meetings match "{debouncedQuery}"
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setQuery("")}
            className="mt-2 cursor-pointer"
          >
            Clear search
          </Button>
        </div>
      ) : (
        <div className="space-y-8">
          <MeetingSection title="Upcoming" meetings={upcoming} />
          <MeetingSection title="Past" meetings={past} />
        </div>
      )}

      {meetingsQuery.isFetching && !meetingsQuery.isLoading && (
        <div className="flex items-center justify-center mt-6 text-xs text-muted-foreground gap-1.5">
          <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
          Refreshing…
        </div>
      )}
    </div>
  );
}
