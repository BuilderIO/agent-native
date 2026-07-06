import { useActionMutation, useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import { IconMessagePlus, IconAt, IconMoodSmile } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { msToClock } from "./scrubber";

interface TimestampedCommentButtonProps {
  enableComments: boolean;
  onOpen: () => void;
  className?: string;
}

/** Trigger that opens the docked comment composer, pinned to the current time. */
export function TimestampedCommentButton({
  enableComments,
  onOpen,
  className,
}: TimestampedCommentButtonProps) {
  const t = useT();
  if (!enableComments) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("gap-1.5", className)}
      onClick={onOpen}
    >
      <IconMessagePlus className="h-4 w-4" />
      {t("commentsPanel.commentButton")}
    </Button>
  );
}

interface TimestampedCommentBarProps {
  recordingId: string;
  atMs: number;
  onClose: () => void;
  onAdded?: () => void;
  className?: string;
}

/**
 * Bottom-docked comment composer. Render inside a `relative` container (the
 * video wrapper) so it overlays the bottom of the video at the captured moment.
 */
export function TimestampedCommentBar({
  recordingId,
  atMs,
  onClose,
  onAdded,
  className,
}: TimestampedCommentBarProps) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const addComment = useActionMutation("add-comment");

  useEffect(() => {
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const insertAtCursor = (text: string) => {
    const el = textareaRef.current;
    if (!el) {
      setDraft((d) => d + text);
      return;
    }
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + text + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const submit = () => {
    const content = draft.trim();
    if (!content) return;
    addComment.mutate(
      { recordingId, content, videoTimestampMs: atMs },
      {
        onSuccess: () => {
          setDraft("");
          onAdded?.();
          onClose();
        },
      },
    );
  };

  return (
    <div className={cn("absolute inset-x-0 bottom-0 z-30 p-3", className)}>
      <div className="rounded-xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
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
              onClose();
            }
          }}
          placeholder={t("commentsPanel.composerPlaceholder")}
          rows={2}
          className="min-h-[3rem] resize-none border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              aria-label={t("commentsPanel.mentionSomeone")}
              onClick={() => insertAtCursor("@")}
            >
              <IconAt className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              aria-label={t("commentsPanel.addEmoji")}
              onClick={() => insertAtCursor("🙂")}
            >
              <IconMoodSmile className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              className="rounded-full"
              disabled={!draft.trim() || addComment.isPending}
              onClick={submit}
            >
              {t("commentsPanel.commentAt")} {msToClock(atMs)}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
