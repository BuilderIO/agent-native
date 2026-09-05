import { agentNativePath } from "@agent-native/core/client/api-path";
import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertTriangle,
  IconCalendar,
  IconLoader2,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import { PageBreadcrumb, PageHeader } from "@/components/library/page-header";
import {
  AgendaCard,
  AgendaCardSkeleton,
} from "@/components/meetings/agenda-card";
import type { AttendeeStackParticipant } from "@/components/meetings/attendee-stack";
import {
  DayGroupedCard,
  groupByCalendarDay,
} from "@/components/meetings/day-grouped-card";
import {
  MeetingHistoryRow,
  MeetingHistoryRowSkeleton,
} from "@/components/meetings/meeting-history-row";
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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import enMessages from "@/i18n/en-US";
import { isCalendarConnectionComplete } from "@/lib/calendar-connection";
import {
  buildMeetingHistoryQuery,
  MEETING_HISTORY_PAGE_SIZE,
} from "@/lib/meeting-history-query";
import { shortcutLabel } from "@/lib/utils";

export function meta() {
  return [{ title: enMessages.meetingsRoute.pageTitle }];
}

type MeetingsTab = "agenda" | "past";

function isMeetingsTab(value: string | null): value is MeetingsTab {
  return value === "agenda" || value === "past";
}

interface Meeting {
  id: string;
  title: string;
  scheduledStart: string;
  scheduledEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  createdAt?: string | null;
  recordingId?: string | null;
  joinUrl?: string | null;
  platform?: string | null;
  transcriptStatus?:
    | "pending"
    | "ready"
    | "failed"
    | "in_progress"
    | (string & {})
    | null;
  summaryPreview?: string | null;
  summaryMd?: string | null;
  userNotesMd?: string | null;
  source?: "calendar" | "adhoc" | "manual";
  participants?: AttendeeStackParticipant[];
  ownerEmail?: string | null;
}

interface SearchMeetingResult extends Meeting {
  snippet?: string | null;
  matchType?: string;
}

interface CalendarFetchError {
  accountId: string;
  error: string;
  needsReauth: boolean;
}

interface ListMeetingsResponse {
  meetings?: Meeting[];
  calendarErrors?: CalendarFetchError[];
  hasMore?: boolean;
}

interface CalendarAccount {
  id: string;
  provider: "google" | "icloud" | "microsoft" | (string & {});
  displayName?: string | null;
  email?: string | null;
  status?: "connected" | "needs-reauth" | "disconnected" | (string & {});
  lastSyncedAt?: string | null;
  lastSyncError?: string | null;
}

type CalendarConnectHandler = (expectedAccountId?: string) => void;

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

interface CalendarOAuthResult {
  accountId: string;
}

async function startCalendarOAuth(
  expectedAccountId?: string,
): Promise<CalendarOAuthResult | null> {
  const flowId = window.crypto.randomUUID();
  const actionUrl = new URL(
    agentNativePath("/_agent-native/actions/connect-calendar"),
    window.location.origin,
  );
  actionUrl.searchParams.set("provider", "google");
  actionUrl.searchParams.set("flowId", flowId);
  if (expectedAccountId) {
    actionUrl.searchParams.set("calendarAccountId", expectedAccountId);
  }
  const r = await fetch(actionUrl);
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
  const authUrl = new URL(url, window.location.origin);
  const popupUrl = authUrl.toString();
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
  return await new Promise<CalendarOAuthResult | null>((resolve) => {
    let settled = false;
    const finish = (result: CalendarOAuthResult | null) => {
      if (settled) return;
      settled = true;
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("message", onMessage);
      resolve(result);
    };
    const interval = window.setInterval(() => {
      if (popup.closed) finish(null);
    }, 500);
    // Some browsers (COOP) never report popup.closed; also resolve when the
    // user returns to this tab, and give up after 5 minutes regardless so the
    // connect flow can't hang forever.
    const onFocus = () => {
      if (popup.closed) finish(null);
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== popup ||
        event.origin !== window.location.origin ||
        !event.data ||
        typeof event.data !== "object" ||
        event.data.type !== "agent-native:calendar-connected" ||
        event.data.flowId !== flowId ||
        typeof event.data.accountId !== "string"
      ) {
        return;
      }
      finish({ accountId: event.data.accountId });
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("message", onMessage);
    const timeout = window.setTimeout(() => finish(null), 5 * 60 * 1000);
  });
}

