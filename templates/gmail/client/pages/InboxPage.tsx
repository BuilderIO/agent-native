import { useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmailList } from "@/components/email/EmailList";
import { EmailThread } from "@/components/email/EmailThread";

export function InboxPage() {
  const { threadId } = useParams<{ view: string; threadId: string }>();
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const hasThread = !!threadId;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Email list — full width on mobile when no thread, fixed width on desktop */}
      <div
        className={cn(
          "flex flex-col overflow-hidden transition-all duration-200",
          hasThread
            ? "hidden md:flex md:w-72 lg:w-80 xl:w-96 shrink-0"
            : "flex-1",
        )}
      >
        <EmailList focusedId={focusedId} setFocusedId={setFocusedId} />
      </div>

      {/* Thread pane */}
      {hasThread ? (
        <EmailThread />
      ) : (
        <div className="hidden md:flex flex-1 flex-col items-center justify-center gap-3 text-center bg-muted/10">
          <div className="rounded-2xl border border-border bg-card p-6">
            <Mail className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground">Select a message</p>
            <p className="text-xs text-muted-foreground mt-1">
              Choose from your inbox to read
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
              <span><kbd className="kbd-hint">J/K</kbd> navigate</span>
              <span><kbd className="kbd-hint">Enter</kbd> open</span>
              <span><kbd className="kbd-hint">C</kbd> compose</span>
              <span><kbd className="kbd-hint">⌘K</kbd> commands</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
