import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconAppWindow,
  IconCalendar,
  IconCheck,
  IconExternalLink,
  IconLoader2,
  IconNotes,
  IconPlugConnected,
  IconPlugOff,
  IconSearch,
  IconSettings,
  IconX,
} from "@tabler/icons-react";
import { agentNativePath, useActionQuery } from "@agent-native/core/client";
import { useDesktopPromo } from "@/hooks/use-desktop-promo";
import {
  UpcomingMeetingCard,
  MeetingCardSkeleton,
} from "@/components/meetings/meeting-card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { DayHeader, formatDayLabel } from "@/components/meetings/day-header";
import type { AttendeeStackParticipant } from "@/components/meetings/attendee-stack";
import { PageHeader } from "@/components/library/page-header";
import { CaptureInstallButton } from "@/components/capture-install-options";

export function meta() {
  return [{ title: "Meetings · Clips" }];
}

interface Meeting {
  id: string;
  title: string;
  scheduledStart: string;
  scheduledEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  recordingId?: string | null;
  joinUrl?: string | null;
  platform?: string | null;
  transcriptStatus?:
    | "pending"
    | "ready"
    | "failed"
    | "in_progress"
    | string
    | null;
  summaryPreview?: string | null;
  summaryMd?: string | null;
  userNotesMd?: string | null;
  source?: "calendar" | "adhoc" | "manual";
  participants?: AttendeeStackParticipant[];
}

interface CalendarFetchError {
  accountId: string;
  error: string;
  needsReauth: boolean;
}

interface ListMeetingsResponse {
  meetings?: Meeting[];
  calendarErrors?: CalendarFetchError[];
}

interface CalendarAccount {
  id: string;
  provider: "google" | "icloud" | "microsoft" | string;
  displayName?: string | null;
  email?: string | null;
  status?: "connected" | "needs-reauth" | "disconnected" | string;
  lastSyncedAt?: string | null;
  lastSyncError?: string | null;
}

async function requestDisconnectCalendar(accountId: string): Promise<void> {
  const r = await fetch(
    agentNativePath("/_agent-native/actions/disconnect-calendar"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: accountId }),
    },
  );
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    let parsed: { error?: string } = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      // Keep status fallback below.
    }
    throw new Error(parsed.error || `Disconnect failed (${r.status})`);
  }
}

async function startCalendarOAuth(): Promise<void> {
  const r = await fetch(
    agentNativePath("/_agent-native/actions/connect-calendar?provider=google"),
  );
  const text = await r.text();
  let data: {
    url?: string;
    error?: string;
    result?: { url?: string };
  } = {};
  try {
    data = JSON.parse(text);
  } catch {
    // Keep the fallback below.
  }
  if (!r.ok) throw new Error(data.error || `Failed (${r.status})`);
  const url = data.result?.url ?? data.url;
  if (!url) throw new Error("No OAuth URL returned");
  const popupUrl = new URL(url, window.location.origin).toString();
  const popup = window.open(
    popupUrl,
    "clips-calendar-oauth",
    "width=600,height=700",
  );
  if (!popup) {
    throw new Error(
      "Popup blocked — please allow popups for this site and try again.",
    );
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      window.removeEventListener("focus", onFocus);
      resolve();
    };
    const interval = window.setInterval(() => {
      if (popup.closed) finish();
    }, 500);
    // Some browsers (COOP) never report popup.closed; also resolve when the
    // user returns to this tab, and give up after 5 minutes regardless so the
    // connect flow can't hang forever.
    const onFocus = () => {
      if (popup.closed) finish();
    };
    window.addEventListener("focus", onFocus);
    const timeout = window.setTimeout(finish, 5 * 60 * 1000);
  });
}

function calendarAccountLabel(account: CalendarAccount): string {
  return (
    account.email ||
    account.displayName ||
    `${account.provider === "google" ? "Google" : account.provider} calendar`
  );
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
        new Date(b.scheduledStart).getTime() -
        new Date(a.scheduledStart).getTime(),
    );
  }
  return Array.from(groups.entries());
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

function formatTimeRange(meeting: Meeting): string {
  const start = formatTime(meeting.actualStart ?? meeting.scheduledStart);
  const end = formatTime(meeting.actualEnd ?? meeting.scheduledEnd);
  if (start && end) return `${start} - ${end}`;
  return start || end || "Recorded meeting";
}

