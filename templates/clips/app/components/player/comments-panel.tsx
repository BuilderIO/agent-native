import {
  useActionMutation,
  useAvatarUrl,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  InlineMarkdown,
  type InlineMarkdownProtectedSpan,
} from "@agent-native/core/client/markdown";
import {
  IconSend,
  IconCheck,
  IconMoodSmile,
  IconCornerDownRight,
  IconDots,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { type Ref, useEffect, useMemo, useRef, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import {
  displayCommentMentions,
  mentionsForCommentText,
  type CommentMention,
  type CommentMentionDisplay,
} from "../../../shared/comment-mentions";
import { useMentionMembers } from "../../hooks/use-mention-members";
import {
  CommentComposer as CommentTextComposer,
  type MentionEntry,
} from "./comment-composer";
import { REACTION_EMOJIS } from "./reaction-emojis";
import { msToClock } from "./scrubber";

function makeTempId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `temp_${crypto.randomUUID()}`;
  }
  return `temp_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

// The shape of the cached value depends on the route — the authenticated
// player route caches `get-recording-player-data` ({ comments, ... }) while
// the public share route caches a wrapped fetch response
// ({ ok, status, data: { comments, ... } }). Both feed into this panel, so we
// don't assume a shape — the parent passes lenses.
type CommentsLens = {
  selectComments: (data: unknown) => Comment[] | undefined;
  applyComments: (data: unknown, next: Comment[]) => unknown;
};

const defaultLens: CommentsLens = {
  selectComments: (data) =>
    (data as { comments?: Comment[] } | undefined)?.comments,
  applyComments: (data, next) =>
    data ? { ...(data as object), comments: next } : data,
};

export interface Comment {
  id: string;
  threadId: string;
  parentId: string | null;
  authorEmail: string;
  authorName: string | null;
  content: string;
  mentions?: CommentMentionDisplay[];
  videoTimestampMs: number;
  emojiReactionsJson: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CommentsPanelProps {
  recordingId: string;
  comments: Comment[];
  currentMs: number;
  currentUserEmail?: string;
  currentUserName?: string;
  enableComments: boolean;
  canComment: boolean;
  onSeek: (ms: number) => void;
  /**
   * The React Query key whose cached value contains this panel's `comments`.
   * Optimistic updates patch this key — passing the wrong one (or omitting
   * it) means the chip / new-comment row won't appear until the next refetch.
   */
  queryKey: readonly unknown[];
  /**
   * Optional lenses for selecting / replacing the comments array inside the
   * cached value. Defaults match the authenticated `get-recording-player-data`
   * shape (`{ comments, ... }`). The public share route wraps comments under
   * `data.comments` and supplies its own lenses.
   */
  selectComments?: CommentsLens["selectComments"];
  applyComments?: CommentsLens["applyComments"];
  /**
   * If provided, this callback is invoked instead of firing the comment /
   * reaction mutation when the viewer is not signed in. Use it to surface a
   * sign-in prompt on the public share page.
   */
  onUnauthenticated?: (intent: "comment" | "react") => void;
  /**
   * The public share page uses a quieter Loom-style activity panel. The
   * authenticated viewer's inline presentation keeps the conversation in the
   * primary reading flow beneath the player.
   */
  presentation?: "default" | "share" | "inline";
}

export function CommentsPanel(props: CommentsPanelProps) {
  const {
    recordingId,
    comments,
    currentMs,
    currentUserEmail,
    currentUserName,
    enableComments,
    canComment,
    onSeek,
    onUnauthenticated,
    queryKey,
    selectComments = defaultLens.selectComments,
    applyComments = defaultLens.applyComments,
    presentation = "default",
  } = props;
  const isSignedIn = !!currentUserEmail;
  const isSharePresentation = presentation === "share";
  const isInlinePresentation = presentation === "inline";
  const isConversationPresentation =
    isSharePresentation || isInlinePresentation;
  const [draft, setDraft] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [draftMentions, setDraftMentions] = useState<MentionEntry[]>([]);
  const [replyMentions, setReplyMentions] = useState<MentionEntry[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editMentions, setEditMentions] = useState<MentionEntry[]>([]);
  const replyComposerRef = useRef<HTMLTextAreaElement>(null);
  const { data: mentionMembers = [] } = useMentionMembers(
    recordingId,
    isSignedIn,
  );
  const selectedEditMentions = useMemo(
    () => mentionsForCommentText(editDraft, editMentions),
    [editDraft, editMentions],
  );

  const queryClient = useQueryClient();

  const patchComments = (updater: (prev: Comment[]) => Comment[]) => {
    queryClient.setQueryData(queryKey, (old: unknown) => {
      if (!old) return old;
      const current = selectComments(old) ?? [];
      return applyComments(old, updater(current));
    });
  };

  const addComment = useActionMutation("add-comment", {
    onMutate: async (vars: any) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData(queryKey);
      const tempId = makeTempId();
      const now = new Date().toISOString();
      const optimistic: Comment = {
        id: tempId,
        threadId: vars.threadId ?? tempId,
        parentId: vars.parentId ?? null,
        authorEmail: currentUserEmail ?? "",
        authorName: currentUserName ?? null,
        content: vars.content,
        mentions: displayCommentMentions(vars.mentions),
        videoTimestampMs: vars.videoTimestampMs ?? 0,
        emojiReactionsJson: "{}",
        resolved: false,
        createdAt: now,
        updatedAt: now,
      };
      patchComments((list) => [...list, optimistic]);
      return { prev, tempId };
    },
    onError: (_err, _vars, ctx: any) => {
      if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
    },
    onSuccess: (data: any, _vars, ctx: any) => {
      if (!ctx?.tempId || !data?.id) return;
      patchComments((list) =>
        list.map((c) =>
          c.id === ctx.tempId
            ? { ...c, id: data.id, threadId: data.threadId ?? c.threadId }
            : c,
        ),
      );
    },
  });

  const resolve = useActionMutation("resolve-comment", {
    onMutate: async (vars: any) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData(queryKey);
      patchComments((list) =>
        list.map((c) =>
          c.id === vars.id
            ? {
                ...c,
                resolved:
                  typeof vars.resolved === "boolean"
                    ? vars.resolved
                    : !c.resolved,
              }
            : c,
        ),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx: any) => {
      if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
    },
  });

  const reactToComment = useActionMutation("react-to-comment", {
    onMutate: async (vars: any) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData(queryKey);
      const currentUser = currentUserEmail;
      if (!currentUser) return { prev };
      patchComments((commentList) =>
        commentList.map((comment) => {
          if (comment.id !== vars.commentId) return comment;
          let reactions: Record<string, string[]> = {};
          try {
            const parsed = JSON.parse(comment.emojiReactionsJson || "{}");
            if (parsed && typeof parsed === "object") {
              reactions = parsed as Record<string, string[]>;
            }
          } catch {}
          const reactingUsers = Array.isArray(reactions[vars.emoji])
            ? reactions[vars.emoji]
            : [];
          const userAlreadyReacted = reactingUsers.includes(currentUser);
          const updatedReactingUsers = userAlreadyReacted
            ? reactingUsers.filter((email) => email !== currentUser)
            : [...reactingUsers, currentUser];
          const updatedReactions = { ...reactions };
          if (updatedReactingUsers.length === 0) {
            delete updatedReactions[vars.emoji];
          } else {
            updatedReactions[vars.emoji] = updatedReactingUsers;
          }
          return {
            ...comment,
            emojiReactionsJson: JSON.stringify(updatedReactions),
          };
        }),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx: any) => {
      if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
    },
    onSuccess: (data: any, vars: any) => {
      if (!data?.reactions) return;
      patchComments((list) =>
        list.map((c) =>
          c.id === vars.commentId
            ? { ...c, emojiReactionsJson: JSON.stringify(data.reactions) }
            : c,
        ),
      );
    },
  });

  const remove = useActionMutation("delete-comment", {
    onMutate: async (vars: any) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData(queryKey);
      // Deleting a root comment cascades to its replies server-side, so mirror
      // that here: drop the target comment and any descendants in the same
      // thread whose parent chain leads back to it.
      patchComments((list) => {
        const target = list.find((c) => c.id === vars.id);
        if (!target) return list;
        const isRoot = target.parentId == null;
        if (isRoot) {
          return list.filter((c) => c.threadId !== target.threadId);
        }
        return list.filter((c) => c.id !== vars.id);
      });
      return { prev };
    },
    onError: (_err, _vars, ctx: any) => {
      if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
    },
  });

  const updateComment = useActionMutation("update-comment", {
    onMutate: async (vars: any) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData(queryKey);
      const updatedAt = new Date().toISOString();
      patchComments((list) =>
        list.map((comment) =>
          comment.id === vars.id
            ? {
                ...comment,
                content: vars.content,
                ...(vars.mentions === undefined
                  ? {}
                  : { mentions: displayCommentMentions(vars.mentions) }),
                updatedAt,
              }
            : comment,
        ),
      );
      return { prev };
    },
    onError: (_err, vars: any, ctx: any) => {
      if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
      setEditingId(vars.id);
      setEditDraft(vars.content);
      setEditMentions(vars.mentions ?? []);
    },
    onSuccess: (data: any) => {
      if (!data?.id || !data?.content || !data?.updatedAt) return;
      patchComments((list) =>
        list.map((comment) =>
          comment.id === data.id
            ? {
                ...comment,
                content: data.content,
                ...(data.mentions !== undefined
                  ? { mentions: data.mentions }
                  : {}),
                updatedAt: data.updatedAt,
              }
            : comment,
        ),
      );
    },
  });

  // Group by thread
  const threads = useMemo(() => {
    const map = new Map<string, Comment[]>();
    comments.forEach((c) => {
      const list = map.get(c.threadId) ?? [];
      list.push(c);
      map.set(c.threadId, list);
    });
    // Sort within threads by createdAt
    return Array.from(map.values()).map((list) =>
      list.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
  }, [comments]);

  // Sort threads by the first comment's videoTimestampMs
  const sortedThreads = useMemo(
    () =>
      threads.slice().sort((a, b) => {
        return (a[0]?.videoTimestampMs ?? 0) - (b[0]?.videoTimestampMs ?? 0);
      }),
    [threads],
  );

  function submitDraft(value: string, target: Comment | null) {
    if (!canComment) return;
    const text = value.trim();
    if (!text) return;
    if (!isSignedIn && onUnauthenticated) {
      onUnauthenticated("comment");
      return;
    }
    const vars = target
      ? {
          recordingId,
          content: text,
          videoTimestampMs: target.videoTimestampMs,
          threadId: target.threadId,
          parentId: target.id,
          ...mentionArgs(value, replyMentions),
          ...(currentUserName ? { authorName: currentUserName } : {}),
        }
      : {
          recordingId,
          content: text,
          videoTimestampMs: currentMs,
          ...mentionArgs(value, draftMentions),
          ...(currentUserName ? { authorName: currentUserName } : {}),
        };
    // Clear composer state before firing the mutation so the UI feels instant —
    // the optimistic cache patch in onMutate puts the comment in the list.
    if (target) {
      setReplyDraft("");
      setReplyMentions([]);
      setReplyTo(null);
    } else {
      setDraft("");
      setDraftMentions([]);
    }
    addComment.mutate(vars);
  }

  function openReply(root: Comment) {
    if (!canComment) return;
    if (!isSignedIn && onUnauthenticated) {
      onUnauthenticated("comment");
      return;
    }
    setReplyTo(root);
    setReplyMentions([]);
    setTimeout(() => replyComposerRef.current?.focus(), 0);
  }

  function startEditing(comment: Comment) {
    if (!canComment) return;
    setEditingId(comment.id);
    setEditDraft(comment.content);
    // Persisted comment data only contains display-safe mention names.
    setEditMentions([]);
  }

  function cancelEditing() {
    setEditingId(null);
    setEditDraft("");
    setEditMentions([]);
  }

  function submitEdit(comment: Comment) {
    if (!canComment) return;
    const content = editDraft.trim();
    if (!content) return;
    if (content === comment.content && selectedEditMentions.length === 0) {
      cancelEditing();
      return;
    }
    cancelEditing();
    updateComment.mutate({
      id: comment.id,
      content,
      ...mentionArgs(editDraft, selectedEditMentions),
    });
  }

  const composer = (
    <CommentComposer
      draft={draft}
      currentMs={currentMs}
      currentUserEmail={currentUserEmail}
      currentUserName={currentUserName}
      isSignedIn={isSignedIn}
      isConversationPresentation={isConversationPresentation}
      isInlinePresentation={isInlinePresentation}
      enableComments={enableComments}
      canComment={canComment}
      onDraftChange={setDraft}
      onMentionAdd={(mention) =>
        setDraftMentions((current) => upsertMention(current, mention))
      }
      members={mentionMembers}
      onSubmit={() => submitDraft(draft, null)}
      onUnauthenticated={onUnauthenticated}
    />
  );

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col bg-transparent",
        !isInlinePresentation && "h-full",
        isInlinePresentation && "xl:h-full xl:min-h-0",
      )}
    >
      {isInlinePresentation && enableComments ? (
        <div className="mb-5 shrink-0">{composer}</div>
      ) : null}
      <div
        className={cn(
          "min-h-0",
          isInlinePresentation
            ? "xl:flex-1 xl:overflow-y-auto xl:overscroll-contain"
            : "flex-1 overflow-y-auto",
          isSharePresentation && "flex min-h-0 flex-col",
        )}
      >
        {sortedThreads.length === 0 ? (
          <EmptyCommentsState
            enableComments={enableComments}
            canComment={canComment}
            isSharePresentation={isSharePresentation}
            isInlinePresentation={isInlinePresentation}
          />
        ) : (
          <ul className="space-y-5">
            {sortedThreads.map((thread) => {
              const root = thread[0];
              const replies = thread.slice(1);
              return (
                <li
                  key={root.threadId}
                  className={cn("space-y-2", !isInlinePresentation && "px-3")}
                >
                  <CommentCard
                    comment={root}
                    currentUserEmail={currentUserEmail}
                    canComment={canComment}
                    onSeek={onSeek}
                    onReply={() => openReply(root)}
                    onResolve={(id, resolved) =>
                      resolve.mutate({ id, resolved })
                    }
                    onDelete={(id) => remove.mutate({ id })}
                    isEditing={editingId === root.id}
                    editDraft={editDraft}
                    onEditDraftChange={setEditDraft}
                    onEditMentionAdd={(mention) =>
                      setEditMentions((current) =>
                        upsertMention(current, mention),
                      )
                    }
                    hasSelectedEditMentions={selectedEditMentions.length > 0}
                    members={mentionMembers}
                    onStartEdit={() => startEditing(root)}
                    onCancelEdit={cancelEditing}
                    onSaveEdit={() => submitEdit(root)}
                    onReact={(commentId, emoji) =>
                      reactToComment.mutate({ commentId, emoji })
                    }
                    onUnauthenticated={onUnauthenticated}
                  />
                  {replies.length ? (
                    <ul className="ml-3 space-y-2 pl-8">
                      {replies.map((r) => (
                        <li key={r.id}>
                          <CommentCard
                            comment={r}
                            currentUserEmail={currentUserEmail}
                            canComment={canComment}
                            onSeek={onSeek}
                            onReply={() => openReply(root)}
                            onResolve={(id, resolved) =>
                              resolve.mutate({ id, resolved })
                            }
                            onDelete={(id) => remove.mutate({ id })}
                            isEditing={editingId === r.id}
                            editDraft={editDraft}
                            onEditDraftChange={setEditDraft}
                            onEditMentionAdd={(mention) =>
                              setEditMentions((current) =>
                                upsertMention(current, mention),
                              )
                            }
                            hasSelectedEditMentions={
                              selectedEditMentions.length > 0
                            }
                            members={mentionMembers}
                            onStartEdit={() => startEditing(r)}
                            onCancelEdit={cancelEditing}
                            onSaveEdit={() => submitEdit(r)}
                            onReact={(commentId, emoji) =>
                              reactToComment.mutate({ commentId, emoji })
                            }
                            onUnauthenticated={onUnauthenticated}
                            isReply
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {replyTo?.threadId === root.threadId ? (
                    <InlineReplyComposer
                      draft={replyDraft}
                      textareaRef={replyComposerRef}
                      onDraftChange={setReplyDraft}
                      onMentionAdd={(mention) =>
                        setReplyMentions((current) =>
                          upsertMention(current, mention),
                        )
                      }
                      members={mentionMembers}
                      onCancel={() => {
                        setReplyDraft("");
                        setReplyMentions([]);
                        setReplyTo(null);
                      }}
                      onSubmit={() => submitDraft(replyDraft, replyTo)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {isSharePresentation && enableComments ? (
        <div className="px-4 py-4">{composer}</div>
      ) : !isSharePresentation && !isInlinePresentation ? (
        composer
      ) : null}
    </div>
  );
}

function EmptyCommentsState({
  enableComments,
  canComment,
  isSharePresentation,
  isInlinePresentation,
}: {
  enableComments: boolean;
  canComment: boolean;
  isSharePresentation: boolean;
  isInlinePresentation: boolean;
}) {
  const t = useT();
  if (!enableComments) {
    return (
      <div
        className={cn(
          "text-center text-sm text-muted-foreground",
          isSharePresentation
            ? "flex flex-1 items-center justify-center px-8 py-12"
            : "p-6",
        )}
      >
        {t("commentsPanel.disabled")}
      </div>
    );
  }

  if (isInlinePresentation && canComment) return null;

  if (!canComment) {
    return (
      <div
        className={cn(
          "flex items-center justify-center px-8 py-10 text-center",
          isSharePresentation ? "flex-1" : "min-h-full",
        )}
      >
        <p className="text-sm font-medium text-muted-foreground">
          {t("commentsPanel.beFirst")}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center px-8 py-10 text-center",
        isSharePresentation ? "flex-1" : "min-h-full",
      )}
    >
      <p className="text-sm font-medium text-muted-foreground">
        {t("commentsPanel.beFirst")}
      </p>
    </div>
  );
}

function CommentComposer({
  draft,
  currentMs,
  currentUserEmail,
  currentUserName,
  isSignedIn,
  isConversationPresentation,
  isInlinePresentation,
  enableComments,
  canComment,
  onDraftChange,
  onMentionAdd,
  members,
  onSubmit,
  onUnauthenticated,
}: {
  draft: string;
  currentMs: number;
  currentUserEmail?: string;
  currentUserName?: string;
  isSignedIn: boolean;
  isConversationPresentation: boolean;
  isInlinePresentation: boolean;
  enableComments: boolean;
  canComment: boolean;
  onDraftChange: (value: string) => void;
  onMentionAdd: (mention: MentionEntry) => void;
  members: { email: string; name: string | null }[];
  onSubmit: () => void;
  onUnauthenticated?: (intent: "comment" | "react") => void;
}) {
  const t = useT();
  const avatarUrl = useAvatarUrl(currentUserEmail);
  if (!enableComments) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        {t("commentsPanel.disabled")}
      </div>
    );
  }

  if (!canComment && isSignedIn) return null;

  if (!isSignedIn && onUnauthenticated) {
    return (
      <button
        type="button"
        onClick={() => onUnauthenticated("comment")}
        className={cn(
          "flex w-full items-center gap-3 rounded-md border border-input bg-background px-3 text-left text-sm text-muted-foreground shadow-xs transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isConversationPresentation ? "min-h-11 py-2" : "min-h-10 py-2",
        )}
      >
        <Avatar className="size-7 shrink-0">
          <AvatarFallback className="bg-muted text-xs text-muted-foreground">
            A
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1 truncate">
          {t("commentsPanel.leaveComment")}
        </span>
        <IconMoodSmile className="size-4 shrink-0" />
      </button>
    );
  }

  return (
    <div
      className={cn(isConversationPresentation ? "space-y-2" : "space-y-2 p-3")}
    >
      {!isConversationPresentation ? (
        <div className="px-1 text-[11px] text-muted-foreground">
          {t("commentsPanel.commentAt")}{" "}
          <span className="font-mono">{msToClock(currentMs)}</span>
        </div>
      ) : null}
      <div
        className={cn(
          "flex gap-2",
          isInlinePresentation && "items-center",
          isConversationPresentation &&
            !isInlinePresentation &&
            "items-start rounded-md p-3 shadow-sm",
        )}
      >
        {isConversationPresentation ? (
          <Avatar className="mt-0.5 size-7 shrink-0">
            {avatarUrl ? (
              <AvatarImage
                src={avatarUrl}
                alt={currentUserName || currentUserEmail || "Anonymous"}
              />
            ) : null}
            <AvatarFallback className="bg-primary/15 text-xs text-primary">
              {initials(currentUserName || currentUserEmail || "Anonymous")}
            </AvatarFallback>
          </Avatar>
        ) : null}
        <div
          className={cn(
            "flex min-w-0 flex-1 gap-2",
            isInlinePresentation && "items-center border-b border-border py-1",
          )}
        >
          <CommentTextComposer
            value={draft}
            onChange={onDraftChange}
            onMentionAdd={onMentionAdd}
            members={members}
            onSubmit={onSubmit}
            placeholder={t("commentsPanel.leaveComment")}
            rows={isInlinePresentation ? 1 : 2}
            className={cn(
              "resize-none border-0 bg-transparent text-sm",
              isInlinePresentation
                ? "min-h-8 flex-1 border-0 px-0 py-1 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                : isConversationPresentation
                  ? "min-h-10 flex-1 border-0 px-3 py-2 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  : "min-h-[60px]",
            )}
            submitOnEnter={false}
          />
          {!isInlinePresentation || draft.trim() ? (
            <Button
              onClick={onSubmit}
              disabled={!draft.trim()}
              size={isInlinePresentation ? "sm" : "icon"}
              className={cn(
                "shrink-0 bg-primary text-primary-foreground hover:bg-primary/90",
                isConversationPresentation && !isInlinePresentation && "size-8",
                isInlinePresentation && "h-8 px-3",
              )}
            >
              {isInlinePresentation ? (
                t("commentsPanel.commentButton")
              ) : (
                <IconSend className="size-4" />
              )}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function InlineReplyComposer({
  draft,
  textareaRef,
  onDraftChange,
  onMentionAdd,
  members,
  onCancel,
  onSubmit,
}: {
  draft: string;
  textareaRef: Ref<HTMLTextAreaElement>;
  onDraftChange: (value: string) => void;
  onMentionAdd: (mention: MentionEntry) => void;
  members: { email: string; name: string | null }[];
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const t = useT();

  return (
    <div className="ml-12 mt-2 rounded-lg p-2">
      <CommentTextComposer
        ref={textareaRef}
        autoFocus
        value={draft}
        onChange={onDraftChange}
        onMentionAdd={onMentionAdd}
        members={members}
        onSubmit={onSubmit}
        placeholder={t("commentsPanel.writeReply")}
        className="min-h-16 resize-none border-0 bg-background text-sm"
        onEscape={onCancel}
        submitOnEnter={false}
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          size="icon"
          onClick={onSubmit}
          disabled={!draft.trim()}
          aria-label={t("commentsPanel.writeReply")}
          className="size-8 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <IconSend className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function InlineEditComposer({
  draft,
  originalContent,
  onDraftChange,
  onMentionAdd,
  hasSelectedMentions,
  members,
  onCancel,
  onSubmit,
}: {
  draft: string;
  originalContent: string;
  onDraftChange: (value: string) => void;
  onMentionAdd: (mention: MentionEntry) => void;
  hasSelectedMentions: boolean;
  members: { email: string; name: string | null }[];
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const t = useT();
  const normalizedDraft = draft.trim();

  return (
    <div className="mt-2 rounded-lg p-2">
      <CommentTextComposer
        autoFocus
        value={draft}
        onChange={onDraftChange}
        onMentionAdd={onMentionAdd}
        members={members}
        onSubmit={onSubmit}
        aria-label={t("commentsPanel.editComment")}
        className="min-h-16 resize-none border-0 bg-background text-sm"
        onEscape={onCancel}
        submitOnEnter={false}
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          size="sm"
          onClick={onSubmit}
          disabled={
            !normalizedDraft ||
            (normalizedDraft === originalContent.trim() && !hasSelectedMentions)
          }
        >
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

function CommentCard({
  comment,
  currentUserEmail,
  canComment,
  editDraft,
  isEditing,
  onSeek,
  onReply,
  onResolve,
  onDelete,
  onEditDraftChange,
  onEditMentionAdd,
  hasSelectedEditMentions,
  members,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onReact,
  onUnauthenticated,
  isReply,
}: {
  comment: Comment;
  currentUserEmail?: string;
  canComment: boolean;
  editDraft: string;
  isEditing: boolean;
  onSeek: (ms: number) => void;
  onReply: () => void;
  onResolve: (id: string, resolved: boolean) => void;
  onDelete: (id: string) => void;
  onEditDraftChange: (value: string) => void;
  onEditMentionAdd: (mention: MentionEntry) => void;
  hasSelectedEditMentions: boolean;
  members: { email: string; name: string | null }[];
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onReact: (commentId: string, emoji: string) => void;
  onUnauthenticated?: (intent: "comment" | "react") => void;
  isReply?: boolean;
}) {
  const t = useT();
  // Local override forces a synchronous re-render the instant the user clicks
  // an emoji — independent of React Query cache propagation. It's cleared as
  // soon as the prop (server-confirmed) catches up to whatever we showed.
  const [localJson, setLocalJson] = useState<string | null>(null);
  useEffect(() => {
    setLocalJson(null);
  }, [comment.emojiReactionsJson]);

  const reactions = parseReactions(localJson ?? comment.emojiReactionsJson);
  const isOwner =
    !!currentUserEmail &&
    comment.authorEmail.trim().toLowerCase() ===
      currentUserEmail.trim().toLowerCase();

  function toggleEmoji(emoji: string) {
    if (!currentUserEmail) return reactions;
    const reactingUsers = Array.isArray(reactions[emoji])
      ? reactions[emoji]
      : [];
    const userAlreadyReacted = reactingUsers.includes(currentUserEmail);

    const updatedReactingUsers = userAlreadyReacted
      ? reactingUsers.filter((email) => email !== currentUserEmail)
      : [...reactingUsers, currentUserEmail];

    const updatedReactions: Record<string, string[]> = { ...reactions };
    if (updatedReactingUsers.length === 0) {
      delete updatedReactions[emoji];
    } else {
      updatedReactions[emoji] = updatedReactingUsers;
    }

    return updatedReactions;
  }

  const avatarUrl = useAvatarUrl(comment.authorEmail);

  return (
    <div className={cn("flex gap-2", comment.resolved && "opacity-60")}>
      <Avatar className="h-7 w-7 shrink-0">
        {avatarUrl ? (
          <AvatarImage src={avatarUrl} alt={displayName(comment)} />
        ) : null}
        <AvatarFallback className="text-[10px] bg-primary text-primary-foreground">
          {initials(displayName(comment))}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium text-foreground truncate">
            {displayName(comment)}
          </span>
          {!isReply ? (
            <button
              onClick={() => onSeek(comment.videoTimestampMs)}
              className="font-mono text-[11px] text-primary hover:underline"
            >
              {msToClock(comment.videoTimestampMs)}
            </button>
          ) : null}
          <span className="text-muted-foreground text-[11px]">
            {relativeTime(comment.createdAt)}
          </span>
          {comment.resolved ? (
            <span className="ml-auto text-[10px] text-green-700 bg-green-100 rounded px-1.5 py-0.5 flex items-center gap-1">
              <IconCheck className="h-3 w-3" /> Resolved
            </span>
          ) : null}
        </div>
        {isEditing ? (
          <InlineEditComposer
            draft={editDraft}
            originalContent={comment.content}
            onDraftChange={onEditDraftChange}
            onMentionAdd={onEditMentionAdd}
            hasSelectedMentions={hasSelectedEditMentions}
            members={members}
            onCancel={onCancelEdit}
            onSubmit={onSaveEdit}
          />
        ) : (
          <>
            <InlineMarkdown
              content={comment.content}
              className="mt-0.5 text-sm text-foreground"
              protectedSpans={commentMentionSpans(comment.mentions)}
            />

            <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
              {canComment ? (
                <button
                  onClick={onReply}
                  className="hover:text-foreground flex items-center gap-1"
                >
                  <IconCornerDownRight className="h-3 w-3" />
                  Reply
                </button>
              ) : null}

              {canComment ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="hover:text-foreground flex items-center gap-1">
                      <IconMoodSmile className="h-3 w-3" /> React
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    side="top"
                    align="start"
                    className="p-1 w-auto"
                  >
                    <div className="flex gap-0.5">
                      {REACTION_EMOJIS.map((e) => (
                        <button
                          key={e}
                          onClick={() => {
                            if (!currentUserEmail) {
                              onUnauthenticated?.("react");
                              return;
                            }
                            setLocalJson(JSON.stringify(toggleEmoji(e)));
                            onReact(comment.id, e);
                          }}
                          className="text-lg h-8 w-8 rounded hover:bg-accent flex items-center justify-center"
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              ) : null}

              {currentUserEmail && canComment ? (
                <button
                  onClick={() => onResolve(comment.id, !comment.resolved)}
                  className="hover:text-foreground"
                >
                  {comment.resolved ? "Unresolve" : "Resolve"}
                </button>
              ) : null}

              {isOwner && canComment ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="ml-auto hover:text-foreground">
                      <IconDots className="h-3 w-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={onStartEdit}>
                      {t("commentsPanel.editComment")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-red-600"
                      onSelect={() => onDelete(comment.id)}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          </>
        )}

        {Object.keys(reactions).length > 0 ? (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {Object.entries(reactions).map(([emoji, users]) => {
              const mine =
                !!currentUserEmail && users.includes(currentUserEmail);
              return canComment ? (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    if (!currentUserEmail) {
                      onUnauthenticated?.("react");
                      return;
                    }
                    setLocalJson(JSON.stringify(toggleEmoji(emoji)));
                    onReact(comment.id, emoji);
                  }}
                  aria-pressed={mine}
                  title={
                    mine
                      ? "Click to remove your reaction"
                      : "Click to add your reaction"
                  }
                  className={cn(
                    "text-[11px] rounded-full px-1.5 py-0.5 flex items-center gap-1 transition-colors",
                    mine
                      ? "bg-primary/15 border border-primary/40 text-primary hover:bg-primary/25"
                      : "bg-accent border border-transparent hover:bg-accent/70",
                  )}
                >
                  {emoji} {users.length}
                </button>
              ) : (
                <span
                  key={emoji}
                  className="text-[11px] rounded-full px-1.5 py-0.5 flex items-center gap-1 bg-accent border border-transparent"
                >
                  {emoji} {users.length}
                </span>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function parseReactions(raw: string): Record<string, string[]> {
  try {
    const v = JSON.parse(raw ?? "{}");
    if (v && typeof v === "object") return v as Record<string, string[]>;
  } catch {}
  return {};
}

function upsertMention(
  current: MentionEntry[],
  mention: MentionEntry,
): MentionEntry[] {
  return current.some(
    (entry) => entry.email.toLowerCase() === mention.email.toLowerCase(),
  )
    ? current
    : [...current, mention];
}

function mentionArgs(
  text: string,
  mentions: readonly CommentMention[],
): { mentions?: CommentMention[] } {
  const present = mentionsForCommentText(text, mentions);
  return present.length > 0 ? { mentions: present } : {};
}

function commentMentionSpans(
  mentions: readonly CommentMentionDisplay[] | null | undefined,
): InlineMarkdownProtectedSpan[] {
  const labels = Array.from(
    new Set((mentions ?? []).map((mention) => mention.name)),
  ).sort((a, b) => b.length - a.length);
  return labels.map((name) => ({
    source: `@${name}`,
    label: `@${name}`,
    className: "comment-mention font-medium text-primary",
  }));
}

function displayName(c: Comment): string {
  return c.authorName || c.authorEmail.split("@")[0] || "Someone";
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return "";
  const diff = Date.now() - t;
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  return `${w}w`;
}
