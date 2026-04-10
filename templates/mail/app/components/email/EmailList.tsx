import { IconAlertCircle } from "@tabler/icons-react";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { cn } from "@/lib/utils";
import { EmailListItem } from "./EmailListItem";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import {
  fetchThreadMessages,
  useEmails,
  useMarkRead,
  useMarkThreadRead,
  useToggleStar,
  useArchiveEmail,
  useUnarchiveEmail,
  useTrashEmail,
  useUntrashEmail,
} from "@/hooks/use-emails";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { GoogleConnectBanner } from "@/components/GoogleConnectBanner";
import type { EmailMessage } from "@shared/types";

type EmailsPage = { emails: EmailMessage[]; nextPageToken?: string };
type InfiniteEmails = InfiniteData<EmailsPage, string | undefined>;
import { setUndoAction } from "@/hooks/use-undo";
import { toast } from "sonner";
import { groupIntoThreads, type ThreadSummary } from "@/lib/threads";

interface EmailListProps {
  emails?: EmailMessage[];
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  onCompose?: (email: EmailMessage, mode: "reply" | "forward") => void;
  onArchived?: (id: string) => void;
  onDraftOpen?: (email: EmailMessage) => void;
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

export function InboxZero() {
  const [loaded, setLoaded] = useState(false);

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
      <img
        src={imageUrl}
        alt=""
        onLoad={() => setLoaded(true)}
        className={cn(
          "fixed inset-0 h-full w-full object-cover",
          loaded ? "opacity-100" : "opacity-0",
        )}
      />

      {/* Top gradient — darken behind the tab bar */}
      <div className="fixed inset-x-0 top-0 h-24 bg-gradient-to-b from-black/50 to-transparent" />

      {/* Bottom gradient — text legibility */}
      <div className="fixed inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/60 to-transparent" />

      {/* Fallback bg while image loads */}
      <div className="absolute inset-0 bg-muted dark:bg-[hsl(220,6%,8%)] -z-10" />

      {/* Bottom text */}
      <div className="relative mt-auto px-6 pb-6">
        <p className="text-[15px] font-medium text-white/90 drop-shadow-lg">
          You&rsquo;ve hit Inbox Zero
        </p>
        <p className="text-[13px] text-white/60 drop-shadow-lg mt-0.5">
          You&rsquo;re all caught up
        </p>
      </div>
    </div>
  );
}

// ─── Email List ─────────────────────────────────────────────────────────────

