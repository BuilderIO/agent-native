import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconArrowUp, IconMessagePlus } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { COMMENT_ACCESS_TOKEN_HEADER } from "../../../shared/comment-access";
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
  commentAccessToken?: string;
  getCommentAccessToken?: (
    refusedToken?: string | null,
  ) => Promise<string | null | undefined>;
  recordingId: string;
  atMs: number;
  onClose: () => void;
  onAdded?: () => void;
  className?: string;
  draft?: string;
  onDraftChange?: (value: string) => void;
  portalContainer?: HTMLElement | null;
}

export function TimestampedCommentBar({
  commentAccessToken,
  getCommentAccessToken,
  recordingId,
  atMs,
  onClose,
  onAdded,
  className,
  draft: controlledDraft,
  onDraftChange,
  portalContainer,
}: TimestampedCommentBarProps) {
  const [uncontrolledDraft, setUncontrolledDraft] = useState("");
  const draft = controlledDraft ?? uncontrolledDraft;
  const setDraft = onDraftChange ?? setUncontrolledDraft;

  const commentAccessTokenRef = useRef<string | null | undefined>(
    commentAccessToken,
  );
  useEffect(() => {
    commentAccessTokenRef.current = commentAccessToken;
  }, [commentAccessToken]);
  const refusedCommentAccessTokenRef = useRef<string | null | undefined>(
    undefined,
  );
  // Toasts do not paint over real fullscreen, so failure shows in the bar.
  const [failed, setFailed] = useState(false);
  // Every mutate() posts again, and isPending reaches render a tick late.
  const sendingRef = useRef(false);
  const addComment = useActionMutation("add-comment", {
    headers: () =>
      commentAccessTokenRef.current
        ? { [COMMENT_ACCESS_TOKEN_HEADER]: commentAccessTokenRef.current }
        : undefined,
    onMutate: async () => {
      if (getCommentAccessToken) {
        commentAccessTokenRef.current = await getCommentAccessToken(
          refusedCommentAccessTokenRef.current,
        );
      }
    },
    onError: () => {
      refusedCommentAccessTokenRef.current = commentAccessTokenRef.current;
      setFailed(true);
    },
    onSettled: () => {
      sendingRef.current = false;
    },
  });

  const submit = () => {
    const content = draft.trim();
    if (!content || sendingRef.current) return;
    sendingRef.current = true;
    setFailed(false);
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

  // Moving into or out of the player remounts the fields, so the send stays
  // out here where a pending one survives the move.
  const fields = (
    <TimestampedCommentFields
      draft={draft}
      onDraftChange={(value) => {
        setDraft(value);
        setFailed(false);
      }}
      failed={failed}
      pending={addComment.isPending}
      atMs={atMs}
      onSubmit={submit}
      onClose={onClose}
      className={className}
    />
  );
  return portalContainer ? createPortal(fields, portalContainer) : fields;
}

function TimestampedCommentFields({
  draft,
  onDraftChange,
  failed,
  pending,
  atMs,
  onSubmit,
  onClose,
  className,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  failed: boolean;
  pending: boolean;
  atMs: number;
  onSubmit: () => void;
  onClose: () => void;
  className?: string;
}) {
  const t = useT();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useAutoResizeCommentTextarea(textareaRef, draft, 1);

  useEffect(() => {
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  return (
    <div
      data-player-ui
      className={cn("absolute inset-x-0 bottom-0 z-30 p-3 sm:p-4", className)}
    >
      <div className="mx-auto w-full max-w-lg rounded-xl bg-background/95 p-2 shadow-lg ring-1 ring-foreground/10 backdrop-blur">
        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSubmit();
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
        {failed ? (
          <p role="alert" className="px-2 pb-1 text-[11px] text-destructive">
            {t("notificationsRoute.sendFailed")}
          </p>
        ) : null}
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
              disabled={!draft.trim() || pending}
              onClick={onSubmit}
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