function buildPreview(meeting: Meeting): string | null {
  const raw = meeting.summaryPreview || meeting.summaryMd || "";
  const plain = raw
    .replace(/[#*`>_~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain ? plain.slice(0, 180) : null;
}

function hasGeneratedNotes(meeting: Meeting): boolean {
  return Boolean(meeting.summaryMd?.trim() || meeting.userNotesMd?.trim());
}

function RecordedMeetingRow({ meeting }: { meeting: Meeting }) {
  const preview = buildPreview(meeting);
  const transcriptReady = meeting.transcriptStatus === "ready";
  const notesReady = hasGeneratedNotes(meeting);

  return (
    <NavLink
      to={`/meetings/${meeting.id}`}
      className="group flex items-start gap-4 rounded-md border border-border/70 bg-background px-4 py-3 transition-colors hover:border-foreground/20 hover:bg-accent/20 focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-accent/30 text-muted-foreground">
        <IconCalendar className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {meeting.title || "Untitled meeting"}
          </h3>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatTimeRange(meeting)}
          </span>
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {preview || "No summary yet"}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          {transcriptReady ? (
            <span className="inline-flex items-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300">
              <IconCheck className="h-3 w-3" />
              Transcript
            </span>
          ) : (
            <span className="rounded border border-border px-1.5 py-0.5">
              Transcript pending
            </span>
          )}
          {notesReady ? (
            <span className="inline-flex items-center gap-1 rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
              <IconNotes className="h-3 w-3" />
              Notes
            </span>
          ) : (
            <span className="rounded border border-border px-1.5 py-0.5">
              Notes pending
            </span>
          )}
        </div>
      </div>
    </NavLink>
  );
}

function RecordedMeetingsList({ meetings }: { meetings: Meeting[] }) {
  if (meetings.length === 0) return null;
  const groups = groupByDay(meetings);
  return (
    <section className="space-y-4">
      <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground/80 px-1">
        Past recordings
      </h2>
      {groups.map(([day, items]) => (
        <div key={day} className="space-y-2">
          <DayHeader label={day} />
          <div className="space-y-2">
            {items.map((m) => (
              <RecordedMeetingRow key={m.id} meeting={m} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function UpcomingMeetingsList({ meetings }: { meetings: Meeting[] }) {
  if (meetings.length === 0) return null;
  const groups = groupByDay(meetings);
  return (
    <section className="space-y-4">
      <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground/80 px-1">
        Upcoming
      </h2>
      {groups.map(([day, items]) => (
        <div key={day} className="space-y-2">
          <DayHeader label={day} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((m) => (
              <UpcomingMeetingCard key={m.id} meeting={m} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function UpcomingMeetingsLoading() {
  return (
    <section className="space-y-4">
      <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground/80 px-1">
        Upcoming
      </h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <MeetingCardSkeleton key={i} />
        ))}
      </div>
    </section>
  );
}

function CalendarReauthBanner({ onReconnect }: { onReconnect: () => void }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-300">
      <IconAlertTriangle className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">
        Google Calendar needs to be reconnected to keep showing your upcoming
        meetings.
      </span>
      <Button
        size="sm"
        variant="outline"
        onClick={onReconnect}
        className="h-8 gap-1.5 cursor-pointer"
      >
        <IconExternalLink className="h-3.5 w-3.5" />
        Reconnect
      </Button>
    </div>
  );
}

function RecordedMeetingSkeleton() {
  return (
    <div className="rounded-md border border-border/70 bg-background px-4 py-3">
      <div className="flex items-start gap-4">
        <div className="h-8 w-8 rounded-md bg-muted animate-pulse" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex justify-between gap-4">
            <div className="h-4 w-2/5 rounded bg-muted animate-pulse" />
            <div className="h-3 w-24 rounded bg-muted/70 animate-pulse" />
          </div>
          <div className="h-3 w-full rounded bg-muted/70 animate-pulse" />
          <div className="h-3 w-4/5 rounded bg-muted/70 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

function CalendarConnectionAction({
  label,
  onConnected,
  variant = "default",
}: {
  label: string;
  onConnected?: () => void | Promise<void>;
  variant?: "default" | "outline" | "secondary";
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleConnect = () => {
    setError(null);
    setPending(true);
    startCalendarOAuth()
      .then(() => onConnected?.())
      .then(() => setPending(false))
      .catch((e: Error) => {
        setError(e.message);
        setPending(false);
      });
  };

  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant={variant}
        onClick={handleConnect}
        disabled={pending}
        className="gap-1.5 cursor-pointer"
      >
        {pending ? <IconLoader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {label}
        <IconExternalLink className="h-3.5 w-3.5" />
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ConnectCalendarEmptyState({
  onConnected,
}: {
  onConnected?: () => void | Promise<void>;
}) {
  return (
    <div className="max-w-xl mx-auto mt-12">
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
              Get a desktop reminder when meetings start so recorded notes land
              in this history automatically.
            </p>
            <div className="mt-3">
              <CalendarConnectionAction
                label="Connect Google Calendar"
                onConnected={onConnected}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CalendarAccountMenu({
  accounts,
  onConnected,
  onDisconnected,
}: {
  accounts: CalendarAccount[];
  onConnected?: () => void | Promise<void>;
  onDisconnected?: () => void;
}) {
  const [connectPending, setConnectPending] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [disconnectTarget, setDisconnectTarget] =
    useState<CalendarAccount | null>(null);

  const primaryAccount = accounts[0] ?? null;
  const statusText =
    primaryAccount?.status === "disconnected"
      ? "Disconnected"
      : primaryAccount?.status === "needs-reauth"
        ? "Needs reconnect"
        : primaryAccount
          ? "Connected"
          : "Not connected";

  const handleReconnect = () => {
    setConnectPending(true);
    startCalendarOAuth()
      .then(() => onConnected?.())
      .then(() => {
        setConnectPending(false);
      })
      .catch((err: Error) => {
        setConnectPending(false);
        toast.error(err.message);
      });
  };

  const handleDisconnect = async () => {
    if (!disconnectTarget) return;
    setDisconnectingId(disconnectTarget.id);
    try {
      await requestDisconnectCalendar(disconnectTarget.id);
      toast.success("Calendar disconnected");
      setDisconnectTarget(null);
      onDisconnected?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't disconnect calendar",
      );
    } finally {
      setDisconnectingId(null);
    }
  };

  return (
    <AlertDialog
      open={!!disconnectTarget}
      onOpenChange={(open) => {
        if (!open && !disconnectingId) setDisconnectTarget(null);
      }}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="h-8 shrink-0 gap-1.5 cursor-pointer"
            aria-label="Calendar settings"
          >
            <IconSettings className="h-4 w-4" />
            Calendar
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="flex items-center gap-2">
            {primaryAccount ? (
              <IconPlugConnected className="h-4 w-4 text-muted-foreground" />
            ) : (
              <IconPlugOff className="h-4 w-4 text-muted-foreground" />
            )}
            Google Calendar
          </DropdownMenuLabel>
          <div className="px-2 pb-1 text-xs text-muted-foreground">
            {primaryAccount ? (
              <>
                <div className="truncate">
                  {calendarAccountLabel(primaryAccount)}
                </div>
                <div>{statusText}</div>
              </>
            ) : (
              "Connect Google Calendar for meeting reminders."
            )}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              handleReconnect();
            }}
            disabled={connectPending}
          >
            {connectPending ? (
              <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <IconExternalLink className="mr-2 h-4 w-4" />
            )}
            {primaryAccount ? "Reconnect calendar" : "Connect calendar"}
          </DropdownMenuItem>
          {accounts.length > 0 && (
            <>
              <DropdownMenuSeparator />
              {accounts.map((account) => (
                <DropdownMenuItem
                  key={account.id}
                  onSelect={(event) => {
                    event.preventDefault();
                    setDisconnectTarget(account);
                  }}
                  className="text-destructive focus:text-destructive"
                >
                  <IconPlugOff className="mr-2 h-4 w-4" />
                  Disconnect {calendarAccountLabel(account)}
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect Google Calendar?</AlertDialogTitle>
          <AlertDialogDescription>
            Clips will stop reading events from{" "}
            {disconnectTarget
              ? calendarAccountLabel(disconnectTarget)
              : "this account"}
            . You can reconnect it again from the Meetings page.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={!!disconnectingId}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void handleDisconnect();
            }}
            disabled={!!disconnectingId}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {disconnectingId ? "Disconnecting..." : "Disconnect"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function MeetingsHeader({
  query,
  onQueryChange,
  showDesktopCta,
  calendarAccounts,
  onConnected,
  onDisconnected,
}: {
  query: string;
  onQueryChange: (next: string) => void;
  showDesktopCta: boolean;
  calendarAccounts: CalendarAccount[];
  onConnected?: () => void | Promise<void>;
  onDisconnected?: () => void;
}) {
  return (
    <>
      <PageHeader>
        <h1 className="text-base font-semibold tracking-tight truncate">
          Meetings
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <CalendarAccountMenu
            accounts={calendarAccounts}
            onConnected={onConnected}
            onDisconnected={onDisconnected}
          />
        </div>
      </PageHeader>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-4">
          <p className="text-sm text-muted-foreground">
            Upcoming calendar meetings and your recorded notes.
          </p>
          <div className="relative max-w-sm">
            <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search meetings..."
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
        {showDesktopCta && (
          <div className="flex w-fit shrink-0 flex-col items-start gap-1 sm:items-end">
            <CaptureInstallButton
              size="sm"
              variant="secondary"
              className="h-8 w-fit gap-1.5 cursor-pointer"
            >
              <IconAppWindow className="h-4 w-4" />
              Get desktop app
            </CaptureInstallButton>
            <p className="max-w-56 text-[11px] leading-snug text-muted-foreground">
              Required for meeting reminders and transcription.
            </p>
          </div>
        )}
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

  // Debounce 200ms — keep URL in sync for shareability. Use the functional
  // updater so we read the latest params (not a stale closure) and never
  // clobber an unrelated param another effect changed concurrently.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(query);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (query) next.set("q", query);
          else next.delete("q");
          return next;
        },
        { replace: true },
      );
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const queryClient = useQueryClient();
  const { shouldShowSidebarLink: showDesktopCta } = useDesktopPromo();

  const accounts = useActionQuery<{ accounts: CalendarAccount[] } | undefined>(
    "list-calendar-accounts",
    {},
    { retry: false },
  );
  const meetingsQuery = useActionQuery<
    { meetings: Meeting[] } | Meeting[] | undefined
  >(
    "list-meetings",
    { view: "past", recordedOnly: true, includeLiveCalendar: false },
    { retry: false },
  );
  // Upcoming calendar events, read live from connected calendars. This is the
  // Granola-style surface that lets the user record/join a meeting that's about
  // to start. Poll every 30s so a freshly-added calendar event (or one moving
  // into the "now" window) shows up without a manual refresh.
  const upcomingQuery = useActionQuery<ListMeetingsResponse | undefined>(
    "list-meetings",
    { view: "upcoming", includeLiveCalendar: true, limit: 50 },
    { retry: false, refetchInterval: 30_000 },
  );

  const clearCalendarConnectionWarnings = useCallback(() => {
    queryClient.setQueriesData<{ accounts: CalendarAccount[] } | undefined>(
      { queryKey: ["action", "list-calendar-accounts"] },
      (prev) => {
        if (!prev?.accounts) return prev;
        const connectedAt = new Date().toISOString();
        return {
          ...prev,
          accounts: prev.accounts.map((account) => ({
            ...account,
            status: "connected",
            lastSyncError: null,
            lastSyncedAt: account.lastSyncedAt ?? connectedAt,
          })),
        };
      },
    );
    queryClient.setQueriesData<any>(
      { queryKey: ["action", "list-meetings"] },
      (prev: any) => {
        if (!prev || Array.isArray(prev)) return prev;
        return { ...prev, calendarErrors: [] };
      },
    );
  }, [queryClient]);

  // After the OAuth popup closes, poll the account action briefly. The
  // callback writes `calendar_accounts` just before the popup closes, but the
  // browser can observe the close before React Query has seen the new row.
  const handleCalendarConnected = useCallback(async () => {
    clearCalendarConnectionWarnings();
    try {
      let connected = false;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const result = await accounts.refetch();
        connected = (result.data?.accounts?.length ?? 0) > 0;
        if (connected) break;
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
      await meetingsQuery.refetch();
      if (connected) toast.success("Calendar connected");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't refresh your calendar",
      );
    } finally {
      queryClient.invalidateQueries({
        queryKey: ["action", "list-calendar-accounts"],
      });
      queryClient.invalidateQueries({
        queryKey: ["action", "list-meetings"],
      });
    }
  }, [accounts, clearCalendarConnectionWarnings, meetingsQuery, queryClient]);

  const meetings: Meeting[] = useMemo(() => {
    const data = meetingsQuery.data;
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return data.meetings ?? [];
  }, [meetingsQuery.data]);

  const upcomingMeetings: Meeting[] = useMemo(() => {
    const data = upcomingQuery.data;
    if (!data) return [];
    if (Array.isArray(data)) return data as Meeting[];
    return data.meetings ?? [];
  }, [upcomingQuery.data]);

  const calendarErrors: CalendarFetchError[] = useMemo(() => {
    const data = upcomingQuery.data;
    if (!data || Array.isArray(data)) return [];
    return data.calendarErrors ?? [];
  }, [upcomingQuery.data]);

  const calendarAccounts = accounts.data?.accounts ?? [];
  const hasCalendar = calendarAccounts.length > 0;

  const handleCalendarDisconnected = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ["action", "list-meetings"],
    });
    queryClient.invalidateQueries({
      queryKey: ["action", "list-calendar-accounts"],
    });
  }, [queryClient]);

  const handleReconnectCalendar = useCallback(() => {
    startCalendarOAuth()
      .then(() => handleCalendarConnected())
      .catch((err: Error) =>
        toast.error(err.message || "Couldn't reconnect calendar"),
      );
  }, [handleCalendarConnected]);

  const isLoading = accounts.isLoading || meetingsQuery.isLoading;

  const calendarLoadError = accounts.isError
    ? "Couldn't check your calendar connection. Try again in a moment."
    : meetingsQuery.isError
      ? "Couldn't load meetings. Try again in a moment."
      : null;

  const recordedMeetings = useMemo(() => {
    const filtered = meetings.filter((m) => meetingMatches(m, debouncedQuery));
    filtered.sort(
      (a, b) =>
        new Date(b.scheduledStart).getTime() -
        new Date(a.scheduledStart).getTime(),
    );
    return filtered;
  }, [meetings, debouncedQuery]);

  const filteredUpcoming = useMemo(() => {
    const filtered = upcomingMeetings.filter((m) =>
      meetingMatches(m, debouncedQuery),
    );
    filtered.sort(
      (a, b) =>
        new Date(a.scheduledStart).getTime() -
        new Date(b.scheduledStart).getTime(),
    );
    return filtered;
  }, [upcomingMeetings, debouncedQuery]);

  // A calendar can need re-auth either via a live fetch error (calendarErrors)
  // or — more commonly — because list-meetings skips non-"connected" accounts
  // entirely, so the only signal is the account's own status. Cover both.
  const needsCalendarReauth =
    calendarErrors.some((e) => e.needsReauth) ||
    calendarAccounts.some((a: any) => a.status === "needs-reauth");

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
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <RecordedMeetingSkeleton key={i} />
            ))}
          </div>
        </div>
      </>
    );
  }

  if (calendarLoadError) {
    return (
      <>
        <PageHeader>
          <h1 className="text-base font-semibold tracking-tight truncate">
            Meetings
          </h1>
        </PageHeader>
        <div className="p-6 max-w-2xl mx-auto w-full">
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {calendarLoadError}
          </div>
        </div>
      </>
    );
  }

  const nothingAtAll = meetings.length === 0 && upcomingMeetings.length === 0;

  if (!hasCalendar && nothingAtAll) {
    return (
      <div className="p-6 w-full">
        <MeetingsHeader
          query={query}
          onQueryChange={setQuery}
          showDesktopCta={showDesktopCta}
          calendarAccounts={calendarAccounts}
          onConnected={handleCalendarConnected}
          onDisconnected={handleCalendarDisconnected}
        />
        <ConnectCalendarEmptyState onConnected={handleCalendarConnected} />
      </div>
    );
  }

  const hasPast = recordedMeetings.length > 0;
  const hasUpcoming = filteredUpcoming.length > 0;
  const upcomingLoading =
    upcomingQuery.isLoading && upcomingMeetings.length === 0 && hasCalendar;
  const noSearchMatches =
    !!debouncedQuery && !hasPast && !hasUpcoming && !nothingAtAll;

  return (
    <div className="p-6 max-w-6xl mx-auto w-full">
      <MeetingsHeader
        query={query}
        onQueryChange={setQuery}
        showDesktopCta={showDesktopCta}
        calendarAccounts={calendarAccounts}
        onConnected={handleCalendarConnected}
        onDisconnected={handleCalendarDisconnected}
      />

      {needsCalendarReauth && (
        <CalendarReauthBanner onReconnect={handleReconnectCalendar} />
      )}

      {nothingAtAll ? (
        <div className="rounded-lg border border-dashed border-border bg-accent/20 px-6 py-16 text-center">
          <IconCalendar className="h-10 w-10 text-muted-foreground/50 mx-auto" />
          <p className="mt-3 text-sm text-foreground font-medium">
            No meetings yet
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Upcoming calendar meetings show up here, and finished recordings
            land here once you take notes.
          </p>
        </div>
      ) : noSearchMatches ? (
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
          {upcomingLoading ? (
            <UpcomingMeetingsLoading />
          ) : (
            <UpcomingMeetingsList meetings={filteredUpcoming} />
          )}
          <RecordedMeetingsList meetings={recordedMeetings} />
        </div>
      )}

      {(meetingsQuery.isFetching || upcomingQuery.isFetching) && !isLoading && (
        <div className="flex items-center justify-center mt-6 text-xs text-muted-foreground gap-1.5">
          <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
          Refreshing…
        </div>
      )}
    </div>
  );
}
