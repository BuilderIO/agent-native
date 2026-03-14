import { ChevronLeft, ChevronRight } from "lucide-react";
import { MessageCard } from "./MessageCard";
import type { SlackMessage, SlackUser } from "./hooks";

function MessageSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-full bg-muted" />
        <div className="flex-1 space-y-1">
          <div className="h-3.5 w-28 rounded bg-muted" />
        </div>
        <div className="h-3 w-20 rounded bg-muted" />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-full rounded bg-muted" />
        <div className="h-3 w-4/5 rounded bg-muted" />
        <div className="h-3 w-3/5 rounded bg-muted" />
      </div>
    </div>
  );
}

interface MessageListProps {
  messages: SlackMessage[] | undefined;
  users: Record<string, SlackUser> | undefined;
  isLoading: boolean;
  error: Error | null;
  emptyText?: string;
  // Server-side pagination
  page: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  onNextPage: () => void;
  onPrevPage: () => void;
}

export function MessageList({
  messages,
  users,
  isLoading,
  error,
  emptyText = "No messages found",
  page,
  hasNextPage,
  hasPrevPage,
  onNextPage,
  onPrevPage,
}: MessageListProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <MessageSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {error.message}
      </div>
    );
  }

  if (!messages?.length) {
    return (
      <div className="text-center py-12 text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {messages.map((msg) => (
        <MessageCard
          key={msg.ts}
          message={msg}
          user={msg.user ? users?.[msg.user] : msg.bot_id ? users?.[msg.bot_id] : undefined}
        />
      ))}

      {/* Pagination controls */}
      {(hasPrevPage || hasNextPage) && (
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={onPrevPage}
            disabled={!hasPrevPage}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md border border-border bg-card text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Previous
          </button>
          <span className="text-xs text-muted-foreground">
            Page {page + 1}
          </span>
          <button
            onClick={onNextPage}
            disabled={!hasNextPage}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md border border-border bg-card text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