function calendarAccountLabel(account: CalendarAccount): string {
  return (
    account.email ||
    account.displayName ||
    `${account.provider === "google" ? "Google" : account.provider} calendar`
  );
}

// Manual/ad-hoc notes-only meetings admitted into the past view (see
// list-meetings' view='past' predicate) can have neither actualStart nor
// scheduledStart — createdAt is the only timestamp left to group and display
// them by.
function historyIso(m: Meeting): string {
  return m.actualStart ?? m.scheduledStart ?? m.createdAt ?? "";
}

function historyTimestampMs(m: Meeting): number {
  const ms = Date.parse(historyIso(m));
  return Number.isNaN(ms) ? 0 : ms;
}

// Per @shawnmcclelland's review on #2887: Past now shares the same
// day-column card shell as Agenda instead of a bare DayHeader label over a
// flat row list, so the two tabs read as one surface. The explicit sort
// comparator matters here too — the array can arrive sorted by a different
// field (list-meetings' merge path sorts by `scheduledStart ?? createdAt`,
// search-meetings doesn't guarantee this key either), so a meeting that
// started later than scheduled could otherwise land out of order within its day.
function MeetingHistoryList({
  meetings,
  snippets,
}: {
  meetings: Meeting[];
  snippets?: Map<string, string | null | undefined>;
}) {
  if (meetings.length === 0) return null;
  const days = groupByCalendarDay(
    meetings,
    historyIso,
    (a, b) => historyTimestampMs(b) - historyTimestampMs(a),
  );
  return (
    <DayGroupedCard
      groups={days}
      getIso={historyIso}
      renderRow={(m) => (
        <MeetingHistoryRow meeting={m} snippet={snippets?.get(m.id)} />
      )}
    />
  );
}

function CalendarReauthBanner({
  onReconnect,
  isPending,
}: {
  onReconnect: () => void;
  isPending: boolean;
}) {
  const t = useT();
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-300">
      <IconAlertTriangle className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">
        {t("meetingsRoute.calendarNeedsReconnect")}
      </span>
      <Button
        size="sm"
        variant="outline"
        onClick={onReconnect}
        disabled={isPending}
        aria-busy={isPending}
        className="h-8 cursor-pointer"
      >
        {isPending && <IconLoader2 className="h-3.5 w-3.5 animate-spin" />}
        Reconnect
      </Button>
    </div>
  );
}

function CalendarConnectionAction({
  label,
  onConnect,
  isPending,
  variant = "default",
}: {
  label: string;
  onConnect?: CalendarConnectHandler;
  isPending: boolean;
  variant?: "default" | "outline" | "secondary";
}) {
  return (
    <Button
      size="sm"
      variant={variant}
      onClick={() => onConnect?.()}
      disabled={isPending}
      aria-busy={isPending}
      className="cursor-pointer"
    >
      {isPending && <IconLoader2 className="h-3.5 w-3.5 animate-spin" />}
      {label}
    </Button>
  );
}

function ConnectCalendarEmptyState({
  onConnect,
  isPending,
}: {
  onConnect?: CalendarConnectHandler;
  isPending: boolean;
}) {
  const t = useT();
  return (
    <Empty className="min-h-[24rem] w-full rounded-none border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconCalendar />
        </EmptyMedia>
        <EmptyTitle>{t("meetingsRoute.connectGoogleCalendar")}</EmptyTitle>
        <EmptyDescription>
          {t("meetingsRoute.desktopReminder")}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <CalendarConnectionAction
          label={t("meetingsRoute.connectGoogleCalendar")}
          onConnect={onConnect}
          isPending={isPending}
        />
      </EmptyContent>
    </Empty>
  );
}

