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
  useTrashEmail,
  useUntrashEmail,
} from "@/hooks/use-emails";
import { useQueryClient } from "@tanstack/react-query";
import { GoogleConnectBanner } from "@/components/GoogleConnectBanner";
import type { EmailMessage } from "@shared/types";
import { setUndoAction } from "@/hooks/use-undo";
import { toast } from "sonner";
import { groupIntoThreads, type ThreadSummary } from "@/lib/threads";

interface EmailListProps {
  emails?: EmailMessage[];
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
  onCompose?: (email: EmailMessage, mode: "reply" | "forward") => void;
  onArchived?: (id: string) => void;
  undoArchive?: (id: string) => void;
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
  "photo-1500534314263-0869cef46947", // Aurora borealis
  "photo-1507525428034-b723cf961d3e", // Tropical beach
  "photo-1505765050516-f72dcac9c60e", // Mountain reflection lake
  "photo-1464822759023-fed622ff2c3b", // Snow-capped mountain
  "photo-1433086966358-54859d0ed716", // Waterfall in forest
  "photo-1501854140801-50d01698950b", // Aerial forest
  "photo-1518173946687-a24f76e138a6", // Pink sky desert
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
  onCompose,
  onArchived,
  undoArchive,
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
  } = useEmails(view, searchQuery);

  const emails = emailsProp ?? fetchedEmails;
  const markRead = useMarkRead();
  const markThreadRead = useMarkThreadRead();
  const toggleStar = useToggleStar();
  const archiveEmail = useArchiveEmail();
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

  const moveFocus = useCallback(
    (delta: number) => {
      if (threads.length === 0) return;
      const current = focusedIndexRef.current;
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
    [threads, setFocusedId],
  );

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
    const id = focusedIdRef.current;
    if (!id) return;
    const idx = threads.findIndex((t) => t.latestMessage.id === id);

    // Move focus to the next email (or previous if at end)
    if (threads.length > 1) {
      const nextIdx = idx < threads.length - 1 ? idx + 1 : idx - 1;
      setFocusedId(threads[nextIdx].latestMessage.id);
    } else {
      setFocusedId(null);
    }

    onArchived?.(id);
    const undo = () => undoArchive?.(id);
    setUndoAction(undo);
    toast("Marked as Done.", {
      action: {
        label: "UNDO",
        onClick: undo,
      },
    });
    const thread = threads.find((t) => t.latestMessage.id === id);
    archiveEmail.mutate({
      id,
      accountEmail: thread?.latestMessage.accountEmail,
    });
  }, [threads, archiveEmail, onArchived, undoArchive, setFocusedId]);

  const trashFocused = useCallback(() => {
    const id = focusedIdRef.current;
    if (!id) return;
    const idx = threads.findIndex((t) => t.latestMessage.id === id);

    if (threads.length > 1) {
      const nextIdx = idx < threads.length - 1 ? idx + 1 : idx - 1;
      setFocusedId(threads[nextIdx].latestMessage.id);
    } else {
      setFocusedId(null);
    }

    const undo = () => untrashEmail.mutate(id);
    setUndoAction(undo);
    toast("Moved to Trash.", {
      action: {
        label: "UNDO",
        onClick: undo,
      },
    });
    trashEmail.mutate(id);
  }, [threads, trashEmail, untrashEmail, setFocusedId]);

  const toggleFocusedRead = useCallback(() => {
    const id = focusedIdRef.current;
    if (!id) return;
    const thread = threads.find((t) => t.latestMessage.id === id);
    if (!thread) return;
    markRead.mutate({ id, isRead: !thread.latestMessage.isRead });
  }, [threads, markRead]);

  const markFocusedRead = useCallback(() => {
    const id = focusedIdRef.current;
    if (!id) return;
    markRead.mutate({ id, isRead: true });
  }, [markRead]);

  const markFocusedUnread = useCallback(() => {
    const id = focusedIdRef.current;
    if (!id) return;
    markRead.mutate({ id, isRead: false });
  }, [markRead]);

  const starFocused = useCallback(() => {
    const id = focusedIdRef.current;
    if (!id) return;
    const thread = threads.find((t) => t.latestMessage.id === id);
    if (!thread) return;
    toggleStar.mutate({
      id,
      isStarred: !thread.latestMessage.isStarred,
    });
  }, [threads, toggleStar]);

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

  // Keyboard navigation — Gmail / Superhuman standard shortcuts
  useKeyboardShortcuts([
    { key: "j", handler: () => moveFocus(1) },
    { key: "ArrowDown", handler: () => moveFocus(1) },
    { key: "k", handler: () => moveFocus(-1) },
    { key: "ArrowUp", handler: () => moveFocus(-1) },
    { key: "Enter", handler: openFocused },
    { key: "o", handler: openFocused },
    { key: "e", handler: archiveFocused },
    { key: "u", handler: toggleFocusedRead },
    { key: "I", handler: markFocusedRead, shift: true },
    { key: "U", handler: markFocusedUnread, shift: true },
    { key: "s", handler: starFocused },
    { key: "r", handler: replyFocused },
    { key: "f", handler: forwardFocused },
    { key: "a", handler: replyFocused }, // reply-all (same as reply for single messages)
  ]);

  // Auto-focus first thread when list loads
  useEffect(() => {
    if (threads.length > 0 && !focusedId) {
      setFocusedId(threads[0].latestMessage.id);
    }
  }, [threads, focusedId, setFocusedId]);

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
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-6 py-4 max-w-md text-center">
            <p className="text-sm font-medium text-red-400">
              Failed to load emails
            </p>
            <p className="mt-1 text-xs text-red-400/70">
              {emailsError.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-3 text-xs text-foreground/60 hover:text-foreground underline underline-offset-2"
            >
              Reload page
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
            <div key={i} className="flex items-center gap-3 px-4 h-[38px]">
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
          />
        ))}
      </div>
    </div>
  );
}
