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

type AddCommentVars = {
  recordingId: string;
  content: string;
  videoTimestampMs: number;
};

type FailedSend = { key: number; vars: AddCommentVars };

interface TimestampedCommentBarProps {
  commentAccessToken?: string;
  getCommentAccessToken?:
    | ((refusedToken?: string | null) => Promise<string | null | undefined>)
    | undefined;
  recordingId: string;
  atMs: number;
  open?: boolean;
  onClose: () => void;
  onAdded?: () => void;
  className?: string;
  draft?: string;
  onDraftChange?: (value: string) => void;
  portalContainer?: HTMLElement | null | undefined;
}

export function TimestampedCommentBar({
  commentAccessToken,
  getCommentAccessToken,
  recordingId,
  atMs,
  open = true,
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
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

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
  const [failedSends, setFailedSends] = useState<FailedSend[]>([]);
  const failedSendKeyRef = useRef(0);
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
    const vars = { recordingId, content, videoTimestampMs: atMs };
    addComment.mutate(vars, {
      onSuccess: () => {
        onAdded?.();
        // The textarea stays editable while this sends, so newer text is
        // the next draft, not this posted one.
        if (draftRef.current.trim() !== content) return;
        setDraft("");
        onClose();
      },
      // Newer text keeps the composer, so this one waits beside it, at the
      // time it was written for.
      onError: () => {
        if (draftRef.current.trim() === content) {
          setFailed(true);
          return;
        }
        failedSendKeyRef.current += 1;
        const failedSend = { key: failedSendKeyRef.current, vars };
        setFailedSends((list) => [...list, failedSend]);
      },
    });
  };

  const dropFailedSend = (failedSend: FailedSend) =>
    setFailedSends((list) => list.filter((entry) => entry !== failedSend));

  const retry = (failedSend: FailedSend) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    addComment.mutate(failedSend.vars, {
      onSuccess: () => {
        onAdded?.();
        dropFailedSend(failedSend);
      },
    });
  };

  // Closing the composer, or moving it into or out of the player, remounts the
  // fields, so the send stays out here where a pending one survives both.
  if (!open) return null;
  const fields = (
    <TimestampedCommentFields
      draft={draft}
      onDraftChange={(value) => {
        setDraft(value);
        setFailed(false);
      }}
      failed={failed}
      failedSends={failedSends}
      retrying={
        addComment.isPending
          ? failedSends.find((entry) => entry.vars === addComment.variables)
          : undefined
      }
      onRetry={retry}
      onDelete={dropFailedSend}
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
  failedSends,
  retrying,
  onRetry,
  onDelete,
  pending,
  atMs,
  onSubmit,
  onClose,
  className,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  failed: boolean;
  failedSends: FailedSend[];
  retrying: FailedSend | undefined;
  onRetry: (failedSend: FailedSend) => void;
  onDelete: (failedSend: FailedSend) => void;
  pending: boolean;
  atMs: number;
  onSubmit: () => void;
  onClose: () => void;
  className?: string | undefined;
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
      // Fullscreen puts this beside z-40 playback cards and the z-50 CTA.
      className={cn("absolute inset-x-0 bottom-0 z-[45] p-3 sm:p-4", className)}
    >
      <div className="mx-auto w-full max-w-lg rounded-xl bg-background/95 p-2 shadow-lg ring-1 ring-foreground/10 backdrop-blur">
        {failedSends.length > 0 ? (
          <ul className="mb-1 max-h-32 overflow-y-auto border-b border-border px-2 pb-1">
            {failedSends.map((failedSend) => (
              <li key={failedSend.key}>
                <p className="truncate text-sm leading-5 text-foreground">
                  {failedSend.vars.content}
                </p>
                <div className="flex min-h-7 items-center gap-0.5 text-xs">
                  <span className="me-1 font-mono tabular-nums text-muted-foreground">
                    {msToClock(failedSend.vars.videoTimestampMs)}
                  </span>
                  {failedSend === retrying ? null : (
                    <p role="alert" className="me-1 text-destructive">
                      {t("notificationsRoute.sendFailed")}
                    </p>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => onRetry(failedSend)}
                    className="h-7 rounded-md px-2 text-xs font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    {t("libraryGrid.retry")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={failedSend === retrying}
                    onClick={() => {
                      onDelete(failedSend);
                      textareaRef.current?.focus();
                    }}
                    className="h-7 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    {t("commentsPanel.delete")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
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