export function EmailList({
  emails: emailsProp,
  focusedId,
  setFocusedId,
  selectedIds,
  setSelectedIds,
  onCompose,
  onArchived,
  onDraftOpen,
}: EmailListProps) {
  const navigate = useNavigate();
  const { view = "inbox", threadId } = useParams<{
    view: string;
    threadId: string;
  }>();
  const [searchParams] = useSearchParams();
  const searchQuery = searchParams.get("q") ?? undefined;
  const labelParam = searchParams.get("label");
  const labelSuffix = labelParam
    ? `?label=${encodeURIComponent(labelParam)}`
    : "";

  const {
    data: fetchedEmails = [],
    isLoading,
    error: emailsError,
    refetch,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useEmails(view, searchQuery);

  const emails = emailsProp ?? fetchedEmails;
  const markRead = useMarkRead();
  const markThreadRead = useMarkThreadRead();
  const toggleStar = useToggleStar();
  const archiveEmail = useArchiveEmail();
  const unarchiveEmail = useUnarchiveEmail();
  const trashEmail = useTrashEmail();
  const untrashEmail = useUntrashEmail();
  const queryClient = useQueryClient();

  const containerRef = useRef<HTMLDivElement>(null);

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
      // Scroll focused row into view
      const rows = containerRef.current?.querySelectorAll("[role='row']");
      rows?.[next]?.scrollIntoView({ block: "nearest" });
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
      const newFocusId = threads[next].latestMessage.id;

      setSelectedIds((prev) => {
        const updated = new Set(prev);
        // Include anchor on first shift-move
        if (prev.size === 0 && focusedIdRef.current) {
          updated.add(focusedIdRef.current);
        }
        updated.add(newFocusId);
        return updated;
      });

      setFocusedId(newFocusId);
      focusedIndexRef.current = next;
      // Scroll into view
      const rows = containerRef.current?.querySelectorAll("[role='row']");
      rows?.[next]?.scrollIntoView({ block: "nearest" });
    },
    [threads, setFocusedId, setSelectedIds],
  );

  const getActionIds = useCallback((): string[] => {
    if (selectedIdsRef.current.size > 0)
      return Array.from(selectedIdsRef.current);
    const id = focusedIdRef.current;
    return id ? [id] : [];
  }, []);

  const openFocused = useCallback(() => {
    const id = focusedIdRef.current;
    if (!id) return;
    const thread = threads.find((t) => t.latestMessage.id === id);
    if (!thread) return;
    const targetThreadId = thread.latestMessage.threadId || id;
    if (thread.hasUnread) {
      markThreadRead.mutate(targetThreadId);
    }
    void queryClient.prefetchQuery({
      queryKey: ["thread-messages", targetThreadId],
      queryFn: () => fetchThreadMessages(targetThreadId),
      staleTime: 30_000,
    });
    navigate(`/${view}/${targetThreadId}${labelSuffix}`);
  }, [threads, view, navigate, markThreadRead, labelSuffix, queryClient]);

  const archiveFocused = useCallback(() => {
    const ids = getActionIds();
    if (ids.length === 0) return;
    const actionIdSet = new Set(ids);

    // Move focus to the next non-selected email (or previous if at end)
    const lastIdx = threads.findIndex(
      (t) => t.latestMessage.id === ids[ids.length - 1],
    );
    const remaining = threads.filter(
      (t) => !actionIdSet.has(t.latestMessage.id),
    );
    if (remaining.length > 0) {
      const nextIdx = Math.min(lastIdx, remaining.length - 1);
      setFocusedId(remaining[nextIdx].latestMessage.id);
    } else {
      setFocusedId(null);
    }

    // Snapshot removed thread emails so undo can restore them
    const snapshots: EmailMessage[] = [];
    for (const id of ids) {
      const thread = threads.find((t) => t.latestMessage.id === id);
      const tid = thread?.latestMessage.threadId || id;
      snapshots.push(...emails.filter((e) => (e.threadId || e.id) === tid));
      onArchived?.(id);
    }

    const undo = () => {
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
            pages: [{ ...firstPage, emails: restored }, ...old.pages.slice(1)],
          };
        },
      );
      for (const id of ids) unarchiveEmail.mutate(id);
    };
    setUndoAction(undo);
    toast(
      ids.length > 1
        ? `Archived ${ids.length} conversations.`
        : "Marked as Done.",
      { action: { label: "UNDO", onClick: undo } },
    );
    for (const id of ids) {
      const thread = threads.find((t) => t.latestMessage.id === id);
      archiveEmail.mutate({
        id,
        accountEmail: thread?.latestMessage.accountEmail,
        removeLabel: labelParam || undefined,
      });
    }
    setSelectedIds(new Set());
  }, [
    threads,
    emails,
    archiveEmail,
    unarchiveEmail,
    onArchived,
    labelParam,
    setFocusedId,
    setSelectedIds,
    getActionIds,
    queryClient,
  ]);

  const trashFocused = useCallback(() => {
    const ids = getActionIds();
    if (ids.length === 0) return;
    const actionIdSet = new Set(ids);

    // Move focus to the next non-selected email
    const lastIdx = threads.findIndex(
      (t) => t.latestMessage.id === ids[ids.length - 1],
    );
    const remaining = threads.filter(
      (t) => !actionIdSet.has(t.latestMessage.id),
    );
    if (remaining.length > 0) {
      const nextIdx = Math.min(lastIdx, remaining.length - 1);
      setFocusedId(remaining[nextIdx].latestMessage.id);
    } else {
      setFocusedId(null);
    }

    // Snapshot removed thread emails so undo can restore them
    const snapshots: EmailMessage[] = [];
    for (const id of ids) {
      const thread = threads.find((t) => t.latestMessage.id === id);
      const tid = thread?.latestMessage.threadId || id;
      snapshots.push(...emails.filter((e) => (e.threadId || e.id) === tid));
    }

    const undo = () => {
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
            pages: [{ ...firstPage, emails: restored }, ...old.pages.slice(1)],
          };
        },
      );
      for (const id of ids) untrashEmail.mutate(id);
    };
    setUndoAction(undo);
    toast(
      ids.length > 1
        ? `Trashed ${ids.length} conversations.`
        : "Moved to Trash.",
      { action: { label: "UNDO", onClick: undo } },
    );
    for (const id of ids) trashEmail.mutate(id);
    setSelectedIds(new Set());
  }, [
    threads,
    emails,
    trashEmail,
    untrashEmail,
    setFocusedId,
    setSelectedIds,
    getActionIds,
    queryClient,
  ]);

  const toggleFocusedRead = useCallback(() => {
    const ids = getActionIds();
    if (ids.length === 0) return;
    for (const id of ids) {
      const thread = threads.find((t) => t.latestMessage.id === id);
      if (!thread) continue;
      markRead.mutate({
        id,
        isRead: !thread.latestMessage.isRead,
        accountEmail: thread.latestMessage.accountEmail,
      });
    }
    setSelectedIds(new Set());
  }, [threads, markRead, getActionIds, setSelectedIds]);

  const markFocusedRead = useCallback(() => {
    const ids = getActionIds();
    for (const id of ids) {
      const thread = threads.find((t) => t.latestMessage.id === id);
      markRead.mutate({
        id,
        isRead: true,
        accountEmail: thread?.latestMessage.accountEmail,
      });
    }
    setSelectedIds(new Set());
  }, [threads, markRead, getActionIds, setSelectedIds]);

  const markFocusedUnread = useCallback(() => {
    const ids = getActionIds();
    for (const id of ids) {
      const thread = threads.find((t) => t.latestMessage.id === id);
      markRead.mutate({
        id,
        isRead: false,
        accountEmail: thread?.latestMessage.accountEmail,
      });
    }
    setSelectedIds(new Set());
  }, [threads, markRead, getActionIds, setSelectedIds]);

  const starFocused = useCallback(() => {
    const ids = getActionIds();
    if (ids.length === 0) return;
    for (const id of ids) {
      const thread = threads.find((t) => t.latestMessage.id === id);
      if (!thread) continue;
      toggleStar.mutate({
        id,
        isStarred: !thread.latestMessage.isStarred,
      });
    }
    setSelectedIds(new Set());
  }, [threads, toggleStar, getActionIds, setSelectedIds]);

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

  // Prefetch ±1 around focused item for instant j/k response
  useEffect(() => {
    if (!focusedId) return;
    const index = threads.findIndex((t) => t.latestMessage.id === focusedId);
    if (index === -1) return;

    const threadIdsToWarm = new Set<string>();
    for (const candidate of [
      threads[index - 1],
      threads[index],
      threads[index + 1],
    ]) {
      const id =
        candidate?.latestMessage.threadId || candidate?.latestMessage.id;
      if (id) threadIdsToWarm.add(id);
    }

    threadIdsToWarm.forEach((threadId) => {
      void queryClient.prefetchQuery({
        queryKey: ["thread-messages", threadId],
        queryFn: () => fetchThreadMessages(threadId),
        staleTime: 30_000,
      });
    });
  }, [focusedId, threads, queryClient]);

  // Prefetch all visible threads so any click/Enter opens instantly
  useEffect(() => {
    const container = containerRef.current;
    if (!container || threads.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = (entry.target as HTMLElement).dataset.threadId;
          if (id) {
            void queryClient.prefetchQuery({
              queryKey: ["thread-messages", id],
              queryFn: () => fetchThreadMessages(id),
              staleTime: 30_000,
            });
          }
        }
      },
      { root: container.querySelector(".overflow-y-auto"), threshold: 0 },
    );

    // Observe all rows after a tick (rows need to be rendered)
    const raf = requestAnimationFrame(() => {
      const rows = container.querySelectorAll<HTMLElement>("[data-thread-id]");
      rows.forEach((row) => observer.observe(row));
    });

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [threads, queryClient]);

  // Infinite scroll — fetch next page when the sentinel enters the viewport
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Advance selection when an email is snoozed (same logic as archiveFocused)
  useEffect(() => {
    const handler = (e: Event) => {
      const emailId = (e as CustomEvent<{ emailId: string }>).detail.emailId;
      const idx = threads.findIndex((t) => t.latestMessage.id === emailId);
      if (idx === -1) return;
      if (threads.length > 1) {
        const nextIdx = idx < threads.length - 1 ? idx + 1 : idx - 1;
        setFocusedId(threads[nextIdx].latestMessage.id);
      } else {
        setFocusedId(null);
      }
    };
    window.addEventListener("email:snoozed", handler);
    return () => window.removeEventListener("email:snoozed", handler);
  }, [threads, setFocusedId]);

  const handleSelect = (thread: ThreadSummary) => {
    const email = thread.latestMessage;
    const targetThreadId = email.threadId || email.id;
    setFocusedId(email.id);
    // Draft emails: open in compose window instead of thread view
    if (email.isDraft && onDraftOpen) {
      onDraftOpen(email);
      return;
    }
    if (thread.hasUnread) {
      markThreadRead.mutate(targetThreadId);
    }
    void queryClient.prefetchQuery({
      queryKey: ["thread-messages", targetThreadId],
      queryFn: () => fetchThreadMessages(targetThreadId),
      staleTime: 30_000,
    });
    navigate(`/${view}/${targetThreadId}${labelSuffix}`);
  };

  const handleStar = (e: React.MouseEvent, thread: ThreadSummary) => {
    e.stopPropagation();
    const email = thread.latestMessage;
    toggleStar.mutate({ id: email.id, isStarred: !email.isStarred });
  };

  // ── Swipe gesture handlers ─────────────────────────────────────────────
  // Swipe targets exactly one thread (the swiped one) — unlike the keyboard
  // `e` shortcut, which respects multi-selection.
  const handleSwipeArchive = useCallback(
    (thread: ThreadSummary) => {
      const id = thread.latestMessage.id;
      const tid = thread.latestMessage.threadId || id;

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
      toast("Marked as Done.", {
        action: { label: "UNDO", onClick: undo },
      });
      archiveEmail.mutate({
        id,
        accountEmail: thread.latestMessage.accountEmail,
        removeLabel: labelParam || undefined,
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
      queryClient,
    ],
  );

  // Snooze fires a global event that AppLayout's SnoozeModal listens for.
  // Routing through an event (instead of prop drilling) avoids coupling
  // the list to the layout's modal state.
  const handleSwipeSnooze = useCallback((thread: ThreadSummary) => {
    window.dispatchEvent(
      new CustomEvent("email:request-snooze", {
        detail: {
          emailId: thread.latestMessage.id,
          accountEmail: thread.latestMessage.accountEmail,
        },
      }),
    );
  }, []);

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

    return (
      <div className="flex h-full flex-col" ref={containerRef}>
        <div className="flex flex-1 flex-col items-center justify-center px-8">
          <div className="flex flex-col items-center gap-3 max-w-xs text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
              <IconAlertCircle className="h-5 w-5 text-destructive" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                Unable to load emails
              </p>
              <p className="text-xs text-muted-foreground">
                {emailsError.message}
              </p>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="mt-1 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Loading skeleton — Superhuman-style single-line rows
  if (isLoading) {
    return (
      <div className="flex h-full flex-col" ref={containerRef}>
        <div className="flex-1 overflow-y-auto">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-4 h-[48px] sm:h-[38px]"
            >
              <div className="h-2 w-2 rounded-full bg-muted animate-pulse" />
              <div className="h-3 w-28 rounded bg-muted animate-pulse" />
              <div className="h-3 w-48 rounded bg-muted animate-pulse flex-1" />
              <div className="h-3 w-12 rounded bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
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
                No results for &ldquo;{searchQuery}&rdquo;
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Try different keywords
              </p>
            </div>
          </div>
        </div>
      );
    }
    return <InboxZero />;
  }

  return (
    <div className="flex h-full flex-col" ref={containerRef}>
      <div className="flex-1 overflow-y-auto">
        {threads.map((thread) => (
          <EmailListItem
            key={thread.latestMessage.id}
            email={thread.latestMessage}
            thread={thread}
            isSelected={thread.latestMessage.id === threadId}
            isFocused={thread.latestMessage.id === focusedId}
            isMultiSelected={selectedIds.has(thread.latestMessage.id)}
            onSelect={() => handleSelect(thread)}
            onStar={(e) => handleStar(e, thread)}
            onHover={() => {
              setFocusedId(thread.latestMessage.id);
              const targetThreadId =
                thread.latestMessage.threadId || thread.latestMessage.id;
              void queryClient.prefetchQuery({
                queryKey: ["thread-messages", targetThreadId],
                queryFn: () => fetchThreadMessages(targetThreadId),
                staleTime: 30_000,
              });
            }}
            onSwipeArchive={() => handleSwipeArchive(thread)}
            onSwipeSnooze={() => handleSwipeSnooze(thread)}
          />
        ))}
        {/* Sentinel for infinite scroll + loading indicator */}
        {hasNextPage && (
          <div
            ref={sentinelRef}
            className="flex items-center justify-center py-3"
          >
            {isFetchingNextPage && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="h-3 w-3 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
                Loading more...
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
