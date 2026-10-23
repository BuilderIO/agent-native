import { useSession } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { SlideCommentAnchor } from "@shared/slide-comment-anchor";
import {
  IconCheck,
  IconMessageCircle,
  IconPencil,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useCreateSlideComment,
  useDeleteSlideComment,
  useResolveSlideComment,
  useSlideComments,
  useUpdateSlideComment,
  type SlideComment,
} from "@/hooks/use-slide-comments";

import { getEditorActionErrorTranslationKey } from "./editor-action-errors";
import type { ElementSnapshot } from "./types";

type Props = {
  deckId: string;
  slideId: string;
  canComment: boolean;
  canEdit: boolean;
  active: boolean;
  sourceHash: string | null;
  sourceNodes: ElementSnapshot[];
  draftAnchor: SlideCommentAnchor | null;
  onDraftDone: () => void;
};

function commentPinPosition(
  anchor: SlideCommentAnchor,
  sourceHash: string | null,
  nodes: ElementSnapshot[],
): {
  x: number;
  y: number;
  region?: NonNullable<SlideCommentAnchor["region"]>;
} {
  if (anchor.version !== 1 || !sourceHash || anchor.sourceHash !== sourceHash) {
    return { x: anchor.x, y: anchor.y };
  }

  if (anchor.region) {
    return { x: anchor.x, y: anchor.y, region: anchor.region };
  }

  const node = anchor.sourceLocator
    ? nodes.find(
        (candidate) =>
          candidate.line === anchor.sourceLocator?.line &&
          candidate.column === anchor.sourceLocator?.column,
      )
    : null;
  if (!node || anchor.objectX === undefined || anchor.objectY === undefined) {
    return { x: anchor.x, y: anchor.y };
  }

  return {
    x: Math.max(
      0,
      Math.min(
        100,
        ((node.bounds.x + (node.bounds.width * anchor.objectX) / 100) / 1920) *
          100,
      ),
    ),
    y: Math.max(
      0,
      Math.min(
        100,
        ((node.bounds.y + (node.bounds.height * anchor.objectY) / 100) / 1080) *
          100,
      ),
    ),
  };
}

