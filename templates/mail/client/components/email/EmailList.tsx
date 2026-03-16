import { useEffect, useRef, useCallback } from "react";
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
import type { EmailMessage } from "@shared/types";
import { toast } from "sonner";

interface EmailListProps {
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
}

export function EmailList({ focusedId, setFocusedId }: EmailListProps) {
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

  const focusedIndex = emails.findIndex((e) => e.id === focusedId);

  const moveFocus = useCallback(
    (delta: number) => {
      if (emails.length === 0) return;
      const next = Math.max(
        0,
        Math.min(
          emails.length - 1,
          (focusedIndex === -1 ? 0 : focusedIndex) + delta,
        ),
      );
      setFocusedId(emails[next].id);
      // Scroll focused row into view
      const rows = containerRef.current?.querySelectorAll("[role='row']");
      rows?.[next]?.scrollIntoView({ block: "nearest" });
    },
    [emails, focusedIndex, setFocusedId],
  );

  const openFocused = useCallback(() => {
    if (!focusedId) return;
    const email = emails.find((e) => e.id === focusedId);
    if (!email) return;
    if (!email.isRead) markRead.mutate({ id: focusedId, isRead: true });
    navigate(`/${view}/${focusedId}`);
  }, [focusedId, emails, view, navigate, markRead]);

  const archiveFocused = useCallback(() => {
    if (!focusedId) return;
    archiveEmail.mutate(focusedId, {
      onSuccess: () => {
        toast.success("Archived");
        moveFocus(0);
      },
    });
  }, [focusedId, archiveEmail, moveFocus]);

  const trashFocused = useCallback(() => {
    if (!focusedId) return;
    trashEmail.mutate(focusedId, {
      onSuccess: () => {
        toast.success("Moved to trash");
        moveFocus(0);
      },
    });
  }, [focusedId, trashEmail, moveFocus]);

  const markFocusedRead = useCallback(() => {
    if (!focusedId) return;
    const email = emails.find((e) => e.id === focusedId);
    if (!email) return;
    markRead.mutate({ id: focusedId, isRead: !email.isRead });
  }, [focusedId, emails, markRead]);

  // Keyboard navigation
  useKeyboardShortcuts([
    { key: "j", handler: () => moveFocus(1) },
    { key: "ArrowDown", handler: () => moveFocus(1) },
    { key: "k", handler: () => moveFocus(-1) },
    { key: "ArrowUp", handler: () => moveFocus(-1) },
    { key: "Enter", handler: openFocused },
    { key: "e", handler: archiveFocused },
    { key: "d", handler: trashFocused },
    { key: "u", handler: markFocusedRead },
    { key: "r", handler: () => refetch() },
  ]);

  // Auto-focus first email when list loads
  useEffect(() => {
    if (emails.length > 0 && !focusedId) {
      setFocusedId(emails[0].id);
    }
  }, [emails, focusedId, setFocusedId]);

  const handleSelect = (email: EmailMessage) => {
    setFocusedId(email.id);
    if (!email.isRead) markRead.mutate({ id: email.id, isRead: true });
    navigate(`/${view}/${email.id}`);
  };

  const handleStar = (e: React.MouseEvent, email: EmailMessage) => {
    e.stopPropagation();
    toggleStar.mutate({ id: email.id, isStarred: !email.isStarred });
  };

  // Error state
  if (emailsError) {
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
  if (emails.length === 0) {
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
        {emails.map((email) => (
          <EmailListItem
            key={email.id}
            email={email}
            isSelected={email.id === threadId}
            isFocused={email.id === focusedId}
            onSelect={() => handleSelect(email)}
            onStar={(e) => handleStar(e, email)}
          />
        ))}
      </div>
    </div>
  );
}