function CalendarAccountMenu({
  accounts,
  onConnect,
  onDisconnected,
  isBusy,
}: {
  accounts: CalendarAccount[];
  onConnect?: CalendarConnectHandler;
  onDisconnected?: () => void;
  isBusy: boolean;
}) {
  const t = useT();
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [disconnectTarget, setDisconnectTarget] =
    useState<CalendarAccount | null>(null);

  const reconnectAccountId = accounts.find(
    (account) => account.status === "needs-reauth",
  )?.id;

  const handleDisconnect = async () => {
    if (!disconnectTarget) return;
    setDisconnectingId(disconnectTarget.id);
    try {
      await requestDisconnectCalendar(disconnectTarget.id);
      toast.success(t("meetingsRoute.calendarDisconnected"));
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
            className="h-9 shrink-0 cursor-pointer px-2.5 font-medium"
            aria-label={t("meetingsRoute.calendarSettings")}
            aria-busy={isBusy}
            disabled={isBusy}
          >
            {isBusy ? (
              <Skeleton className="h-4 w-16" />
            ) : (
              <>
                <IconCalendar />
                <span className="hidden sm:inline">
                  {t("meetingsRoute.calendarAccountsButton", {
                    defaultValue: "Calendars",
                  })}
                </span>
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-80 max-w-[calc(100vw-2rem)] p-1.5"
        >
          <DropdownMenuLabel className="px-2.5 py-2 text-sm font-semibold text-foreground">
            Google Calendar {/* i18n-ignore -- stable provider name */}
          </DropdownMenuLabel>
          {accounts.length > 0 ? (
            <div className="flex flex-col gap-1.5 px-2.5 pb-1">
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                {t("meetingsRoute.connectedAccounts", {
                  defaultValue: "Connected accounts",
                })}
              </div>
              {accounts.map((account) => (
                <div
                  key={account.id}
                  className="flex min-w-0 items-center gap-3 rounded-md bg-muted/40 px-2.5 py-2 text-xs"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {calendarAccountLabel(account)}
                  </span>
                  <span
                    className={
                      account.status === "needs-reauth" ||
                      account.status === "disconnected"
                        ? "shrink-0 text-[11px] text-destructive"
                        : "shrink-0 text-[11px] text-muted-foreground"
                    }
                  >
                    {account.status === "needs-reauth"
                      ? t("meetingsRoute.calendarNeedsReconnectLabel", {
                          defaultValue: "Needs reconnect",
                        })
                      : account.status === "disconnected"
                        ? t("meetingsRoute.calendarDisconnectedLabel", {
                            defaultValue: "Disconnected",
                          })
                        : account.status && account.status !== "connected"
                          ? t("meetingsRoute.calendarStatusUnavailable", {
                              defaultValue: "Status unavailable",
                            })
                          : t("meetingsRoute.calendarConnectedLabel", {
                              defaultValue: "Connected",
                            })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-2.5 pb-1 text-xs text-muted-foreground">
              {t("meetingsRoute.connectCalendarReminder")}
            </div>
          )}
          <DropdownMenuSeparator />
          {reconnectAccountId && (
            <DropdownMenuItem
              onSelect={() => {
                onConnect?.(reconnectAccountId);
              }}
              className="px-2.5"
              disabled={isBusy}
            >
              {t("meetingsRoute.reconnectCalendar", {
                defaultValue: "Reconnect calendar",
              })}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => {
              onConnect?.();
            }}
            className="px-2.5"
            disabled={isBusy}
          >
            {accounts.length > 0
              ? t("meetingsRoute.addAnotherCalendarAccount", {
                  defaultValue: "Add another account",
                })
              : t("meetingsRoute.connectCalendar", {
                  defaultValue: "Connect calendar",
                })}
          </DropdownMenuItem>
          {accounts.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="px-2.5 text-xs text-muted-foreground">
                {t("meetingsRoute.disconnectCalendarAccount", {
                  defaultValue: "Disconnect an account",
                })}
              </DropdownMenuLabel>
              {accounts.map((account) => (
                <DropdownMenuItem
                  key={account.id}
                  onSelect={(event) => {
                    event.preventDefault();
                    setDisconnectTarget(account);
                  }}
                  className="px-2.5 text-destructive focus:text-destructive"
                >
                  Disconnect {calendarAccountLabel(account)}
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("meetingsRoute.disconnectGoogleCalendarTitle")}
          </AlertDialogTitle>
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
  calendarAccounts,
  onConnect,
  onDisconnected,
  isCalendarBusy,
}: {
  query: string;
  onQueryChange: (next: string) => void;
  calendarAccounts: CalendarAccount[];
  onConnect?: CalendarConnectHandler;
  onDisconnected?: () => void;
  isCalendarBusy: boolean;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName.toLowerCase();
      if (
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        tagName !== "input" &&
        tagName !== "textarea" &&
        !target?.isContentEditable
      ) {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <PageHeader>
      <div className="flex min-w-0 flex-1 items-center gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_24rem_minmax(0,1fr)]">
        <div className="hidden min-w-0 lg:block">
          <PageBreadcrumb label={t("meetingsRoute.title")} />
        </div>
        <div className="relative min-w-0 flex-1 lg:w-full">
          <IconSearch className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t("meetingsRoute.searchPlaceholder")}
            aria-label={t("meetingsRoute.searchPlaceholder")}
            className="h-9 ps-9 pe-12 text-sm focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 focus-visible:ring-offset-0 [appearance:textfield] [&::-webkit-search-cancel-button]:appearance-none"
          />
          {query ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => {
                onQueryChange("");
                inputRef.current?.focus();
              }}
              className="absolute end-1 top-1/2 size-7 -translate-y-1/2 text-muted-foreground hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:ring-offset-0"
              aria-label={t("meetingsRoute.clearSearch")}
            >
              <IconX className="size-3.5" />
            </Button>
          ) : (
            <Kbd
              aria-hidden="true"
              className="absolute end-1.5 top-1/2 h-5 -translate-y-1/2 px-1 font-mono text-[10px]"
            >
              {shortcutLabel("/")}
            </Kbd>
          )}
        </div>
        <div className="ms-auto flex items-center gap-2">
          <CalendarAccountMenu
            accounts={calendarAccounts}
            onConnect={onConnect}
            onDisconnected={onDisconnected}
            isBusy={isCalendarBusy}
          />
        </div>
      </div>
    </PageHeader>
  );
}

export default function MeetingsIndexRoute() {
  const t = useT();
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
  const trimmedQuery = debouncedQuery.trim();
  const isSearching = trimmedQuery.length > 0;

  // Tab lives in the URL so it survives reload, is linkable, and shows up in
  // navigation state for the agent — same treatment as `?q=`.
  const tabParam = searchParams.get("tab");
  const activeTab: MeetingsTab = isMeetingsTab(tabParam) ? tabParam : "agenda";
  const setActiveTab = useCallback(
    (next: string) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === "agenda") params.delete("tab");
          else params.set("tab", next);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const accounts = useActionQuery<{ accounts: CalendarAccount[] } | undefined>(
    "list-calendar-accounts",
    {},
    { retry: false },
  );

  // History is the page body: every past meeting that holds something worth
  // reopening, paged rather than capped. `hasContent` (not `recordedOnly`) is
  // what keeps desktop live notes without a linked recording in the list.
  const history = useInfiniteQuery({
    queryKey: ["action", "list-meetings", "history"],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      callAction("list-meetings", buildMeetingHistoryQuery(pageParam), {
        method: "GET",
        signal,
      }) as Promise<ListMeetingsResponse>,
    getNextPageParam: (lastPage, allPages) =>
      lastPage?.hasMore
        ? allPages.length * MEETING_HISTORY_PAGE_SIZE
        : undefined,
    retry: false,
  });

  // The agenda window, read live from connected calendars: 24h back through
  // the next 30 days, so a call from earlier today is still on your day rather
  // than already filed under Past. Poll every 30s so a freshly-added event (or
  // one crossing the "now" marker) shows up without a manual refresh.
  const agendaQuery = useActionQuery<ListMeetingsResponse | undefined>(
    "list-meetings",
    { view: "agenda", includeLiveCalendar: true, limit: 50 },
    { retry: false, refetchInterval: 30_000 },
  );

  // Title / summary / notes / attendee / transcript search, server-side. The
  // list-meetings pages only cover what has been scrolled to, so filtering
  // them client-side could never find an older call by what was said in it.
  const searchQuery = useActionQuery<
    { meetings: SearchMeetingResult[] } | undefined
  >(
    "search-meetings",
    { query: trimmedQuery, limit: 50 },
    { enabled: isSearching, retry: false },
  );

  // After the OAuth callback signals completion, poll briefly because the
  // browser can observe the callback before React Query sees the updated row.
  const [isRefreshingCalendar, setIsRefreshingCalendar] = useState(false);
  const [isCalendarConnectionInFlight, setIsCalendarConnectionInFlight] =
    useState(false);
  const calendarConnectionInFlightRef = useRef(false);
  const handleCalendarConnected = useCallback(
    async (completedAccountId: string, expectedAccountId?: string) => {
      setIsRefreshingCalendar(true);
      try {
        let connected = false;
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const result = await accounts.refetch();
          connected = isCalendarConnectionComplete(
            result.data?.accounts ?? [],
            completedAccountId,
            expectedAccountId,
          );
          if (connected) break;
          await new Promise((resolve) => window.setTimeout(resolve, 500));
        }
        if (connected) {
          await Promise.all([history.refetch(), agendaQuery.refetch()]);
          toast.success(t("meetingsRoute.calendarConnected"));
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't refresh your calendar",
        );
      } finally {
        setIsRefreshingCalendar(false);
        void queryClient.invalidateQueries({
          queryKey: ["action", "list-calendar-accounts"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["action", "list-meetings"],
        });
      }
    },
    [accounts, agendaQuery, history, queryClient, t],
  );

  const historyMeetings: Meeting[] = useMemo(
    () => (history.data?.pages ?? []).flatMap((page) => page?.meetings ?? []),
    [history.data],
  );

  const agendaMeetings: Meeting[] = useMemo(() => {
    const data = agendaQuery.data;
    if (!data) return [];
    if (Array.isArray(data)) return data as Meeting[];
    return data.meetings ?? [];
  }, [agendaQuery.data]);

  const calendarErrors: CalendarFetchError[] = useMemo(() => {
    const data = agendaQuery.data;
    if (!data || Array.isArray(data)) return [];
    return data.calendarErrors ?? [];
  }, [agendaQuery.data]);

  const searchResults = searchQuery.data?.meetings ?? [];
  const searchSnippets = useMemo(() => {
    const map = new Map<string, string | null | undefined>();
    for (const m of searchResults) map.set(m.id, m.snippet);
    return map;
  }, [searchResults]);

  const calendarAccounts: CalendarAccount[] = accounts.data?.accounts ?? [];
  const hasCalendar = calendarAccounts.length > 0;

  const handleCalendarDisconnected = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ["action", "list-meetings"],
    });
    void queryClient.invalidateQueries({
      queryKey: ["action", "list-calendar-accounts"],
    });
  }, [queryClient]);

  const handleStartCalendarOAuth = useCallback(
    (expectedAccountId?: string) => {
      if (calendarConnectionInFlightRef.current) return;
      calendarConnectionInFlightRef.current = true;
      setIsCalendarConnectionInFlight(true);
      void startCalendarOAuth(expectedAccountId)
        .then((result) => {
          if (result) {
            return handleCalendarConnected(result.accountId, expectedAccountId);
          }
        })
        .catch((err: Error) => toast.error(err.message))
        .finally(() => {
          calendarConnectionInFlightRef.current = false;
          setIsCalendarConnectionInFlight(false);
        });
    },
    [handleCalendarConnected],
  );

  const isLoading = accounts.isLoading || history.isLoading;

  const calendarLoadError = accounts.isError
    ? "Couldn't check your calendar connection. Try again in a moment."
    : history.isError
      ? "Couldn't load meetings. Try again in a moment."
      : null;

  const agendaSorted = useMemo(() => {
    return [...agendaMeetings].sort(
      (a, b) =>
        new Date(a.scheduledStart).getTime() -
        new Date(b.scheduledStart).getTime(),
    );
  }, [agendaMeetings]);

  // A calendar can need re-auth either via a live fetch error (calendarErrors)
  // or — more commonly — because list-meetings skips non-"connected" accounts
  // entirely, so the only signal is the account's own status. Cover both.
  const needsCalendarReauth =
    calendarErrors.some((e) => e.needsReauth) ||
    calendarAccounts.some((account) => account.status === "needs-reauth");
  const reconnectAccountId =
    calendarAccounts.find((account) => account.status === "needs-reauth")?.id ??
    calendarErrors.find((error) => error.needsReauth)?.accountId;
  const isCalendarBusy = isCalendarConnectionInFlight || isRefreshingCalendar;

  const nothingAtAll =
    historyMeetings.length === 0 && agendaMeetings.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MeetingsHeader
        query={query}
        onQueryChange={setQuery}
        calendarAccounts={calendarAccounts}
        onConnect={handleStartCalendarOAuth}
        onDisconnected={handleCalendarDisconnected}
        isCalendarBusy={isCalendarBusy || accounts.isLoading}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {isLoading ? (
          <div
            className="flex min-h-full w-full flex-col gap-4 p-5"
            aria-busy="true"
          >
            <Skeleton className="h-9 w-52" />
            <AgendaCardSkeleton />
            <div className="mt-4 space-y-1">
              {Array.from({ length: 8 }).map((_, i) => (
                <MeetingHistoryRowSkeleton key={i} />
              ))}
            </div>
          </div>
        ) : calendarLoadError ? (
          <div className="flex min-h-full w-full flex-1 items-start p-5">
            <div className="w-full rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {calendarLoadError}
            </div>
          </div>
        ) : !hasCalendar && nothingAtAll && !isSearching ? (
          <div className="flex min-h-full w-full flex-1 p-5">
            <ConnectCalendarEmptyState
              onConnect={handleStartCalendarOAuth}
              isPending={isCalendarBusy}
            />
          </div>
        ) : (
          <div className="flex min-h-full w-full flex-1 flex-col p-5">
            {needsCalendarReauth && (
              <CalendarReauthBanner
                onReconnect={() => handleStartCalendarOAuth(reconnectAccountId)}
                isPending={isCalendarBusy}
              />
            )}

            {isSearching ? (
              searchQuery.isLoading ? (
                <div className="space-y-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <MeetingHistoryRowSkeleton key={i} />
                  ))}
                </div>
              ) : searchQuery.isError ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {t("meetingsRoute.searchFailed", {
                    defaultValue:
                      "Couldn't search meetings. Try again in a moment.",
                  })}
                </div>
              ) : searchResults.length === 0 ? (
                <Empty className="min-h-[24rem] w-full flex-1 rounded-none border-0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <IconSearch />
                    </EmptyMedia>
                    <EmptyTitle className="text-base">
                      {t("meetingsRoute.noMeetingsMatch", {
                        query: trimmedQuery,
                      })}
                    </EmptyTitle>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setQuery("")}
                      className="cursor-pointer"
                    >
                      {t("meetingsRoute.clearSearch")}
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : (
                <MeetingHistoryList
                  meetings={searchResults}
                  snippets={searchSnippets}
                />
              )
            ) : (
              <Tabs
                value={activeTab}
                onValueChange={setActiveTab}
                className="flex min-h-[24rem] flex-1 flex-col gap-0"
              >
                <TabsList
                  variant="line"
                  className="mb-4 h-9 w-fit"
                  aria-label={t("meetingsRoute.title")}
                >
                  <TabsTrigger value="agenda" className="min-w-24">
                    {t("meetingsRoute.agendaTab", {
                      defaultValue: "Agenda",
                    })}
                  </TabsTrigger>
                  <TabsTrigger value="past" className="min-w-24">
                    {t("meetingsRoute.pastTab", { defaultValue: "Past" })}
                  </TabsTrigger>
                </TabsList>

                <TabsContent
                  value="agenda"
                  className="mt-0 flex flex-1 flex-col data-[state=inactive]:hidden"
                >
                  {agendaQuery.isLoading && agendaMeetings.length === 0 ? (
                    <AgendaCardSkeleton />
                  ) : agendaSorted.length > 0 ? (
                    <AgendaCard meetings={agendaSorted} />
                  ) : !hasCalendar ? (
                    <ConnectCalendarEmptyState
                      onConnect={handleStartCalendarOAuth}
                      isPending={isCalendarBusy}
                    />
                  ) : (
                    <Empty className="min-h-[24rem] w-full flex-1 rounded-none border-0">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <IconCalendar />
                        </EmptyMedia>
                        <EmptyTitle className="text-base">
                          {t("meetingsRoute.noMeetingsYet")}
                        </EmptyTitle>
                      </EmptyHeader>
                    </Empty>
                  )}
                </TabsContent>

                <TabsContent
                  value="past"
                  className="mt-0 flex flex-1 flex-col gap-4 data-[state=inactive]:hidden"
                >
                  {historyMeetings.length > 0 ? (
                    <>
                      <MeetingHistoryList meetings={historyMeetings} />
                      {history.hasNextPage ? (
                        <div className="flex justify-center pt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => history.fetchNextPage()}
                            disabled={history.isFetchingNextPage}
                            className="h-8 cursor-pointer gap-1.5 text-xs"
                          >
                            {history.isFetchingNextPage ? (
                              <IconLoader2 className="size-3.5 animate-spin" />
                            ) : null}
                            {t("meetingsRoute.loadOlder", {
                              defaultValue: "Load older",
                            })}
                          </Button>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <Empty className="min-h-[24rem] w-full flex-1 rounded-none border-0">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <IconCalendar />
                        </EmptyMedia>
                        <EmptyTitle className="text-base">
                          {t("meetingsRoute.noPastMeetings", {
                            defaultValue: "No past meetings yet",
                          })}
                        </EmptyTitle>
                      </EmptyHeader>
                    </Empty>
                  )}
                </TabsContent>
              </Tabs>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