export function Slides2Comments({
  deckId,
  slideId,
  canComment,
  canEdit,
  active,
  sourceHash,
  sourceNodes,
  draftAnchor,
  onDraftDone,
}: Props) {
  const t = useT();
  const { session } = useSession();
  const currentUserEmail = session?.email?.trim().toLowerCase() ?? null;
  const commentsQuery = useSlideComments(
    active ? deckId : null,
    active ? slideId : null,
  );
  const createComment = useCreateSlideComment();
  const updateComment = useUpdateSlideComment();
  const deleteComment = useDeleteSlideComment();
  const resolveComment = useResolveSlideComment();
  const [draft, setDraft] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const threads = commentsQuery.data ?? [];
  const draftPosition = draftAnchor
    ? commentPinPosition(draftAnchor, sourceHash, sourceNodes)
    : null;

  const cancelDraft = () => {
    setDraft("");
    setError(null);
    onDraftDone();
  };

  const saveComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!canComment || !draftAnchor || !content || createComment.isPending)
      return;
    setError(null);
    try {
      await createComment.mutateAsync({
        deckId,
        slideId,
        content,
        anchor: draftAnchor,
      });
      setDraft("");
      onDraftDone();
      await commentsQuery.refetch();
    } catch (caught) {
      setError(
        t(
          getEditorActionErrorTranslationKey(caught, "comment-anchor") ??
            "comments.saveCommentFailed",
        ),
      );
    }
  };

  const saveReply = async (threadId: string, parentId: string) => {
    const content = (replyDrafts[threadId] ?? "").trim();
    if (!content || createComment.isPending) return;
    setError(null);
    try {
      await createComment.mutateAsync({
        deckId,
        slideId,
        content,
        threadId,
        parentId,
      });
      setReplyDrafts((current) => ({ ...current, [threadId]: "" }));
      await commentsQuery.refetch();
    } catch (caught) {
      setError(
        t(
          getEditorActionErrorTranslationKey(caught, "comment-anchor") ??
            "comments.saveReplyFailed",
        ),
      );
    }
  };

  const toggleResolved = async (threadId: string, resolved: boolean) => {
    const root = threads.find((thread) => thread.threadId === threadId)
      ?.comments[0];
    if (!root || resolveComment.isPending) return;
    setError(null);
    try {
      await resolveComment.mutateAsync({ id: root.id, deckId, resolved });
      await commentsQuery.refetch();
    } catch (caught) {
      setError(
        t(
          getEditorActionErrorTranslationKey(caught, "comment-anchor") ??
            "comments.updateFailed",
        ),
      );
    }
  };

  const saveEditedComment = async (comment: SlideComment) => {
    const content = editDraft.trim();
    if (!content || updateComment.isPending) return;
    setError(null);
    try {
      await updateComment.mutateAsync({ id: comment.id, deckId, content });
      setEditingCommentId(null);
      setEditDraft("");
      await commentsQuery.refetch();
    } catch (caught) {
      setError(
        t(
          getEditorActionErrorTranslationKey(caught, "comment-anchor") ??
            "comments.saveCommentFailed",
        ),
      );
    }
  };

  const deleteCommentById = async (commentId: string) => {
    if (deleteComment.isPending) return;
    setError(null);
    try {
      await deleteComment.mutateAsync({ id: commentId, deckId });
      await commentsQuery.refetch();
    } catch (caught) {
      setError(
        t(
          getEditorActionErrorTranslationKey(caught, "comment-anchor") ??
            "comments.deleteFailed",
        ),
      );
    }
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {active
        ? threads.map((thread) => {
            const anchor = thread.anchor;
            const root = thread.comments[0];
            if (!anchor || !root) return null;
            const position = commentPinPosition(
              anchor,
              sourceHash,
              sourceNodes,
            );
            return (
              <div key={thread.threadId} className="contents">
                {position.region ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute rounded-sm border-2 border-primary/70 bg-primary/10"
                    style={{
                      left: `${position.region.x}%`,
                      top: `${position.region.y}%`,
                      width: `${position.region.width}%`,
                      height: `${position.region.height}%`,
                    }}
                  />
                ) : null}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="pointer-events-auto">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="default"
                            size="icon-sm"
                            className="pointer-events-auto absolute size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background bg-primary text-primary-foreground shadow-md outline-none ring-offset-background transition-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 active:scale-100"
                            style={{
                              left: `${position.x}%`,
                              top: `${position.y}%`,
                            }}
                            aria-label={`${t("comments.comment")}: ${root.content.slice(0, 100)}`}
                          >
                            <IconMessageCircle
                              className="size-4"
                              aria-hidden="true"
                            />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="pointer-events-auto w-80 space-y-3">
                          <div className="max-h-48 space-y-3 overflow-y-auto">
                            {thread.comments.map((comment) => {
                              const editing = editingCommentId === comment.id;
                              const canManage =
                                canEdit ||
                                comment.author_email.trim().toLowerCase() ===
                                  currentUserEmail;
                              return (
                                <div
                                  key={comment.id}
                                  className="group space-y-1.5 text-sm text-foreground"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="truncate text-xs font-medium text-muted-foreground">
                                      {comment.author_name ||
                                        comment.author_email}
                                    </span>
                                    {canManage && !editing ? (
                                      <div className="flex shrink-0 items-center gap-1">
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon-sm"
                                          aria-label={t("comments.editComment")}
                                          onClick={() => {
                                            setError(null);
                                            setEditDraft(comment.content);
                                            setEditingCommentId(comment.id);
                                          }}
                                        >
                                          <IconPencil
                                            className="size-3.5"
                                            aria-hidden="true"
                                          />
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon-sm"
                                          aria-label={t(
                                            "comments.deleteComment",
                                          )}
                                          disabled={deleteComment.isPending}
                                          onClick={() =>
                                            void deleteCommentById(comment.id)
                                          }
                                        >
                                          <IconTrash
                                            className="size-3.5"
                                            aria-hidden="true"
                                          />
                                        </Button>
                                      </div>
                                    ) : null}
                                  </div>
                                  {editing ? (
                                    <div className="grid gap-2">
                                      <Textarea
                                        autoFocus
                                        aria-label={t("comments.editComment")}
                                        rows={3}
                                        value={editDraft}
                                        onChange={(event) =>
                                          setEditDraft(
                                            event.currentTarget.value,
                                          )
                                        }
                                        onKeyDown={(event) => {
                                          if (
                                            event.nativeEvent.isComposing ||
                                            event.nativeEvent.keyCode === 229
                                          ) {
                                            return;
                                          }
                                          if (
                                            event.key === "Enter" &&
                                            (event.metaKey || event.ctrlKey)
                                          ) {
                                            event.preventDefault();
                                            void saveEditedComment(comment);
                                          }
                                          if (event.key === "Escape") {
                                            setEditingCommentId(null);
                                            setEditDraft("");
                                          }
                                        }}
                                        className="resize-none text-sm"
                                      />
                                      <div className="flex justify-end gap-2">
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => {
                                            setEditingCommentId(null);
                                            setEditDraft("");
                                          }}
                                        >
                                          {t("comments.cancel")}
                                        </Button>
                                        <Button
                                          type="button"
                                          size="sm"
                                          disabled={
                                            !editDraft.trim() ||
                                            updateComment.isPending
                                          }
                                          onClick={() =>
                                            void saveEditedComment(comment)
                                          }
                                        >
                                          {updateComment.isPending
                                            ? t("comments.saving")
                                            : t("comments.save")}
                                        </Button>
                                      </div>
                                    </div>
                                  ) : (
                                    <p className="whitespace-pre-wrap break-words">
                                      {comment.content}
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          {canComment ? (
                            <div className="grid gap-2 border-t border-border pt-3">
                              {!thread.resolved ? (
                                <Textarea
                                  value={replyDrafts[thread.threadId] ?? ""}
                                  placeholder={t("comments.replyPlaceholder")}
                                  aria-label={t("comments.replyPlaceholder")}
                                  rows={2}
                                  onChange={(event) =>
                                    setReplyDrafts((current) => ({
                                      ...current,
                                      [thread.threadId]:
                                        event.currentTarget.value,
                                    }))
                                  }
                                  className="resize-none text-sm"
                                />
                              ) : null}
                              <div className="flex items-center justify-between gap-2">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={resolveComment.isPending}
                                  onClick={() =>
                                    void toggleResolved(
                                      thread.threadId,
                                      !thread.resolved,
                                    )
                                  }
                                >
                                  {t(
                                    thread.resolved
                                      ? "comments.reopenThread"
                                      : "comments.resolveThread",
                                  )}
                                </Button>
                                {!thread.resolved ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    disabled={
                                      !replyDrafts[thread.threadId]?.trim() ||
                                      createComment.isPending
                                    }
                                    onClick={() =>
                                      void saveReply(thread.threadId, root.id)
                                    }
                                  >
                                    {t("comments.reply")}
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                        </PopoverContent>
                      </Popover>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-64">
                    {root.content}
                  </TooltipContent>
                </Tooltip>
              </div>
            );
          })
        : null}
      {error || (active && commentsQuery.isError) ? (
        <div
          role="alert"
          className="pointer-events-auto absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-md border border-destructive/40 bg-background px-3 py-2 text-xs text-destructive shadow"
        >
          <span>{error ?? t("comments.loadFailed")}</span>
          {active && commentsQuery.isError ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={commentsQuery.isFetching}
              onClick={() => void commentsQuery.refetch()}
            >
              <IconRefresh className="me-1 size-3.5" aria-hidden="true" />
              {t("comments.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {draftAnchor && draftPosition ? (
        <Popover
          open
          onOpenChange={(open) => {
            if (!open) cancelDraft();
          }}
        >
          <PopoverAnchor asChild>
            <span
              aria-hidden="true"
              data-testid="comment-draft-anchor"
              className="pointer-events-none absolute size-px"
              style={{
                left: `${draftPosition.x}%`,
                top: `${draftPosition.y}%`,
              }}
            />
          </PopoverAnchor>
          <PopoverContent
            side="right"
            align="start"
            sideOffset={12}
            className="pointer-events-auto w-80 space-y-3"
          >
            <form
              className="grid gap-3"
              onSubmit={(event) => void saveComment(event)}
            >
              <Textarea
                autoFocus
                value={draft}
                placeholder={t("comments.addCommentPlaceholder")}
                aria-label={t("comments.addCommentPlaceholder")}
                onChange={(event) => setDraft(event.currentTarget.value)}
                rows={3}
                className="resize-none"
              />
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={cancelDraft}
                >
                  {t("comments.cancel")}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    !canComment || !draft.trim() || createComment.isPending
                  }
                >
                  <IconCheck className="me-1 size-4" aria-hidden="true" />
                  {createComment.isPending
                    ? t("comments.saving")
                    : t("comments.save")}
                </Button>
              </div>
            </form>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
