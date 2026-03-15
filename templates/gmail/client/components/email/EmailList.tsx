import { useEffect, useRef, useCallback } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { RefreshCw, Search, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
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

  const viewLabels: Record<string, string> = {
    inbox: "Inbox",
    starred: "Starred",
    sent: "Sent",
    drafts: "Drafts",
    archive: "Archive",
    trash: "Trash",
    all: "All Mail",
  };
  const viewTitle =
    viewLabels[view] ??
    (view.startsWith("label:") ? view.replace("label:", "") : view);

  return (
    <div
      className="flex h-full flex-col border-r border-border"
      ref={containerRef}
    >
      {/* List header */}
      <div className="flex h-11 shrink-0 items-center justify-between px-4">
        <h2 className="text-sm font-semibold text-foreground">{viewTitle}</h2>
        <div className="flex items-center gap-1">
          {searchQuery && (
            <span className="text-xs text-muted-foreground">
              {emails.length} result{emails.length !== 1 ? "s" : ""}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => refetch()}
            title="Refresh (R)"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", isLoading && "animate-spin")}
            />
          </Button>
        </div>
      </div>

      {/* Email list */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 py-2">
                <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-1/3 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-2/3 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : emails.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 pt-20 text-center px-8">
            {searchQuery ? (
              <Search className="h-10 w-10 text-muted-foreground/40" />
            ) : (
              <Inbox className="h-10 w-10 text-muted-foreground/40" />
            )}
            <div>
              <p className="text-sm font-medium text-foreground">
                {searchQuery
                  ? `No results for "${searchQuery}"`
                  : `${viewTitle} is empty`}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {searchQuery
                  ? "Try different keywords"
                  : "You're all caught up!"}
              </p>
            </div>
          </div>
        ) : (
          <div>
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
        )}
      </ScrollArea>

      {/* Keyboard hint bar */}
      {emails.length > 0 && (
        <div className="hidden md:flex shrink-0 items-center gap-3 border-t border-border px-4 py-1.5 text-xs text-muted-foreground">
          <span>
            <kbd className="kbd-hint">J/K</kbd> navigate
          </span>
          <span>
            <kbd className="kbd-hint">Enter</kbd> open
          </span>
          <span>
            <kbd className="kbd-hint">E</kbd> archive
          </span>
          <span>
            <kbd className="kbd-hint">D</kbd> trash
          </span>
          <span>
            <kbd className="kbd-hint">U</kbd> mark read
          </span>
        </div>
      )}
    </div>
  );
}
