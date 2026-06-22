import { useRef, useState } from "react";
import { IconMessagePlus, IconSend } from "@tabler/icons-react";
import { useActionMutation } from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { msToClock } from "./scrubber";

interface TimestampedCommentButtonProps {
  recordingId: string;
  enableComments: boolean;
  /** Reads the live playback position so the comment is pinned to the right moment. */
  getCurrentMs: () => number;
  onAdded?: () => void;
  className?: string;
}

export function TimestampedCommentButton({
  recordingId,
  enableComments,
  getCurrentMs,
  onAdded,
  className,
}: TimestampedCommentButtonProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [atMs, setAtMs] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const addComment = useActionMutation("add-comment");

  if (!enableComments) return null;

  const openComposer = () => {
    setAtMs(getCurrentMs());
    setOpen(true);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const submit = () => {
    const content = draft.trim();
    if (!content) return;
    addComment.mutate(
      { recordingId, content, videoTimestampMs: atMs },
      {
        onSuccess: () => {
          setDraft("");
          setOpen(false);
          onAdded?.();
        },
      },
    );
  };

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn("gap-1.5", className)}
        onClick={openComposer}
      >
        <IconMessagePlus className="h-4 w-4" />
        Comment
      </Button>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border bg-card p-2 shadow-sm",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <IconMessagePlus className="h-3.5 w-3.5" />
        Commenting at
        <span className="font-mono text-foreground">{msToClock(atMs)}</span>
      </div>
      <Textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
          }
        }}
        placeholder="Add a comment at this moment…"
        rows={2}
        className="min-h-[2.5rem] resize-none text-sm"
      />
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          className="gap-1.5"
          disabled={!draft.trim() || addComment.isPending}
          onClick={submit}
        >
          <IconSend className="h-4 w-4" />
          Comment
        </Button>
      </div>
    </div>
  );
}
