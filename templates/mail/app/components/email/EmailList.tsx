import { useT } from "@agent-native/core/client";
import type { EmailMessage } from "@shared/types";
import {
  IconAlertCircle,
  IconArchive,
  IconDots,
  IconFolder,
  IconMail,
  IconMailOpened,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { GoogleConnectBanner } from "@/components/GoogleConnectBanner";
import { useSetHeaderActions } from "@/components/layout/HeaderActions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useEmails,
  useMarkRead,
  useMarkThreadRead,
  useToggleStar,
  useArchiveEmail,
  useUnarchiveEmail,
  useTrashEmail,
  useUntrashEmail,
  useBulkArchiveEmails,
  useBulkTrashEmails,
  useBulkToggleStar,
  useBulkMarkRead,
  useLabels,
  useMoveEmail,
  unsuppressThread,
  type BulkEmailTarget,
} from "@/hooks/use-emails";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import {
  useDeleteScheduledJob,
  useSendScheduledJobNow,
} from "@/hooks/use-scheduled-jobs";
import { isMcpEmbedSurface } from "@/lib/mcp-embed";
import { ensureThread, warmThreads } from "@/lib/thread-cache";
import { cn } from "@/lib/utils";

import { EmailListItem } from "./EmailListItem";

type EmailsPage = { emails: EmailMessage[]; nextPageToken?: string };
type InfiniteEmails = InfiniteData<EmailsPage, string | undefined>;
type SnoozeTarget = {
  emailId: string;
  accountEmail?: string;
};
import { toast } from "sonner";

import { setUndoAction } from "@/hooks/use-undo";
import { groupIntoThreads, type ThreadSummary } from "@/lib/threads";

interface EmailListProps {
  emails?: EmailMessage[];
  isLoading?: boolean;
  isFetching?: boolean;
  emailsError?: Error | null;
  refetchEmails?: () => unknown;
  hasNextPage?: boolean;
  fetchNextPage?: () => Promise<unknown>;
  isFetchingNextPage?: boolean;
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  onCompose?: (email: EmailMessage, mode: "reply" | "forward") => void;
  onArchived?: (id: string) => void;
  onDraftOpen?: (email: EmailMessage) => void;
  onNavigateThread?: (threadId: string) => void;
}

// ─── Inbox Zero ─────────────────────────────────────────────────────────────

// Curated collection of stunning landscape/nature photos from Unsplash.
// Using direct Unsplash photo IDs for reliable, high-quality images.
const INBOX_ZERO_PHOTOS = [
  "photo-1506744038136-46273834b3fb", // Yosemite valley
  "photo-1470071459604-3b5ec3a7fe05", // Misty green mountains
  "photo-1441974231531-c6227db76b6e", // Forest sunlight
  "photo-1469474968028-56623f02e42e", // Golden sunset coast
  "photo-1472214103451-9374bd1c798e", // Green rolling hills
  "photo-1483347756197-71ef80e95f73", // Aurora borealis
  "photo-1507525428034-b723cf961d3e", // Tropical beach
  "photo-1505765050516-f72dcac9c60e", // Mountain reflection lake
  "photo-1464822759023-fed622ff2c3b", // Snow-capped mountain
  "photo-1433086966358-54859d0ed716", // Waterfall in forest
  "photo-1501854140801-50d01698950b", // Aerial forest
  "photo-1643840154819-6831d22f7621", // Pink sky desert
  "photo-1502082553048-f009c37129b9", // Sun through trees
  "photo-1536431311719-398b6704d4cc", // Dramatic clouds
  "photo-1475924156734-496f6cac6ec1", // Northern lights
  "photo-1540202404-a2f29016b523", // Lavender fields
  "photo-1494500764479-0c8f2919a3d8", // Redwood forest
  "photo-1509316975850-ff9c5deb0cd9", // Cherry blossoms
  "photo-1508739773434-c26b3d09e071", // Sunset over ocean
  "photo-1476610182048-b716b8518aae", // Lightning storm
  "photo-1490730141103-6cac27aaab94", // Sunrise mountains
  "photo-1527489377706-5bf97e608852", // Blue ice cave
  "photo-1542224566-6e85f2e6772f", // Autumn forest path
  "photo-1501785888041-af3ef285b470", // Italian coast
  "photo-1523712999610-f77fbcfc3843", // Foggy forest
  "photo-1419242902214-272b3f66ee7a", // Milky way
  "photo-1468276311594-df7cb65d8df6", // Tropical ocean
  "photo-1531366936337-7c912a4589a7", // Volcanic landscape
  "photo-1552083375-1447ce886485", // Japanese garden
];

function emptyStateHintKeyForView(view: string): string {
  switch (view) {
    case "snoozed":
      return "mail.empty.snoozed";
    case "drafts":
      return "mail.empty.drafts";
    case "starred":
      return "mail.empty.starred";
    case "sent":
      return "mail.empty.sent";
    case "scheduled":
      return "mail.empty.scheduled";
    case "archive":
      return "mail.empty.archive";
    case "trash":
      return "mail.empty.trash";
    case "spam":
      return "mail.empty.spam";
    case "all":
      return "mail.empty.all";
    case "unread":
      return "mail.empty.unread";
    default:
      return "mail.empty.default";
  }
}

