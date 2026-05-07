import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconAppWindow,
  IconCalendar,
  IconCalendarOff,
  IconExternalLink,
  IconKey,
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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

interface SyncCalendarsResult {
  synced?: number;
  events?: number;
  meetings?: number;
  errors?: Array<{ accountId: string; error: string }>;
}

type CalendarIssueKind = "reauth" | "sync-error" | "not-synced" | "empty-feed";

interface CalendarIssue {
  kind: CalendarIssueKind;
  title: string;
  description: string;
  detail?: string | null;
  account?: CalendarAccount;
}

function unwrapActionResult<T>(data: unknown): T {
  if (data && typeof data === "object" && "result" in data) {
    return (data as { result: T }).result;
  }
  return data as T;
}

async function requestCalendarSync(): Promise<SyncCalendarsResult> {
  const r = await fetch(
    agentNativePath("/_agent-native/actions/sync-calendars"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  const text = await r.text().catch(() => "");
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    // Keep the fallback below.
  }
  if (!r.ok) {
    const parsed = payload as { error?: string };
    throw new Error(parsed.error || `Sync failed (${r.status})`);
  }
  return unwrapActionResult<SyncCalendarsResult>(payload) ?? {};
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

async function startCalendarOAuth(onClosed?: () => void): Promise<void> {
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
        onClosed?.();
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

function summarizeSyncErrors(result: SyncCalendarsResult): string | null {
  const errors = result.errors?.filter((e) => e.error) ?? [];
  if (errors.length === 0) return null;
  const first = cleanCalendarError(errors[0]?.error);
  if (!first) return "Calendar sync failed.";
  if (errors.length === 1) return first;
  return `${first} ${errors.length} calendars need attention.`;
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
  meetingCount: number,
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
      kind: "sync-error",
      account: erroredAccount,
      title: "Calendar sync needs attention",
      description: `Clips could not finish syncing ${label}. Your meetings may be out of date.`,
      detail: cleanCalendarError(erroredAccount.lastSyncError),
    };
  }

  const unsyncedAccount =
    meetingCount === 0
      ? accounts.find((a) => a.status !== "disconnected" && !a.lastSyncedAt)
      : null;
  if (unsyncedAccount) {
    const label = calendarAccountLabel(unsyncedAccount);
    return {
      kind: "not-synced",
      account: unsyncedAccount,
      title: "Calendar has not synced yet",
      description: `Run a sync to pull upcoming events from ${label}.`,
    };
  }

  const connectedAccount =
    meetingCount === 0
      ? (accounts.find((a) => a.status === "connected") ?? accounts[0])
      : null;
  if (connectedAccount) {
    const label = calendarAccountLabel(connectedAccount);
    return {
      kind: "empty-feed",
      account: connectedAccount,
      title: "No synced calendar meetings",
      description: `Clips is connected to ${label}, but no Google Calendar events have appeared here yet.`,
      detail:
        "Sync again, or reconnect the calendar if Google Calendar has upcoming events that Clips should show.",
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
  onConnected?: () => void;
  variant?: "default" | "outline" | "secondary";
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleConnect = () => {
    setError(null);
    setPending(true);
    startCalendarOAuth(() => void onConnected?.())
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
  onConnected?: () => void;
}) {
  // Mirrors ConnectBuilderCard layout: prominent CTA card, secondary
  // "Add API key" disclosure underneath.
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
              <CalendarConnectionAction
                label="Connect Google Calendar"
                onConnected={onConnected}
              />
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

function CalendarAccountMenu({
  accounts,
  onRetrySync,
  retryPending,
  onConnected,
  onDisconnected,
}: {
  accounts: CalendarAccount[];
  onRetrySync: () => void;
  retryPending: boolean;
  onConnected?: () => void;
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
        ? "Sync issue"
        : primaryAccount
          ? "Connected"
          : "Not connected";

  const handleReconnect = () => {
    setConnectPending(true);
    startCalendarOAuth(() => void onConnected?.())
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
              onRetrySync();
            }}
            disabled={!primaryAccount || retryPending}
          >
            <IconRefresh
              className={`mr-2 h-4 w-4 ${retryPending ? "animate-spin" : ""}`}
            />
            {retryPending ? "Syncing calendar..." : "Sync now"}
          </DropdownMenuItem>
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
            Clips will stop syncing meetings from{" "}
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
  onRetrySync,
  retryPending,
  onConnected,
}: {
  issue: CalendarIssue;
  onRetrySync: () => void;
  retryPending: boolean;
  onConnected?: () => void;
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
              onClick={onRetrySync}
              disabled={retryPending}
              className="gap-1.5 cursor-pointer"
            >
              <IconRefresh
                className={`h-3.5 w-3.5 ${retryPending ? "animate-spin" : ""}`}
              />
              {retryPending ? "Syncing..." : "Retry sync"}
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
  onRetrySync,
  retryPending,
  onConnected,
  onDisconnected,
}: {
  query: string;
  onQueryChange: (next: string) => void;
  showDesktopCta: boolean;
  calendarAccounts: CalendarAccount[];
  onRetrySync: () => void;
  retryPending: boolean;
  onConnected?: () => void;
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
            onRetrySync={onRetrySync}
            retryPending={retryPending}
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
          <Button
            asChild
            size="sm"
            variant="secondary"
            className="h-8 w-fit shrink-0 gap-1.5 cursor-pointer"
          >
            <NavLink to="/download">
              <IconAppWindow className="h-4 w-4" />
              Get desktop app
            </NavLink>
          </Button>
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
  const [syncPending, setSyncPending] = useState(false);

  const accounts = useActionQuery<{ accounts: CalendarAccount[] } | undefined>(
    "list-calendar-accounts",
    {},
    { retry: false },
  );
  const meetingsQuery = useActionQuery<
    { meetings: Meeting[] } | Meeting[] | undefined
  >("list-meetings", { view: "all" }, { retry: false });

  const runCalendarSync = useCallback(
    async ({
      showSuccessToast = false,
    }: { showSuccessToast?: boolean } = {}) => {
      setSyncPending(true);
      try {
        const result = await requestCalendarSync();
        const syncError = summarizeSyncErrors(result);
        if (syncError) throw new Error(syncError);
        if (showSuccessToast) {
          toast.success(
            result.events
              ? `Synced ${result.events} calendar event${
                  result.events === 1 ? "" : "s"
                }`
              : "Calendar sync completed",
          );
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't sync your calendar",
        );
      } finally {
        setSyncPending(false);
        queryClient.invalidateQueries({
          queryKey: ["action", "list-meetings"],
        });
        queryClient.invalidateQueries({
          queryKey: ["action", "list-calendar-accounts"],
        });
      }
    },
    [queryClient],
  );

  // After the OAuth popup closes, refetch accounts, kick off a sync, and
  // refetch meetings so the page updates without requiring a manual refresh.
  const handleCalendarConnected = useCallback(async () => {
    queryClient.invalidateQueries({
      queryKey: ["action", "list-calendar-accounts"],
    });
    await runCalendarSync();
  }, [queryClient, runCalendarSync]);

  const meetings: Meeting[] = useMemo(() => {
    const data = meetingsQuery.data;
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return data.meetings ?? [];
  }, [meetingsQuery.data]);

  const calendarAccounts = accounts.data?.accounts ?? [];
  const hasCalendar = calendarAccounts.length > 0;
  const calendarIssue = useMemo(
    () => getCalendarIssue(calendarAccounts, meetings.length),
    [calendarAccounts, meetings.length],
  );

  const handleRetryCalendarSync = useCallback(() => {
    void runCalendarSync({ showSuccessToast: true });
  }, [runCalendarSync]);

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
          onRetrySync={handleRetryCalendarSync}
          retryPending={syncPending}
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
        onRetrySync={handleRetryCalendarSync}
        retryPending={syncPending}
        onConnected={handleCalendarConnected}
        onDisconnected={handleCalendarDisconnected}
      />

      {calendarIssue && meetings.length > 0 && (
        <div className="mb-4">
          <CalendarConnectionIssue
            issue={calendarIssue}
            onRetrySync={handleRetryCalendarSync}
            retryPending={syncPending}
            onConnected={handleCalendarConnected}
          />
        </div>
      )}

      {meetings.length === 0 ? (
        calendarIssue ? (
          <CalendarConnectionIssue
            issue={calendarIssue}
            onRetrySync={handleRetryCalendarSync}
            retryPending={syncPending}
            onConnected={handleCalendarConnected}
          />
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-accent/20 px-6 py-16 text-center">
            <IconCalendarOff className="h-10 w-10 text-muted-foreground/50 mx-auto" />
            <p className="mt-3 text-sm text-foreground font-medium">
              No calendar meetings
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Clips pulls this list from Google Calendar. New synced calendar
              events will appear here automatically.
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
