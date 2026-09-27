import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconArrowUp, IconMessagePlus } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { useAutoResizeCommentTextarea } from "./comment-composer";
import { msToClock } from "./scrubber";

interface TimestampedCommentButtonProps {
  enableComments: boolean;
  canComment: boolean;
  onOpen: () => void;
  className?: string;
}

export function TimestampedCommentButton({
  enableComments,
  canComment,
  onOpen,
  className,
}: TimestampedCommentButtonProps) {
  const t = useT();
  if (!enableComments || !canComment) return null;
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
  draft?: string;
  onDraftChange?: (value: string) => void;
}

export function TimestampedCommentBar({
  recordingId,
  atMs,
  onClose,
  onAdded,
  className,
  draft: controlledDraft,
  onDraftChange,
}: TimestampedCommentBarProps) {
  const t = useT();
  const [uncontrolledDraft, setUncontrolledDraft] = useState("");
  const draft = controlledDraft ?? uncontrolledDraft;
  const setDraft = onDraftChange ?? setUncontrolledDraft;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useAutoResizeCommentTextarea(textareaRef, draft, 1);

  const addComment = useActionMutation("add-comment");

  useEffect(() => {
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

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
    <div
      data-player-ui
      className={cn("absolute inset-x-0 bottom-0 z-30 p-3 sm:p-4", className)}
    >
      <div className="mx-auto w-full max-w-lg rounded-xl bg-background/95 p-2 shadow-lg ring-1 ring-foreground/10 backdrop-blur">
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
          rows={1}
          aria-label={t("commentsPanel.composerPlaceholder")}
          className="min-h-9 max-h-[40vh] resize-none border-0 bg-transparent px-2 py-1.5 text-base leading-5 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 sm:text-sm"
        />
        <div className="mt-1 flex items-center justify-between border-t border-border px-1 pt-1.5">
          <span className="ps-1 text-[11px] text-muted-foreground">
            {t("commentsPanel.commentAt")}{" "}
            <span className="font-mono tabular-nums">{msToClock(atMs)}</span>
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={onClose}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              size="icon"
              className="size-7 rounded-full"
              disabled={!draft.trim() || addComment.isPending}
              onClick={submit}
              aria-label={`${t("commentsPanel.commentAt")} ${msToClock(atMs)}`}
            >
              <IconArrowUp className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