export function InboxZero() {
  const t = useT();
  const [loaded, setLoaded] = useState(false);
  const isEmbedded = isMcpEmbedSurface();

  // Toggle class on root so the header can go transparent
  useEffect(() => {
    document.documentElement.classList.add("inbox-zero");
    return () => document.documentElement.classList.remove("inbox-zero");
  }, []);

  // Pick a photo based on the day of the year
  const today = new Date();
  const dayOfYear = Math.floor(
    (today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) /
      86400000,
  );
  const photoId = INBOX_ZERO_PHOTOS[dayOfYear % INBOX_ZERO_PHOTOS.length];
  const imageUrl = `https://images.unsplash.com/${photoId}?w=1920&q=80&fit=crop`;

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden">
      {/* Background image — fixed so it extends behind header + agent sidebar for blur */}
      {isEmbedded ? (
        <div className="fixed inset-0 bg-[linear-gradient(135deg,hsl(220,18%,11%),hsl(203,22%,18%)_55%,hsl(168,24%,16%))]" />
      ) : (
        <img
          src={imageUrl}
          alt=""
          onLoad={() => setLoaded(true)}
          className={cn(
            "fixed inset-0 h-full w-full object-cover",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      )}

      {/* Persistent scrims keep white chrome readable across bright photos. */}
      <div className="fixed inset-0 bg-black/20" />
      <div className="inbox-zero-top-scrim fixed inset-x-0 top-0" />

      {/* Bottom gradient — text legibility */}
      <div className="fixed inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/70 to-transparent" />

      {/* Fallback bg while image loads */}
      <div className="absolute inset-0 bg-muted dark:bg-[hsl(220,6%,8%)] -z-10" />

      {/* Bottom text */}
      <div className="relative mt-auto px-6 pb-6">
        <p className="text-[15px] font-medium text-white/90 drop-shadow-lg">
          {t("mail.empty.inboxZeroTitle")}
        </p>
        <p className="text-[13px] text-white/60 drop-shadow-lg mt-0.5">
          {t("mail.empty.inboxZeroSubtitle")}
        </p>
      </div>
    </div>
  );
}

function MailLoadingState({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="flex h-full flex-col" ref={containerRef}>
      <div className="flex-1 overflow-y-auto">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="flex h-[48px] items-center gap-3 px-4 sm:h-[38px]"
          >
            <div className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-muted" />
            <div className="h-3 w-28 animate-pulse rounded bg-muted" />
            <div className="h-3 flex-1 animate-pulse rounded bg-muted" />
            <div className="h-3 w-12 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Error state ────────────────────────────────────────────────────────────
// Rendered when the emails query fails. The "Try again" button must give
// visible feedback during the refetch — without it, clicking on a persistent
// rate-limit error looks like nothing happens (the same error re-renders
// identically so the user assumes the button is broken). For 429/quota errors
// we auto-schedule one retry after a short delay so recovery is hands-off,
// and gate the manual button behind a 15s cooldown so a flurry of clicks
// can't itself trip the rate limit.

const RATE_LIMIT_RETRY_MS = 60_000;

function getRateLimitRetryMs(message: string): number {
  const match = message.match(/retry in\s+(\d+)s/i);
  if (!match) return RATE_LIMIT_RETRY_MS;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return RATE_LIMIT_RETRY_MS;
  return Math.min(Math.max(seconds * 1000, 15_000), 5 * 60_000);
}

function EmailErrorState({
  isQuotaError,
  message,
  isFetching,
  onRetry,
  containerRef,
}: {
  isQuotaError: boolean;
  message: string;
  isFetching: boolean;
  onRetry: () => unknown;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const t = useT();
  const rateLimitRetryMs = isQuotaError ? getRateLimitRetryMs(message) : 0;
  const [cooldownRemaining, setCooldownRemaining] = useState(rateLimitRetryMs);
  const autoRetryFired = useRef(false);

  useEffect(() => {
    setCooldownRemaining(rateLimitRetryMs);
    autoRetryFired.current = false;
  }, [rateLimitRetryMs]);

  // Tick the cooldown countdown every second. Depend on the boolean so the
  // effect only re-runs when the cooldown starts or stops — not on every tick.
  // The functional setter pattern reads `prev` from the latest state, so we
  // don't need `cooldownRemaining` in the deps array.
  const isCoolingDown = cooldownRemaining > 0;
  useEffect(() => {
    if (!isCoolingDown) return;
    const handle = setInterval(() => {
      setCooldownRemaining((prev) => Math.max(0, prev - 1000));
    }, 1000);
    return () => clearInterval(handle);
  }, [isCoolingDown]);

  // Auto-retry once when a rate-limit cooldown elapses so the user doesn't
  // have to babysit the screen waiting for Google to recover.
  useEffect(() => {
    if (!isQuotaError) return;
    if (autoRetryFired.current) return;
    if (cooldownRemaining > 0) return;
    autoRetryFired.current = true;
    void onRetry();
  }, [cooldownRemaining, isQuotaError, onRetry]);

  const handleClick = useCallback(() => {
    if (cooldownRemaining > 0 || isFetching) return;
    setCooldownRemaining(rateLimitRetryMs);
    autoRetryFired.current = true;
    void onRetry();
  }, [cooldownRemaining, isFetching, onRetry, rateLimitRetryMs]);

  const cooldownSeconds = Math.ceil(cooldownRemaining / 1000);
  const buttonDisabled = isFetching || cooldownRemaining > 0;

  let buttonLabel: string;
  if (isFetching) {
    buttonLabel = t("mail.error.retrying");
  } else if (cooldownRemaining > 0) {
    buttonLabel = t("mail.error.tryAgainIn", { seconds: cooldownSeconds });
  } else {
    buttonLabel = t("mail.error.tryAgain");
  }

  return (
    <div className="flex h-full flex-col" ref={containerRef}>
      <div className="flex flex-1 flex-col items-center justify-center px-8">
        <div className="flex flex-col items-center gap-3 max-w-xs text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
            <IconAlertCircle className="h-5 w-5 text-destructive" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              {isQuotaError
                ? t("mail.error.rateLimitTitle")
                : t("mail.error.loadTitle")}
            </p>
            <p className="text-xs text-muted-foreground">
              {isQuotaError ? t("mail.error.rateLimitDescription") : message}
            </p>
          </div>
          <button
            onClick={handleClick}
            disabled={buttonDisabled}
            className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isFetching && <Spinner className="h-3 w-3" />}
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Email List ─────────────────────────────────────────────────────────────

export function EmailList({
  emails: emailsProp,
  isLoading: isLoadingProp,
  isFetching: isFetchingProp,
  emailsError: emailsErrorProp,
  refetchEmails,
  hasNextPage: hasNextPageProp,
  fetchNextPage: fetchNextPageProp,
  isFetchingNextPage: isFetchingNextPageProp,
  focusedId,
  setFocusedId,
  selectedIds,
  setSelectedIds,
  onCompose,
  onArchived,
  onDraftOpen,
  onNavigateThread,
}: EmailListProps) {
  const t = useT();
  const navigate = useNavigate();
  const { view = "inbox", threadId } = useParams<{
    view: string;
    threadId: string;
  }>();
  const [searchParams] = useSearchParams();
  const searchQuery = searchParams.get("q") ?? undefined;
  const labelParam = searchParams.get("label");
  const routeSearchSuffix = searchParams.toString()
    ? `?${searchParams.toString()}`
    : "";

  const {
    data: fetchedEmails = [],
    isLoading: fetchedEmailsLoading,
    isFetching: fetchedEmailsFetching,
    error: fetchedEmailsError,
    refetch: refetchFetchedEmails,
    hasNextPage: fetchedEmailsHasNextPage,
    fetchNextPage: fetchFetchedNextPage,
    isFetchingNextPage: fetchedEmailsFetchingNextPage,
  } = useEmails(view, searchQuery, labelParam ?? undefined, {
    enabled: emailsProp === undefined,
  });

  const emails = emailsProp ?? fetchedEmails;
  const isLoading = isLoadingProp ?? fetchedEmailsLoading;
  const isFetching = isFetchingProp ?? fetchedEmailsFetching;
  const emailsError = emailsErrorProp ?? fetchedEmailsError;
  const refetch = refetchEmails ?? refetchFetchedEmails;
  const hasNextPage = hasNextPageProp ?? fetchedEmailsHasNextPage;
  const fetchNextPage = fetchNextPageProp ?? fetchFetchedNextPage;
  const isFetchingNextPage =
    isFetchingNextPageProp ?? fetchedEmailsFetchingNextPage;
  const markRead = useMarkRead();
  const markThreadRead = useMarkThreadRead();
  const toggleStar = useToggleStar();
  const archiveEmail = useArchiveEmail();
  const unarchiveEmail = useUnarchiveEmail();
  const trashEmail = useTrashEmail();
  const untrashEmail = useUntrashEmail();
  const bulkArchiveEmails = useBulkArchiveEmails();
  const bulkTrashEmails = useBulkTrashEmails();
  const bulkToggleStar = useBulkToggleStar();
  const bulkMarkRead = useBulkMarkRead();
  const { data: labels = [] } = useLabels();
  const moveEmail = useMoveEmail();
  const cancelScheduledJob = useDeleteScheduledJob();
  const sendScheduledJobNow = useSendScheduledJobNow();
  const queryClient = useQueryClient();
  const movableLabels = useMemo(
    () =>
      labels.filter(
        (label) => label.type === "user" && label.id !== labelParam,
      ),
    [labels, labelParam],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollParentRef = useRef<HTMLDivElement>(null);

  // Group emails into threads
  const threads = useMemo(() => groupIntoThreads(emails), [emails]);

  const focusedIndex = threads.findIndex(
    (t) => t.latestMessage.id === focusedId,
  );

  // Refs so keyboard handlers always read the latest values without stale closures.
  // Without this, rapid j/k presses fire before React re-renders, causing the
  // second press to compute the same next index as the first (appears to "skip").
  const focusedIndexRef = useRef(focusedIndex);
  focusedIndexRef.current = focusedIndex;
  const focusedIdRef = useRef(focusedId);
  focusedIdRef.current = focusedId;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  const selectThreads = useCallback(
    (predicate: (thread: ThreadSummary) => boolean) => {
      const keys = threads
        .filter(predicate)
        .map(
          (thread) => thread.latestMessage.threadId || thread.latestMessage.id,
        );
      setSelectedIds(new Set(keys));
      if (keys.length > 0) {
        const first = threads.find(
          (thread) =>
            (thread.latestMessage.threadId || thread.latestMessage.id) ===
            keys[0],
        );
        if (first) setFocusedId(first.latestMessage.id);
      }
    },
    [setFocusedId, setSelectedIds, threads],
  );

  const selectAllThreads = useCallback(() => {
    selectThreads(() => true);
  }, [selectThreads]);

  const selectReadThreads = useCallback(() => {
    selectThreads((thread) => !thread.hasUnread);
  }, [selectThreads]);

  const selectUnreadThreads = useCallback(() => {
    selectThreads((thread) => thread.hasUnread);
  }, [selectThreads]);

  const selectStarredThreads = useCallback(() => {
    selectThreads((thread) => thread.hasStarred);
  }, [selectThreads]);

  const selectUnstarredThreads = useCallback(() => {
    selectThreads((thread) => !thread.hasStarred);
  }, [selectThreads]);

  const moveFocus = useCallback(
    (delta: number) => {
      setSelectedIds(new Set());
      if (threads.length === 0) return;
      let current = focusedIndexRef.current;
      // If index is stale (-1), re-derive from the current focusedId
      if (current === -1 && focusedIdRef.current) {
        current = threads.findIndex(
          (t) => t.latestMessage.id === focusedIdRef.current,
        );
      }
      const next = Math.max(
        0,
        Math.min(threads.length - 1, (current === -1 ? 0 : current) + delta),
      );
      setFocusedId(threads[next].latestMessage.id);
      focusedIndexRef.current = next;
      // Scrolling the focused row into view is handled by the effect that
      // watches `focusedIndex` and calls `rowVirtualizer.scrollToIndex`.
    },
    [threads, setFocusedId, setSelectedIds],
  );

  const extendSelection = useCallback(
    (delta: number) => {
      if (threads.length === 0) return;
      const current = focusedIndexRef.current;
      const next = Math.max(
        0,
        Math.min(threads.length - 1, (current === -1 ? 0 : current) + delta),
      );
      const newFocusThread = threads[next];
      const newFocusId = newFocusThread.latestMessage.id;
      const newThreadKey = newFocusThread.latestMessage.threadId || newFocusId;

      setSelectedIds((prev) => {
        const updated = new Set(prev);
        // Include anchor on first shift-move — derive the thread key from the
        // currently focused email id.
        if (prev.size === 0 && focusedIdRef.current) {
          const anchorThread = threads.find(
            (t) => t.latestMessage.id === focusedIdRef.current,
          );
          if (anchorThread) {
            updated.add(
              anchorThread.latestMessage.threadId ||
                anchorThread.latestMessage.id,
            );
          }
        }
        updated.add(newThreadKey);
        return updated;
      });

      setFocusedId(newFocusId);
      focusedIndexRef.current = next;
      // Scrolling into view is handled by the `focusedIndex` effect above.
    },
    [threads, setFocusedId, setSelectedIds],
  );

  // Returns thread keys (latestMessage.threadId || latestMessage.id) of the
  // emails to act on — multi-selection if present, else the focused row.
  const getActionThreadKeys = useCallback((): string[] => {
    if (selectedIdsRef.current.size > 0)
      return Array.from(selectedIdsRef.current);
    const fid = focusedIdRef.current;
    const thread = fid
      ? threads.find((t) => t.latestMessage.id === fid)
      : threads[0];
    if (!thread) return [];
    return [thread.latestMessage.threadId || thread.latestMessage.id];
  }, [threads]);

  const openFocused = useCallback(() => {
    const id = focusedIdRef.current;
    if (!id) return;
    const thread = threads.find((t) => t.latestMessage.id === id);
    if (!thread) return;
    const targetThreadId = thread.latestMessage.threadId || id;
    // Enter on a single focused row is a single-thread action — clear any
    // in-progress multi-selection so shortcuts in detail view start fresh.
    setSelectedIds(new Set());
    void ensureThread(targetThreadId, thread.latestMessage.accountEmail).catch(
      () => {},
    );
    onNavigateThread?.(targetThreadId);
    navigate(`/${view}/${targetThreadId}${routeSearchSuffix}`);
    if (thread.hasUnread) {
      setTimeout(() => markThreadRead.mutate(targetThreadId), 0);
    }
  }, [
    threads,
    view,
    navigate,
    markThreadRead,
    routeSearchSuffix,
    queryClient,
    setSelectedIds,
  ]);

  const archiveThreadKeys = useCallback(
    (threadKeys: string[]) => {
      if (threadKeys.length === 0) return;
      const actionKeySet = new Set(threadKeys);

      // Resolve each thread key to its latestMessage + accountEmail up front.
      const targets = threadKeys
        .map((key) =>
          threads.find(
            (t) => (t.latestMessage.threadId || t.latestMessage.id) === key,
          ),
        )
        .filter((t): t is ThreadSummary => !!t);
      const emailIds = targets.map((t) => t.latestMessage.id);

      // Move focus to the next non-selected thread (or previous if at end)
      const lastIdx = threads.findIndex(
        (t) =>
          (t.latestMessage.threadId || t.latestMessage.id) ===
          threadKeys[threadKeys.length - 1],
      );
      const remaining = threads.filter(
        (t) =>
          !actionKeySet.has(t.latestMessage.threadId || t.latestMessage.id),
      );
      if (remaining.length > 0) {
        const nextIdx = Math.min(lastIdx, remaining.length - 1);
        const nextThread = remaining[nextIdx];
        setFocusedId(nextThread.latestMessage.id);
        // Warm the thread that's about to take focus so repeated `e` stays
        // instant down the list.
        const nextTid =
          nextThread.latestMessage.threadId || nextThread.latestMessage.id;
        void ensureThread(nextTid, nextThread.latestMessage.accountEmail).catch(
          () => {},
        );
      } else {
        setFocusedId(null);
      }

      // Snapshot removed thread emails so undo can restore them
      const snapshots: EmailMessage[] = [];
      for (const key of threadKeys) {
        snapshots.push(...emails.filter((e) => (e.threadId || e.id) === key));
      }
      for (const id of emailIds) onArchived?.(id);

      const undo = () => {
        for (const key of threadKeys) unsuppressThread(key);
        queryClient.setQueriesData<InfiniteEmails>(
          { queryKey: ["emails"] },
          (old) => {
            if (!old) return old;
            // Re-insert snapshots into the first page
            const firstPage = old.pages[0];
            const restored = [...(firstPage?.emails ?? []), ...snapshots].sort(
              (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
            );
            return {
              ...old,
              pages: [
                { ...firstPage, emails: restored },
                ...old.pages.slice(1),
              ],
            };
          },
        );
        for (const id of emailIds) unarchiveEmail.mutate(id);
      };
      setUndoAction(undo);
      toast(
        threadKeys.length > 1
          ? t("mail.toasts.archivedMany", { count: threadKeys.length })
          : t("mail.toasts.archived"),
        { action: { label: t("mail.actions.undo"), onClick: undo } },
      );
      if (targets.length > 1) {
        // Bulk selection: one action call (server batches into one Gmail
        // call per account) + one optimistic cache update instead of N.
        bulkArchiveEmails.mutate({
          targets: targets.map((t) => ({
            id: t.latestMessage.id,
            accountEmail: t.latestMessage.accountEmail,
            threadId: t.latestMessage.threadId || t.latestMessage.id,
          })),
          removeLabel: labelParam || undefined,
        });
      } else {
        // Single-item shortcut (e.g. `e` on the focused row) keeps its
        // existing per-item path, including label-view removeLabel support.
        for (const t of targets) {
          archiveEmail.mutate({
            id: t.latestMessage.id,
            accountEmail: t.latestMessage.accountEmail,
            removeLabel: labelParam || undefined,
            threadId: t.latestMessage.threadId || t.latestMessage.id,
          });
        }
      }
      setSelectedIds(new Set());
    },
    [
      threads,
      emails,
      archiveEmail,
      bulkArchiveEmails,
      unarchiveEmail,
      onArchived,
      labelParam,
      setFocusedId,
      setSelectedIds,
      queryClient,
    ],
  );

  const archiveFocused = useCallback(() => {
    archiveThreadKeys(getActionThreadKeys());
  }, [archiveThreadKeys, getActionThreadKeys]);

  const trashThreadKeys = useCallback(
    (threadKeys: string[]) => {
      if (threadKeys.length === 0) return;
      const actionKeySet = new Set(threadKeys);

      const targets = threadKeys
        .map((key) =>
          threads.find(
            (t) => (t.latestMessage.threadId || t.latestMessage.id) === key,
          ),
        )
        .filter((t): t is ThreadSummary => !!t);
      const emailIds = targets.map((t) => t.latestMessage.id);

      // Move focus to the next non-selected thread
      const lastIdx = threads.findIndex(
        (t) =>
          (t.latestMessage.threadId || t.latestMessage.id) ===
          threadKeys[threadKeys.length - 1],
      );
      const remaining = threads.filter(
        (t) =>
          !actionKeySet.has(t.latestMessage.threadId || t.latestMessage.id),
      );
      if (remaining.length > 0) {
        const nextIdx = Math.min(lastIdx, remaining.length - 1);
        setFocusedId(remaining[nextIdx].latestMessage.id);
      } else {
        setFocusedId(null);
      }

      // Snapshot removed thread emails so undo can restore them
      const snapshots: EmailMessage[] = [];
      for (const key of threadKeys) {
        snapshots.push(...emails.filter((e) => (e.threadId || e.id) === key));
      }

      const undo = () => {
        for (const key of threadKeys) unsuppressThread(key);
        queryClient.setQueriesData<InfiniteEmails>(
          { queryKey: ["emails"] },
          (old) => {
            if (!old) return old;
            const firstPage = old.pages[0];
            const restored = [...(firstPage?.emails ?? []), ...snapshots].sort(
              (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
            );
            return {
              ...old,
              pages: [
                { ...firstPage, emails: restored },
                ...old.pages.slice(1),
              ],
            };
          },
        );
        for (const id of emailIds) untrashEmail.mutate(id);
      };
      setUndoAction(undo);
      toast(
        threadKeys.length > 1
          ? t("mail.toasts.trashedMany", { count: threadKeys.length })
          : t("mail.toasts.trashed"),
        { action: { label: t("mail.actions.undo"), onClick: undo } },
      );
      if (targets.length > 1) {
        // Bulk selection: one action call, bounded-concurrency on the server
        // (Gmail has no batch trash endpoint) instead of N parallel mutate()
        // calls each with their own optimistic cache write/rollback.
        bulkTrashEmails.mutate(
          targets.map((t) => ({
            id: t.latestMessage.id,
            accountEmail: t.latestMessage.accountEmail,
            threadId: t.latestMessage.threadId || t.latestMessage.id,
          })),
        );
      } else {
        for (const id of emailIds) trashEmail.mutate(id);
      }
      setSelectedIds(new Set());
    },
    [
      threads,
      emails,
      trashEmail,
      bulkTrashEmails,
      untrashEmail,
      setFocusedId,
      setSelectedIds,
      queryClient,
    ],
  );

  const trashFocused = useCallback(() => {
    if (view === "trash") return;
    const threadKeys = getActionThreadKeys();
    if (threadKeys.length === 0) return;
    trashThreadKeys(threadKeys);
  }, [getActionThreadKeys, trashThreadKeys, view]);

  const resolveTargets = useCallback(
    (keys: string[]): ThreadSummary[] =>
      keys
        .map((key) =>
          threads.find(
            (t) => (t.latestMessage.threadId || t.latestMessage.id) === key,
          ),
        )
        .filter((t): t is ThreadSummary => !!t),
    [threads],
  );

  useEffect(() => {
    const handler = (event: Event) => {
      if (threadId) return;

      const targets: SnoozeTarget[] = resolveTargets(getActionThreadKeys()).map(
        (thread) => ({
          emailId: thread.latestMessage.id,
          accountEmail: thread.latestMessage.accountEmail,
        }),
      );
      if (targets.length === 0) return;

      event.preventDefault();
      window.dispatchEvent(
        new CustomEvent("email:request-snooze", {
          detail: { targets },
        }),
      );
    };

    window.addEventListener("email:shortcut-snooze", handler);
    return () => window.removeEventListener("email:shortcut-snooze", handler);
  }, [getActionThreadKeys, resolveTargets, threadId]);

  const toggleFocusedRead = useCallback(() => {
    const keys = getActionThreadKeys();
    if (keys.length === 0) return;
    const targets = resolveTargets(keys);
    const toMarkRead = targets.filter((t) => t.hasUnread);
    const toMarkUnread = targets.filter((t) => !t.hasUnread);
    for (const t of toMarkRead) {
      markThreadRead.mutate(t.latestMessage.threadId || t.latestMessage.id);
    }
    if (toMarkUnread.length > 1) {
      bulkMarkRead.mutate({
        targets: toMarkUnread.map((t) => ({
          id: t.latestMessage.id,
          accountEmail: t.latestMessage.accountEmail,
        })),
        isRead: false,
      });
    } else {
      for (const t of toMarkUnread) {
        markRead.mutate({
          id: t.latestMessage.id,
          isRead: false,
          accountEmail: t.latestMessage.accountEmail,
        });
      }
    }
    setSelectedIds(new Set());
  }, [
    markRead,
    markThreadRead,
    bulkMarkRead,
    getActionThreadKeys,
    resolveTargets,
    setSelectedIds,
  ]);

  const markFocusedRead = useCallback(() => {
    for (const t of resolveTargets(getActionThreadKeys())) {
      markThreadRead.mutate(t.latestMessage.threadId || t.latestMessage.id);
    }
    setSelectedIds(new Set());
  }, [markThreadRead, getActionThreadKeys, resolveTargets, setSelectedIds]);

  const markFocusedUnread = useCallback(() => {
    const targets = resolveTargets(getActionThreadKeys());
    if (targets.length > 1) {
      bulkMarkRead.mutate({
        targets: targets.map((t) => ({
          id: t.latestMessage.id,
          accountEmail: t.latestMessage.accountEmail,
        })),
        isRead: false,
      });
    } else {
      for (const t of targets) {
        markRead.mutate({
          id: t.latestMessage.id,
          isRead: false,
          accountEmail: t.latestMessage.accountEmail,
        });
      }
    }
    setSelectedIds(new Set());
  }, [
    markRead,
    bulkMarkRead,
    getActionThreadKeys,
    resolveTargets,
    setSelectedIds,
  ]);

  const moveFocusedToLabel = useCallback(
    (labelId: string, labelName: string) => {
      const keys = getActionThreadKeys();
      if (keys.length === 0) return;
      const targets = resolveTargets(keys);
      for (const t of targets) {
        moveEmail.mutate({
          id: t.latestMessage.id,
          label: labelId,
          removeLabel: labelParam || undefined,
        });
      }
      setSelectedIds(new Set());
      toast(
        targets.length > 1
          ? `Moved ${targets.length} conversations to ${labelName}.`
          : `Moved to ${labelName}.`,
      );
    },
    [
      getActionThreadKeys,
      resolveTargets,
      moveEmail,
      labelParam,
      setSelectedIds,
    ],
  );

  const getThreadMessagesForKey = useCallback(
    (key: string) => emails.filter((e) => (e.threadId || e.id) === key),
    [emails],
  );

  const setThreadStarred = useCallback(
    (thread: ThreadSummary, isStarred: boolean) => {
      const key = thread.latestMessage.threadId || thread.latestMessage.id;
      const messages = getThreadMessagesForKey(key);
      const targets = isStarred
        ? [thread.latestMessage]
        : messages.filter((message) => message.isStarred);
      const fallbackTargets =
        targets.length > 0 ? targets : [thread.latestMessage];

      for (const target of fallbackTargets) {
        toggleStar.mutate({
          id: target.id,
          isStarred,
          accountEmail: target.accountEmail,
          threadId: key,
        });
      }
    },
    [getThreadMessagesForKey, toggleStar],
  );

  const starFocused = useCallback(() => {
    const keys = getActionThreadKeys();
    if (keys.length === 0) return;
    const targets = resolveTargets(keys);
    if (targets.length > 1) {
      // Bulk selection: split into "becoming starred" / "becoming unstarred"
      // groups (each thread toggles relative to its own current state) and
      // send one action call per group instead of one per message.
      const toStar = targets.filter((t) => !t.hasStarred);
      const toUnstar = targets.filter((t) => t.hasStarred);
      if (toStar.length > 0) {
        bulkToggleStar.mutate({
          targets: toStar.map((t) => ({
            id: t.latestMessage.id,
            accountEmail: t.latestMessage.accountEmail,
            threadId: t.latestMessage.threadId || t.latestMessage.id,
          })),
          isStarred: true,
        });
      }
      if (toUnstar.length > 0) {
        // Unstarring a thread means unstarring every starred message in it,
        // which setThreadStarred already resolves per thread — keep that
        // per-thread resolution but still fan the actual mutations out
        // through the same per-item path since counts here are small.
        for (const t of toUnstar) setThreadStarred(t, false);
      }
    } else {
      for (const t of targets) setThreadStarred(t, !t.hasStarred);
    }
    setSelectedIds(new Set());
  }, [
    getActionThreadKeys,
    resolveTargets,
    setSelectedIds,
    setThreadStarred,
    bulkToggleStar,
  ]);

  const replyFocused = useCallback(() => {
    const id = focusedIdRef.current;
    if (!id || !onCompose) return;
    const thread = threads.find((t) => t.latestMessage.id === id);
    if (thread) onCompose(thread.latestMessage, "reply");
  }, [threads, onCompose]);

  const forwardFocused = useCallback(() => {
    const id = focusedIdRef.current;
    if (!id || !onCompose) return;
    const thread = threads.find((t) => t.latestMessage.id === id);
    if (thread) onCompose(thread.latestMessage, "forward");
  }, [threads, onCompose]);

  const clearSelection = useCallback(
    () => setSelectedIds(new Set()),
    [setSelectedIds],
  );

  // Keyboard navigation — Gmail / Superhuman standard shortcuts
  useKeyboardShortcuts([
    { key: "a", meta: true, handler: selectAllThreads },
    { key: "j", handler: () => moveFocus(1) },
    { key: "ArrowDown", handler: () => moveFocus(1) },
    { key: "k", handler: () => moveFocus(-1) },
    { key: "ArrowUp", handler: () => moveFocus(-1) },
    { key: "j", shift: true, handler: () => extendSelection(1) },
    { key: "k", shift: true, handler: () => extendSelection(-1) },
    { key: "ArrowDown", shift: true, handler: () => extendSelection(1) },
    { key: "ArrowUp", shift: true, handler: () => extendSelection(-1) },
    { key: "Enter", handler: openFocused },
    { key: "o", handler: openFocused },
    { key: "e", handler: archiveFocused },
    { key: "d", handler: trashFocused },
    { key: "u", handler: toggleFocusedRead },
    { key: "I", handler: markFocusedRead, shift: true },
    { key: "U", handler: markFocusedUnread, shift: true },
    { key: "s", handler: starFocused },
    { key: "r", handler: replyFocused },
    { key: "f", handler: forwardFocused },
    { key: "a", handler: replyFocused }, // reply-all (same as reply for single messages)
    { key: "Escape", handler: clearSelection },
  ]);

  // Auto-focus first thread when list loads, or reset if focused email was removed
  useEffect(() => {
    if (threads.length === 0) return;
    if (!focusedId || !threads.some((t) => t.latestMessage.id === focusedId)) {
      setFocusedId(threads[0].latestMessage.id);
    }
  }, [threads, focusedId, setFocusedId]);

  // Warm only the first few visible threads on list load. Direct clicks still
  // fetch immediately, while background work stays below Gmail's quota.
  useEffect(() => {
    if (threads.length === 0) return;
    warmThreads(
      threads.slice(0, 3).map((t) => ({
        id: t.latestMessage.threadId || t.latestMessage.id,
        accountEmail: t.latestMessage.accountEmail,
      })),
    );
  }, [threads]);

  // When focus moves, prefetch the focused row and its closest neighbors only.
  useEffect(() => {
    if (!focusedId || threads.length === 0) return;
    const idx = threads.findIndex((t) => t.latestMessage.id === focusedId);
    if (idx === -1) return;
    const windowIdx = [idx - 1, idx, idx + 1].filter(
      (i) => i >= 0 && i < threads.length,
    );
    warmThreads(
      windowIdx.map((i) => ({
        id: threads[i].latestMessage.threadId || threads[i].latestMessage.id,
        accountEmail: threads[i].latestMessage.accountEmail,
      })),
    );
  }, [focusedId, threads]);

  // Row height matches the CSS `h-[48px] sm:h-[38px]` breakpoint (Tailwind's
  // `sm` = 640px) so the virtualizer's estimate lines up with the real row on
  // first paint; `measureElement` still corrects it if a row wraps or the
  // breakpoint is mid-transition.
  const [rowHeightEstimate, setRowHeightEstimate] = useState(() =>
    typeof window !== "undefined" && window.innerWidth >= 640 ? 38 : 48,
  );
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 640px)");
    const onChange = () => setRowHeightEstimate(mql.matches ? 38 : 48);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const rowVirtualizer = useVirtualizer({
    count: threads.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => rowHeightEstimate,
    overscan: 10,
    getItemKey: (index) => threads[index]?.latestMessage.id ?? index,
  });

  // Keep keyboard-focused rows in view. Mounted rows no longer span the full
  // list once virtualized, so `scrollIntoView` on a queried DOM node can't be
  // relied on — ask the virtualizer to scroll to the row's index instead.
  useEffect(() => {
    if (focusedIndex < 0) return;
    rowVirtualizer.scrollToIndex(focusedIndex, { align: "auto" });
  }, [focusedIndex, rowVirtualizer]);

  // Infinite scroll — fetch next page when the sentinel enters the viewport.
  // isFetchingNextPage is read via ref (not a dep) because re-observe fires
  // the callback synchronously with the current intersection state; if the
  // sentinel is still visible after a fetch, a reconnecting observer would
  // immediately fire again and we'd loop (visible to the user as "Loading
  // more..." flashing every ~second while tab is idle).
  const sentinelRef = useRef<HTMLDivElement>(null);
  const isFetchingNextPageRef = useRef(isFetchingNextPage);
  isFetchingNextPageRef.current = isFetchingNextPage;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingNextPageRef.current) {
          void fetchNextPage().catch(() => {
            // React Query owns the visible error state; avoid a global
            // unhandledrejection for transient list-page fetch failures.
          });
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, fetchNextPage]);

  // Advance selection when an email is snoozed (same logic as archiveFocused)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (
        e as CustomEvent<{ emailId?: string; emailIds?: string[] }>
      ).detail;
      const emailIds =
        detail.emailIds && detail.emailIds.length > 0
          ? detail.emailIds
          : detail.emailId
            ? [detail.emailId]
            : [];
      if (emailIds.length === 0) return;

      const snoozedIds = new Set(emailIds);
      const idx = threads.findIndex((t) => snoozedIds.has(t.latestMessage.id));
      if (idx === -1) return;

      const remaining = threads.filter(
        (thread) => !snoozedIds.has(thread.latestMessage.id),
      );
      if (remaining.length > 0) {
        const nextIdx = Math.min(idx, remaining.length - 1);
        setFocusedId(remaining[nextIdx].latestMessage.id);
      } else {
        setFocusedId(null);
      }
      setSelectedIds(new Set());
    };
    window.addEventListener("email:snoozed", handler);
    return () => window.removeEventListener("email:snoozed", handler);
  }, [threads, setFocusedId, setSelectedIds]);

  const handleSelect = useCallback(
    (thread: ThreadSummary) => {
      const email = thread.latestMessage;
      const targetThreadId = email.threadId || email.id;
      setFocusedId(email.id);
      // A plain click is a single-thread action — clear any in-progress
      // multi-selection so the next keyboard shortcut doesn't act on a stale set.
      setSelectedIds(new Set());
      // Draft emails: open in compose window instead of thread view
      if (email.isDraft && onDraftOpen) {
        onDraftOpen(email);
        return;
      }
      void ensureThread(targetThreadId, email.accountEmail).catch(() => {});
      onNavigateThread?.(targetThreadId);
      navigate(`/${view}/${targetThreadId}${routeSearchSuffix}`);
      if (thread.hasUnread) {
        setTimeout(() => markThreadRead.mutate(targetThreadId), 0);
      }
    },
    [
      setFocusedId,
      setSelectedIds,
      onDraftOpen,
      onNavigateThread,
      navigate,
      view,
      routeSearchSuffix,
      markThreadRead,
    ],
  );

  const handleStar = useCallback(
    (e: React.MouseEvent, thread: ThreadSummary) => {
      e.stopPropagation();
      setThreadStarred(thread, !thread.hasStarred);
    },
    [setThreadStarred],
  );

  const handleToggleReadThread = useCallback(
    (e: React.MouseEvent, thread: ThreadSummary) => {
      e.stopPropagation();
      const email = thread.latestMessage;
      if (thread.hasUnread) {
        markThreadRead.mutate(email.threadId || email.id);
      } else {
        markRead.mutate({
          id: email.id,
          isRead: false,
          accountEmail: email.accountEmail,
        });
      }
    },
    [markThreadRead, markRead],
  );

  const handleToggleMultiSelect = useCallback(
    (e: React.SyntheticEvent, thread: ThreadSummary) => {
      e.preventDefault();
      e.stopPropagation();
      const key = thread.latestMessage.threadId || thread.latestMessage.id;
      setFocusedId(thread.latestMessage.id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [setFocusedId, setSelectedIds],
  );

  const handleTrashThread = useCallback(
    (e: React.MouseEvent, thread: ThreadSummary) => {
      e.stopPropagation();
      if (view === "trash") return;
      const key = thread.latestMessage.threadId || thread.latestMessage.id;
      trashThreadKeys([key]);
    },
    [view, trashThreadKeys],
  );

  const handleArchiveThread = useCallback(
    (e: React.MouseEvent, thread: ThreadSummary) => {
      e.stopPropagation();
      archiveThreadKeys([
        thread.latestMessage.threadId || thread.latestMessage.id,
      ]);
    },
    [archiveThreadKeys],
  );

  const handleHoverThread = useCallback(
    (thread: ThreadSummary) => {
      setFocusedId(thread.latestMessage.id);
    },
    [setFocusedId],
  );

  const getScheduledJobId = useCallback(
    (email: EmailMessage): string | null =>
      view === "scheduled" && email.id.startsWith("scheduled-")
        ? email.id.slice("scheduled-".length)
        : null,
    [view],
  );

  const handleSendScheduledNow = useCallback(
    (e: React.MouseEvent, thread: ThreadSummary) => {
      e.stopPropagation();
      const jobId = getScheduledJobId(thread.latestMessage);
      if (!jobId) return;
      sendScheduledJobNow.mutate(jobId, {
        onSuccess: () => toast(t("mail.toasts.scheduledSent")),
        onError: (error) =>
          toast.error(
            error instanceof Error
              ? error.message
              : t("mail.toasts.scheduledSendFailed"),
          ),
      });
    },
    [getScheduledJobId, sendScheduledJobNow, t],
  );

  const handleCancelScheduled = useCallback(
    (e: React.MouseEvent, thread: ThreadSummary) => {
      e.stopPropagation();
      const jobId = getScheduledJobId(thread.latestMessage);
      if (!jobId) return;
      cancelScheduledJob.mutate(jobId, {
        onSuccess: () => toast(t("mail.toasts.scheduledCancelled")),
        onError: () => toast.error(t("mail.toasts.scheduledCancelFailed")),
      });
    },
    [getScheduledJobId, cancelScheduledJob, t],
  );

  // ── Swipe gesture handlers ─────────────────────────────────────────────
  // Swipe targets exactly one thread (the swiped one) — unlike the keyboard
  // `e` shortcut, which respects multi-selection. We also clear any existing
  // multi-selection so the next keyboard shortcut (e/d/u/s) doesn't act on a
  // stale set — getActionThreadKeys() prefers selectedIds over focusedId.
  const handleSwipeArchive = useCallback(
    (thread: ThreadSummary) => {
      const id = thread.latestMessage.id;
      const tid = thread.latestMessage.threadId || id;

      setSelectedIds(new Set());

      // Advance focus past the row that's about to disappear.
      const idx = threads.findIndex((t) => t.latestMessage.id === id);
      if (threads.length > 1) {
        const nextIdx =
          idx < threads.length - 1 ? idx + 1 : Math.max(0, idx - 1);
        setFocusedId(threads[nextIdx].latestMessage.id);
      } else {
        setFocusedId(null);
      }

      // Snapshot so undo can restore.
      const snapshots = emails.filter((e) => (e.threadId || e.id) === tid);
      onArchived?.(id);

      const undo = () => {
        unsuppressThread(tid);
        queryClient.setQueriesData<InfiniteEmails>(
          { queryKey: ["emails"] },
          (old) => {
            if (!old) return old;
            const firstPage = old.pages[0];
            const restored = [...(firstPage?.emails ?? []), ...snapshots].sort(
              (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
            );
            return {
              ...old,
              pages: [
                { ...firstPage, emails: restored },
                ...old.pages.slice(1),
              ],
            };
          },
        );
        unarchiveEmail.mutate(id);
      };
      setUndoAction(undo);
      toast(t("mail.toasts.archived"), {
        action: { label: t("mail.actions.undo"), onClick: undo },
      });
      archiveEmail.mutate({
        id,
        accountEmail: thread.latestMessage.accountEmail,
        removeLabel: labelParam || undefined,
        threadId: tid,
      });
    },
    [
      threads,
      emails,
      archiveEmail,
      unarchiveEmail,
      onArchived,
      labelParam,
      setFocusedId,
      setSelectedIds,
      queryClient,
    ],
  );

  // Snooze fires a global event that AppLayout's SnoozeModal listens for.
  // Routing through an event (instead of prop drilling) avoids coupling
  // the list to the layout's modal state. Clear multi-selection for the
  // same reason as handleSwipeArchive.
  const handleSwipeSnooze = useCallback(
    (thread: ThreadSummary) => {
      setSelectedIds(new Set());
      window.dispatchEvent(
        new CustomEvent("email:request-snooze", {
          detail: {
            emailId: thread.latestMessage.id,
            accountEmail: thread.latestMessage.accountEmail,
          },
        }),
      );
    },
    [setSelectedIds],
  );

  const handleSnoozeButtonClick = useCallback(
    (e: React.MouseEvent, thread: ThreadSummary) => {
      e.stopPropagation();
      handleSwipeSnooze(thread);
    },
    [handleSwipeSnooze],
  );

  const bulkHeaderActions = useMemo(
    () =>
      selectedIds.size > 0 ? (
        <div className="flex h-7 max-w-[calc(100vw-11rem)] shrink-0 items-center gap-1 rounded-md border border-border/50 bg-muted/50 px-1.5 text-muted-foreground shadow-sm">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={clearSelection}
                className="flex size-5 items-center justify-center rounded transition-colors hover:bg-accent hover:text-foreground"
                aria-label={t("mail.selection.clear")}
              >
                <IconX className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("mail.selection.clear")}</TooltipContent>
          </Tooltip>
          <span className="whitespace-nowrap text-xs font-medium text-foreground/80">
            {t("mail.selection.selected", { count: selectedIds.size })}
          </span>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex size-5 items-center justify-center rounded transition-colors hover:bg-accent hover:text-foreground"
                    aria-label={t("mail.selection.actions")}
                  >
                    <IconDots className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t("mail.selection.actions")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                onClick={archiveFocused}
                className="gap-2 text-xs"
              >
                <IconArchive className="h-3.5 w-3.5" />
                {t("mail.actions.archive")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={markFocusedRead}
                className="gap-2 text-xs"
              >
                <IconMailOpened className="h-3.5 w-3.5" />
                {t("mail.actions.markRead")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={markFocusedUnread}
                className="gap-2 text-xs"
              >
                <IconMail className="h-3.5 w-3.5" />
                {t("mail.actions.markUnread")}
              </DropdownMenuItem>
              {movableLabels.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="gap-2 text-xs">
                    <IconFolder className="h-3.5 w-3.5" />
                    {t("mail.actions.moveTo")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-72 w-56 overflow-y-auto">
                    {movableLabels.map((label) => (
                      <DropdownMenuItem
                        key={label.id}
                        onClick={() => moveFocusedToLabel(label.id, label.name)}
                        className="text-xs"
                      >
                        {label.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {view !== "trash" && (
                <DropdownMenuItem
                  onClick={trashFocused}
                  className="gap-2 text-xs text-destructive focus:text-destructive"
                >
                  <IconTrash className="h-3.5 w-3.5" />
                  {t("mail.actions.moveToTrash")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>
                {t("mail.selection.select")}
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={selectAllThreads} className="text-xs">
                {t("mail.selection.all")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={clearSelection} className="text-xs">
                {t("mail.selection.none")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={selectReadThreads} className="text-xs">
                {t("mail.selection.read")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={selectUnreadThreads}
                className="text-xs"
              >
                {t("mail.views.unread")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={selectStarredThreads}
                className="text-xs"
              >
                {t("mail.views.starred")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={selectUnstarredThreads}
                className="text-xs"
              >
                {t("mail.selection.unstarred")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null,
    [
      selectedIds.size,
      t,
      clearSelection,
      archiveFocused,
      markFocusedRead,
      markFocusedUnread,
      movableLabels,
      moveFocusedToLabel,
      view,
      trashFocused,
      selectAllThreads,
      selectReadThreads,
      selectUnreadThreads,
      selectStarredThreads,
      selectUnstarredThreads,
    ],
  );
  useSetHeaderActions(bulkHeaderActions);

  // Error state
  if (emailsError) {
    const needsCredentials =
      emailsError.message?.includes("GOOGLE_CLIENT_ID") ||
      emailsError.message?.includes("GOOGLE_CLIENT_SECRET");

    if (needsCredentials) {
      return (
        <div className="flex h-full flex-col" ref={containerRef}>
          <GoogleConnectBanner variant="hero" />
        </div>
      );
    }

    const isQuotaError = /\((429|403)\)|quota|rate limit/i.test(
      emailsError.message ?? "",
    );

    return (
      <EmailErrorState
        isQuotaError={isQuotaError}
        message={emailsError.message ?? ""}
        isFetching={isFetching}
        onRetry={refetch}
        containerRef={containerRef}
      />
    );
  }

  // Loading skeleton — Superhuman-style single-line rows
  if (isLoading) {
    return <MailLoadingState containerRef={containerRef} />;
  }

  // Empty state
  if (threads.length === 0) {
    if (searchQuery) {
      return (
        <div className="flex h-full flex-col" ref={containerRef}>
          <div className="flex flex-1 flex-col items-center justify-center">
            <div className="text-center px-8">
              <div className="mb-4">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  className="h-12 w-12 text-muted-foreground/30 mx-auto"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607z"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium text-foreground/80">
                {t("mail.empty.noSearchResults", { query: searchQuery })}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("mail.empty.tryDifferentKeywords")}
              </p>
            </div>
          </div>
        </div>
      );
    }
    if (view === "inbox" || view === "important") {
      return <InboxZero />;
    }
    return (
      <div className="flex h-full flex-col" ref={containerRef}>
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="text-center px-8">
            <p className="text-sm font-medium text-foreground/80">
              {t("mail.empty.nothingHere")}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {t(emptyStateHintKeyForView(view))}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const canArchiveInView =
    view !== "archive" &&
    view !== "trash" &&
    view !== "sent" &&
    view !== "drafts" &&
    view !== "scheduled" &&
    view !== "snoozed";
  const canSnoozeInView =
    view !== "snoozed" &&
    view !== "scheduled" &&
    view !== "sent" &&
    view !== "drafts" &&
    view !== "trash";
  const canTrashInView = view !== "trash";

  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div className="flex h-full flex-col" ref={containerRef}>
      <div className="flex-1 overflow-y-auto" ref={scrollParentRef}>
        <div
          style={{
            height: rowVirtualizer.getTotalSize(),
            position: "relative",
            width: "100%",
          }}
        >
          {virtualItems.map((virtualRow) => {
            const thread = threads[virtualRow.index];
            if (!thread) return null;
            return (
              <div
                key={virtualRow.key}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <EmailListItem
                  email={thread.latestMessage}
                  thread={thread}
                  isSelected={thread.latestMessage.id === threadId}
                  isFocused={thread.latestMessage.id === focusedId}
                  isMultiSelected={selectedIds.has(
                    thread.latestMessage.threadId || thread.latestMessage.id,
                  )}
                  canArchive={canArchiveInView}
                  canSnooze={canSnoozeInView}
                  canTrash={canTrashInView}
                  scheduledJobId={getScheduledJobId(thread.latestMessage)}
                  onSelect={handleSelect}
                  onToggleMultiSelect={handleToggleMultiSelect}
                  onStar={handleStar}
                  onToggleRead={handleToggleReadThread}
                  onArchive={handleArchiveThread}
                  onSnooze={handleSnoozeButtonClick}
                  onTrash={handleTrashThread}
                  onSendNow={handleSendScheduledNow}
                  onCancelSchedule={handleCancelScheduled}
                  onHover={handleHoverThread}
                  onSwipeArchive={handleSwipeArchive}
                  onSwipeSnooze={handleSwipeSnooze}
                  highlight={searchQuery}
                />
              </div>
            );
          })}
        </div>
        {/* Sentinel for infinite scroll + loading indicator — lives after the
            virtualizer's sized inner container so it still sits at the true
            end of scrollable content and the IntersectionObserver above
            continues to fire as the user nears the bottom. */}
        {hasNextPage && (
          <div
            ref={sentinelRef}
            className="flex items-center justify-center py-3"
          >
            {isFetchingNextPage && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner className="size-3 text-muted-foreground" />
                {t("mail.empty.loadingMore")}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
