import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconAppWindow,
  IconCalendar,
  IconCalendarOff,
  IconExternalLink,
  IconLoader2,
  IconPlugConnected,
  IconPlugOff,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconX,
} from "@tabler/icons-react";
import { agentNativePath, useActionQuery } from "@agent-native/core/client";
import { useDesktopPromo } from "@/hooks/use-desktop-promo";
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
  displayName?: string | null;
  email?: string | null;
  status?: "connected" | "needs-reauth" | "disconnected" | string;
  lastSyncedAt?: string | null;
  lastSyncError?: string | null;
}

interface CalendarFetchError {
  accountId: string;
  error: string;
  needsReauth?: boolean;
}

type CalendarIssueKind = "reauth" | "fetch-error";

interface CalendarIssue {
  kind: CalendarIssueKind;
  title: string;
  description: string;
  detail?: string | null;
  account?: CalendarAccount;
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
    const interval = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(interval);
        resolve();
      }
    }, 500);
  });
}

function cleanCalendarError(message?: string | null): string | null {
  const clean = (message ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (clean === "needs-reauth") {
    return "Google Calendar needs to be reconnected.";
  }
  return clean.length > 180 ? `${clean.slice(0, 177)}...` : clean;
}

function calendarAccountLabel(account: CalendarAccount): string {
  return (
    account.email ||
    account.displayName ||
    `${account.provider === "google" ? "Google" : account.provider} calendar`
  );
}

function getCalendarIssue(
  accounts: CalendarAccount[],
  liveErrors: CalendarFetchError[],
): CalendarIssue | null {
  const reauthAccount = accounts.find((a) => a.status === "needs-reauth");
  if (reauthAccount) {
    const label = calendarAccountLabel(reauthAccount);
    return {
      kind: "reauth",
      account: reauthAccount,
      title: "Reconnect Google Calendar",
      description: `Clips cannot read ${label} until the calendar connection is refreshed.`,
      detail: cleanCalendarError(reauthAccount.lastSyncError),
    };
  }

  const erroredAccount = accounts.find((a) => !!a.lastSyncError);
  if (erroredAccount) {
    const label = calendarAccountLabel(erroredAccount);
    return {
      kind: "fetch-error",
      account: erroredAccount,
      title: "Calendar connection needs attention",
      description: `Clips could not read events from ${label}. Reconnect the calendar if this keeps happening.`,
      detail: cleanCalendarError(erroredAccount.lastSyncError),
    };
  }

  const liveError = liveErrors[0];
  if (liveError) {
    const account = accounts.find((a) => a.id === liveError.accountId);
    const label = account ? calendarAccountLabel(account) : "Google Calendar";
    return {
      kind: "fetch-error",
      account,
      title: liveError.needsReauth
        ? "Reconnect Google Calendar"
        : "Calendar connection needs attention",
      description: `Clips could not read events from ${label}.`,
      detail: cleanCalendarError(liveError.error),
    };
  }

  return null;
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
              See your upcoming meetings, get a notification a few minutes
              before, and one-click record + transcribe.
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
    primaryAccount?.status === "needs-reauth"
      ? "Needs reconnect"
      : primaryAccount?.lastSyncError
        ? "Connection issue"
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
              "Connect Google Calendar to populate meetings."
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

function CalendarConnectionIssue({
  issue,
  onRetry,
  retryPending,
  onConnected,
}: {
  issue: CalendarIssue;
  onRetry: () => void;
  retryPending: boolean;
  onConnected?: () => void | Promise<void>;
}) {
  const shouldShowRetry = issue.kind !== "reauth";
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <IconAlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">
              {issue.title}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {issue.description}
            </p>
            {issue.detail && (
              <p className="mt-2 rounded-md border border-amber-500/20 bg-background/70 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
                {issue.detail}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
          {shouldShowRetry && (
            <Button
              size="sm"
              variant="outline"
              onClick={onRetry}
              disabled={retryPending}
              className="gap-1.5 cursor-pointer"
            >
              <IconRefresh
                className={`h-3.5 w-3.5 ${retryPending ? "animate-spin" : ""}`}
              />
              {retryPending ? "Refreshing..." : "Try again"}
            </Button>
          )}
          <CalendarConnectionAction
            label={
              issue.kind === "reauth"
                ? "Reconnect Google Calendar"
                : "Reconnect"
            }
            variant={issue.kind === "reauth" ? "default" : "outline"}
            onConnected={onConnected}
          />
        </div>
      </div>
    </div>
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
        {showDesktopCta && (
          <div className="flex w-fit shrink-0 flex-col items-start gap-1 sm:items-end">
            <Button
              asChild
              size="sm"
              variant="secondary"
              className="h-8 w-fit gap-1.5 cursor-pointer"
            >
              <NavLink to="/download">
                <IconAppWindow className="h-4 w-4" />
                Get desktop app
              </NavLink>
            </Button>
            <p className="max-w-56 text-[11px] leading-snug text-muted-foreground">
              Required for meeting reminders and recording.
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

  const queryClient = useQueryClient();
  const { shouldShowSidebarLink: showDesktopCta } = useDesktopPromo();
  const [refreshPending, setRefreshPending] = useState(false);

  const accounts = useActionQuery<{ accounts: CalendarAccount[] } | undefined>(
    "list-calendar-accounts",
    {},
    { retry: false },
  );
  const meetingsQuery = useActionQuery<
    | { meetings: Meeting[]; calendarErrors?: CalendarFetchError[] }
    | Meeting[]
    | undefined
  >("list-meetings", { view: "all" }, { retry: false });

  const refreshCalendarData = useCallback(async () => {
    setRefreshPending(true);
    try {
      await Promise.all([accounts.refetch(), meetingsQuery.refetch()]);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't refresh your calendar",
      );
    } finally {
      setRefreshPending(false);
    }
  }, [accounts, meetingsQuery]);

  // After the OAuth popup closes, poll the account action briefly. The
  // callback writes `calendar_accounts` just before the popup closes, but the
  // browser can observe the close before React Query has seen the new row.
  const handleCalendarConnected = useCallback(async () => {
    setRefreshPending(true);
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
      setRefreshPending(false);
    }
  }, [accounts, meetingsQuery]);

  const meetings: Meeting[] = useMemo(() => {
    const data = meetingsQuery.data;
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return data.meetings ?? [];
  }, [meetingsQuery.data]);
  const calendarErrors: CalendarFetchError[] = useMemo(() => {
    const data = meetingsQuery.data;
    if (!data || Array.isArray(data)) return [];
    return data.calendarErrors ?? [];
  }, [meetingsQuery.data]);

  const calendarAccounts = accounts.data?.accounts ?? [];
  const hasCalendar = calendarAccounts.length > 0;
  const calendarIssue = useMemo(
    () => getCalendarIssue(calendarAccounts, calendarErrors),
    [calendarAccounts, calendarErrors],
  );

  const handleRetryCalendarFetch = useCallback(() => {
    void refreshCalendarData();
  }, [refreshCalendarData]);

  const handleCalendarDisconnected = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ["action", "list-meetings"],
    });
    queryClient.invalidateQueries({
      queryKey: ["action", "list-calendar-accounts"],
    });
  }, [queryClient]);

  const isLoading = accounts.isLoading || meetingsQuery.isLoading;

  const calendarLoadError = accounts.isError
    ? "Couldn't check your calendar connection. Try again in a moment."
    : meetingsQuery.isError
      ? "Couldn't load meetings. Try again in a moment."
      : null;

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

  if (!hasCalendar && meetings.length === 0) {
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

  const hasResults = upcoming.length + past.length > 0;

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

      {calendarIssue && meetings.length > 0 && (
        <div className="mb-4">
          <CalendarConnectionIssue
            issue={calendarIssue}
            onRetry={handleRetryCalendarFetch}
            retryPending={refreshPending}
            onConnected={handleCalendarConnected}
          />
        </div>
      )}

      {meetings.length === 0 ? (
        calendarIssue ? (
          <CalendarConnectionIssue
            issue={calendarIssue}
            onRetry={handleRetryCalendarFetch}
            retryPending={refreshPending}
            onConnected={handleCalendarConnected}
          />
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-accent/20 px-6 py-16 text-center">
            <IconCalendarOff className="h-10 w-10 text-muted-foreground/50 mx-auto" />
            <p className="mt-3 text-sm text-foreground font-medium">
              No calendar meetings
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Clips reads directly from Google Calendar. New events appear here
              automatically.
            </p>
          </div>
        )
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
