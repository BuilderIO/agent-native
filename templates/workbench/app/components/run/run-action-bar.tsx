import { useState } from "react";
import {
  IconArrowRight,
  IconPlayerPlay,
  IconPlayerStop,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useActionMutation } from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface RunActionBarProps {
  runId: string;
  canResume: boolean;
  canStop: boolean;
  linkedPrHref?: string;
}

/**
 * Sticky bottom action bar for the run detail. State-aware:
 * - Running runs show Stop.
 * - Paused / Failed / Stopped runs show Resume (with optional inline reply).
 * - When a linked PR exists, the bar also surfaces a "View linked PR" CTA.
 *
 * The Resume composer is a lightweight inline textarea, not a modal — the
 * bar already has the focus, and a one-line "Resume with answer" is the
 * dominant use case (matches the PRD's mockup).
 */
export function RunActionBar({
  runId,
  canResume,
  canStop,
  linkedPrHref,
}: RunActionBarProps) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [message, setMessage] = useState("");

  const stopMutation = useActionMutation<
    { ok: boolean; message?: string; error?: string },
    { runId: string; reason?: string }
  >("stop-run", {
    onSuccess: (data) => {
      if (data.ok) toast.success(data.message ?? "Run stopped.");
      else if (data.error) toast.error(data.error);
    },
    onError: (err) => toast.error(err.message),
  });

  const resumeMutation = useActionMutation<
    { ok: boolean; error?: string },
    { runId: string; message?: string }
  >("resume-run", {
    onSuccess: (data) => {
      if (data.ok) {
        toast.success("Resumed in the agent chat.");
        setComposerOpen(false);
        setMessage("");
      } else if (data.error) {
        toast.error(data.error);
      }
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 -mx-6 mt-6 border-t border-border bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80",
      )}
    >
      {composerOpen ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = message.trim();
            if (!trimmed) {
              toast.error("Type a message to resume the run.");
              return;
            }
            resumeMutation.mutate({ runId, message: trimmed });
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <textarea
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Reply to the agent…  (⌘/Ctrl + Enter to send · Esc to cancel)"
            rows={2}
            aria-label="Reply to the agent"
            className="min-h-[44px] flex-1 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
              if (e.key === "Escape") {
                setComposerOpen(false);
                setMessage("");
              }
            }}
          />
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="cursor-pointer"
              onClick={() => {
                setComposerOpen(false);
                setMessage("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="cursor-pointer"
              disabled={resumeMutation.isPending || !message.trim()}
            >
              Send
              <IconArrowRight size={14} aria-hidden />
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {canResume
              ? "Reply to keep the run going, or just resume to open it in chat."
              : canStop
                ? "This run is still in progress."
                : "Run is finished."}
          </div>
          <div className="flex items-center gap-2">
            {linkedPrHref ? (
              <Button
                asChild
                variant="outline"
                size="sm"
                className="cursor-pointer"
              >
                <a href={linkedPrHref}>
                  View linked PR
                  <IconArrowRight size={14} aria-hidden />
                </a>
              </Button>
            ) : null}
            {canStop ? (
              <Button
                variant="outline"
                size="sm"
                className="cursor-pointer"
                disabled={stopMutation.isPending}
                onClick={() => stopMutation.mutate({ runId })}
              >
                <IconPlayerStop size={14} aria-hidden />
                Stop
              </Button>
            ) : null}
            {canResume ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="cursor-pointer"
                  disabled={resumeMutation.isPending}
                  onClick={() => resumeMutation.mutate({ runId })}
                >
                  <IconPlayerPlay size={14} aria-hidden />
                  Resume
                </Button>
                <Button
                  size="sm"
                  className="cursor-pointer"
                  onClick={() => setComposerOpen(true)}
                >
                  Resume with answer
                  <IconArrowRight size={14} aria-hidden />
                </Button>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
