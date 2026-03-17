import { useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { EmailListItem } from "./EmailListItem";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import {
  useEmails,
  useMarkRead,
  useToggleStar,
  useArchiveEmail,
  useTrashEmail,
} from "@/hooks/use-emails";
import { GoogleConnectBanner } from "@/components/GoogleConnectBanner";
import type { EmailMessage } from "@shared/types";
import { setUndoAction } from "@/hooks/use-undo";
import { toast } from "sonner";

export interface ThreadSummary {
  /** The latest message in the thread (used for display and navigation) */
  latestMessage: EmailMessage;
  /** All unique participant names (senders), excluding the user */
  participants: string[];
  /** Total number of messages in the thread */
  messageCount: number;
  /** Whether any message in the thread is unread */
  hasUnread: boolean;
  /** Whether any message in the thread is starred */
  hasStarred: boolean;
  /** Union of all label IDs across thread messages */
  labelIds: string[];
}

/** Group flat email list into threads by threadId, sorted by latest message date */
export function groupIntoThreads(emails: EmailMessage[]): ThreadSummary[] {
  const threadMap = new Map<string, EmailMessage[]>();

  for (const email of emails) {
    const key = email.threadId || email.id;
    const existing = threadMap.get(key);
    if (existing) {
      existing.push(email);
    } else {
      threadMap.set(key, [email]);
    }
  }

  const threads: ThreadSummary[] = [];

  for (const messages of threadMap.values()) {
    // Sort messages by date ascending (oldest first) for participant ordering
    messages.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

    const latestMessage = messages[messages.length - 1];

    // Collect unique participant names in order of appearance
    const seen = new Set<string>();
    const participants: string[] = [];
    for (const msg of messages) {
      const name = msg.from.name || msg.from.email;
      if (!seen.has(name)) {
        seen.add(name);
        participants.push(name);
      }
    }

    // Merge labels across all messages
    const labelSet = new Set<string>();
    for (const msg of messages) {
      for (const l of msg.labelIds) labelSet.add(l);
    }

    threads.push({
      latestMessage,
      participants,
      messageCount: messages.length,
      hasUnread: messages.some((m) => !m.isRead),
      hasStarred: messages.some((m) => m.isStarred),
      labelIds: Array.from(labelSet),
    });
  }

  // Sort threads by latest message date descending
  threads.sort(
    (a, b) =>
      new Date(b.latestMessage.date).getTime() -
      new Date(a.latestMessage.date).getTime(),
  );

  return threads;
}

interface EmailListProps {
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
  onCompose?: (email: EmailMessage, mode: "reply" | "forward") => void;
  onArchived?: (id: string) => void;
  undoArchive?: (id: string) => void;
}

export function EmailList({
  focusedId,
  setFocusedId,
  onCompose,
  onArchived,
  undoArchive,
}: EmailListProps) {
  const navigate = useNavigate();
  const { view = "inbox", threadId } = useParams<{
    view: string;
    threadId: string;
  }>();
  const [searchParams] = useSearchParams();
  const searchQuery = searchParams.get("q") ?? undefined;

  const {
    data: emails = [],
    isLoading,
    error: emailsError,
    refetch,
  } = useEmails(view, searchQuery);
  const markRead = useMarkRead();
  const toggleStar = useToggleStar();
  const archiveEmail = useArchiveEmail();
  const trashEmail = useTrashEmail();

  const containerRef = useRef<HTMLDivElement>(null);

  // Group emails into threads
  const threads = useMemo(() => groupIntoThreads(emails), [emails]);

  const focusedIndex = threads.findIndex(
    (t) => t.latestMessage.id === focusedId,
  );

  const moveFocus = useCallback(
    (delta: number) => {
      if (threads.length === 0) return;
      const next = Math.max(
        0,
        Math.min(
          threads.length - 1,
          (focusedIndex === -1 ? 0 : focusedIndex) + delta,
        ),
      );
      setFocusedId(threads[next].latestMessage.id);
      // Scroll focused row into view
      const rows = containerRef.current?.querySelectorAll("[role='row']");
      rows?.[next]?.scrollIntoView({ block: "nearest" });
    },
    [threads, focusedIndex, setFocusedId],
  );

  const openFocused = useCallback(() => {
    if (!focusedId) return;
    const thread = threads.find((t) => t.latestMessage.id === focusedId);
    if (!thread) return;
    if (!thread.latestMessage.isRead)
      markRead.mutate({ id: focusedId, isRead: true });
    navigate(`/${view}/${thread.latestMessage.threadId || focusedId}`);
  }, [focusedId, threads, view, navigate, markRead]);

  const archiveFocused = useCallback(() => {
    if (!focusedId) return;
    const id = focusedId;
    onArchived?.(id);
    const undo = () => undoArchive?.(id);
    setUndoAction(undo);
    toast("Marked as Done.", {
      action: {
        label: "UNDO",
        onClick: undo,
      },
    });
    archiveEmail.mutate(id);
  }, [focusedId, archiveEmail, onArchived, undoArchive]);

  const trashFocused = useCallback(() => {
    if (!focusedId) return;
    toast("Moved to Trash.");
    trashEmail.mutate(focusedId);
  }, [focusedId, trashEmail]);

  const toggleFocusedRead = useCallback(() => {
    if (!focusedId) return;
    const thread = threads.find((t) => t.latestMessage.id === focusedId);
    if (!thread) return;
    markRead.mutate({ id: focusedId, isRead: !thread.latestMessage.isRead });
  }, [focusedId, threads, markRead]);

  const markFocusedRead = useCallback(() => {
    if (!focusedId) return;
    markRead.mutate({ id: focusedId, isRead: true });
  }, [focusedId, markRead]);

  const markFocusedUnread = useCallback(() => {
    if (!focusedId) return;
    markRead.mutate({ id: focusedId, isRead: false });
  }, [focusedId, markRead]);

  const starFocused = useCallback(() => {
    if (!focusedId) return;
    const thread = threads.find((t) => t.latestMessage.id === focusedId);
    if (!thread) return;
    toggleStar.mutate({
      id: focusedId,
      isStarred: !thread.latestMessage.isStarred,
    });
  }, [focusedId, threads, toggleStar]);

  const replyFocused = useCallback(() => {
    if (!focusedId || !onCompose) return;
    const thread = threads.find((t) => t.latestMessage.id === focusedId);
    if (thread) onCompose(thread.latestMessage, "reply");
  }, [focusedId, threads, onCompose]);

  const forwardFocused = useCallback(() => {
    if (!focusedId || !onCompose) return;
    const thread = threads.find((t) => t.latestMessage.id === focusedId);
    if (thread) onCompose(thread.latestMessage, "forward");
  }, [focusedId, threads, onCompose]);

  // Keyboard navigation — Gmail / Superhuman standard shortcuts
  useKeyboardShortcuts([
    { key: "j", handler: () => moveFocus(1) },
    { key: "ArrowDown", handler: () => moveFocus(1) },
    { key: "k", handler: () => moveFocus(-1) },
    { key: "ArrowUp", handler: () => moveFocus(-1) },
    { key: "Enter", handler: openFocused },
    { key: "o", handler: openFocused },
    { key: "e", handler: archiveFocused },
    { key: "d", handler: trashFocused },
    { key: "#", handler: trashFocused, shift: true },
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

  const handleSelect = (thread: ThreadSummary) => {
    const email = thread.latestMessage;
    setFocusedId(email.id);
    if (!email.isRead) markRead.mutate({ id: email.id, isRead: true });
    navigate(`/${view}/${email.threadId || email.id}`);
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

  // Empty state — Superhuman "Inbox Zero" style
  if (threads.length === 0) {
    return (
      <div className="flex h-full flex-col" ref={containerRef}>
        <div className="flex flex-1 flex-col items-center justify-center">
          {searchQuery ? (
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
          ) : (
            <div className="text-center px-8">
              {/* Gradient landscape placeholder */}
              <div className="relative w-full max-w-md h-48 rounded-xl overflow-hidden mb-6 mx-auto">
                <div className="absolute inset-0 bg-gradient-to-br from-[hsl(220,10%,18%)] via-[hsl(220,8%,15%)] to-[hsl(220,6%,10%)]" />
                <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-[hsl(220,6%,10%)] to-transparent" />
                {/* Stylized mountain silhouette */}
                <svg
                  viewBox="0 0 400 120"
                  className="absolute bottom-0 left-0 right-0 w-full"
                  preserveAspectRatio="none"
                >
                  <path
                    d="M0 120 L0 80 L80 40 L130 65 L200 20 L260 55 L320 30 L400 70 L400 120 Z"
                    fill="hsl(220,6%,10%)"
                    opacity="0.8"
                  />
                  <path
                    d="M0 120 L0 90 L60 60 L120 80 L180 45 L250 70 L340 50 L400 85 L400 120 Z"
                    fill="hsl(220,6%,10%)"
                  />
                </svg>
              </div>
              <p className="text-lg font-medium text-foreground/90">
                You&rsquo;ve hit Inbox Zero
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                You&rsquo;re all caught up
              </p>
            </div>
          )}
        </div>
      </div>
    );
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
          />
        ))}
      </div>
    </div>
  );
}
