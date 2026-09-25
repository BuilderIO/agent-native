import {
  useActionMutation,
  useAvatarUrl,
} from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import {
  InlineMarkdown,
  type InlineMarkdownProtectedSpan,
} from "@agent-native/core/client/markdown";
import {
  IconArrowUp,
  IconMessageCircle,
  IconMoodSmile,
  IconCornerDownRight,
  IconDots,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  type ReactNode,
  type Ref,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
import { CommentSubmissionWidget } from "./comment-feed";
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

type CommentsMutationContext = {
  type: "add" | "reaction" | "remove" | "update";
  tempId?: string;
  commentId?: string;
  emoji?: string;
  reactionKey?: string;
  operationToken?: number;
  removed?: Comment[];
};

type ReactionState = {
  confirmedUsers: string[];
  confirmedToken: number;
  latestToken: number;
  pending: Map<number, { optimisticUsers: string[] }>;
  authoritativeUsers?: string[];
  authoritativeToken?: number;
};

type EditState = {
  confirmed: Comment;
  confirmedToken: number;
  latestToken: number;
  pending: Map<number, Comment>;
  authoritative?: Comment;
  authoritativeToken?: number;
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
  /** Legacy persisted field; resolved comments render like regular comments. */
  resolved?: boolean;
  createdAt: string;
  updatedAt: string;
}

const MAX_COMMENT_REPLY_DEPTH = 2;

type CommentThreadNode = {
  comment: Comment;
  children: CommentThreadNode[];
};

function buildCommentThread(comments: Comment[]): CommentThreadNode | null {
  if (comments.length === 0) return null;

  const nodes = new Map<string, CommentThreadNode>();
  for (const comment of comments) {
    nodes.set(comment.id, { comment, children: [] });
  }

  const rootComment = comments.find((comment) => comment.parentId == null);
  const root = nodes.get(rootComment?.id ?? comments[0].id);
  if (!root) return null;

  for (const comment of comments) {
    const node = nodes.get(comment.id);
    if (!node || node === root) continue;
    const parent = comment.parentId ? nodes.get(comment.parentId) : null;
    (parent && parent !== node ? parent.children : root.children).push(node);
  }

  return root;
}

export function collectCommentSubtreeIds(comments: Comment[], rootId: string) {
  const ids = new Set([rootId]);
  let frontier = [rootId];
  while (frontier.length > 0) {
    const nextIds = comments
      .filter(
        (comment) => comment.parentId && frontier.includes(comment.parentId),
      )
      .map((comment) => comment.id)
      .filter((id) => !ids.has(id));
    nextIds.forEach((id) => ids.add(id));
    frontier = nextIds;
  }
  return ids;
}

function updateReactionUsers(
  raw: string,
  emoji: string,
  users: string[],
): string {
  const reactions = parseReactions(raw);
  if (users.length === 0) delete reactions[emoji];
  else reactions[emoji] = users;
  return JSON.stringify(reactions);
}

export interface CommentsPanelProps {
  recordingId: string;
  comments: Comment[];
  currentMs: number;
  /**
   * Reads the player's live original-timeline position when a new root
   * comment is submitted. Native media can be seeked while paused without
   * emitting a parent `onTimeUpdate`, so the render-time value is not always
   * current.
   */
  getCurrentMs?: () => number;
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
   * Inline presentation keeps the conversation in the primary reading flow
   * beneath the player for both signed-in and public viewers. The share
   * presentation remains available for a quieter, contained activity panel.
   */
  presentation?: "default" | "share" | "inline";
}

export function CommentsPanel(props: CommentsPanelProps) {
  const {
    recordingId,
    comments,
    currentMs,
    getCurrentMs,
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
  const formatters = useFormatters();
  const [draft, setDraft] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  // Keep a local projection alongside the query cache so real recording
  // mutations render immediately while the action request is in flight.
  const [visibleComments, setVisibleComments] = useState(comments);
  const visibleCommentsRef = useRef(visibleComments);
  const reactionStatesRef = useRef(new Map<string, ReactionState>());
  const reactionSequenceRef = useRef(0);
  const editStatesRef = useRef(new Map<string, EditState>());
  const editSequenceRef = useRef(0);
  const successfulDeletionIdsRef = useRef(new Set<string>());
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

  useEffect(() => {
    visibleCommentsRef.current = comments;
    setVisibleComments(comments);
  }, [comments]);

  const patchComments = (updater: (prev: Comment[]) => Comment[]) => {
    const nextVisible = updater(visibleCommentsRef.current);
    visibleCommentsRef.current = nextVisible;
    setVisibleComments(nextVisible);
    queryClient.setQueryData(queryKey, (old: unknown) => {
      if (!old) return old;
      const current = selectComments(old) ?? [];
      return applyComments(old, updater(current));
    });
  };

  const reconcileReactionMutation = (
    ctx: CommentsMutationContext,
    serverUsers?: string[],
    succeeded = false,
  ) => {
    if (
      !ctx.reactionKey ||
      !ctx.operationToken ||
      !ctx.commentId ||
      !ctx.emoji
    ) {
      return;
    }
    const state = reactionStatesRef.current.get(ctx.reactionKey);
    if (!state) return;

    const token = ctx.operationToken;
    if (succeeded) {
      if (serverUsers && token >= state.confirmedToken) {
        state.confirmedUsers = serverUsers;
        state.confirmedToken = token;
      }
      if (token === state.latestToken && serverUsers) {
        // Keep older requests tracked: the server action is a toggle and an
        // older request can still commit after this response arrives.
        state.authoritativeUsers = serverUsers;
        state.authoritativeToken = token;
      }
    }
    state.pending.delete(token);

    const pendingEntry = Array.from(state.pending.entries()).sort(
      ([left], [right]) => right - left,
    )[0];
    const users =
      pendingEntry &&
      (!state.authoritativeToken || pendingEntry[0] > state.authoritativeToken)
        ? pendingEntry[1].optimisticUsers
        : (state.authoritativeUsers ?? state.confirmedUsers);
    patchComments((list) =>
      list.map((comment) =>
        comment.id === ctx.commentId
          ? {
              ...comment,
              emojiReactionsJson: updateReactionUsers(
                comment.emojiReactionsJson,
                ctx.emoji!,
                users,
              ),
            }
          : comment,
      ),
    );

    if (state.pending.size === 0) {
      void queryClient.invalidateQueries({ queryKey });
      reactionStatesRef.current.delete(ctx.reactionKey);
    }
  };

  const reconcileEditMutation = (
    ctx: CommentsMutationContext,
    data?: {
      id?: string;
      content?: string;
      mentions?: CommentMentionDisplay[];
      updatedAt?: string;
    },
    succeeded = false,
  ) => {
    if (!ctx.commentId || !ctx.operationToken) return;
    const state = editStatesRef.current.get(ctx.commentId);
    if (!state) return;

    const token = ctx.operationToken;
    if (succeeded && data?.content && data.updatedAt) {
      const serverComment: Comment = {
        ...state.confirmed,
        content: data.content,
        ...(data.mentions !== undefined ? { mentions: data.mentions } : {}),
        updatedAt: data.updatedAt,
      };
      if (token >= state.confirmedToken) {
        state.confirmed = serverComment;
        state.confirmedToken = token;
      }
      if (token === state.latestToken) {
        state.authoritative = serverComment;
        state.authoritativeToken = token;
      }
    }
    state.pending.delete(token);

    const pendingEntry = Array.from(state.pending.entries()).sort(
      ([left], [right]) => right - left,
    )[0];
    const projection =
      pendingEntry &&
      (!state.authoritativeToken || pendingEntry[0] > state.authoritativeToken)
        ? pendingEntry[1]
        : (state.authoritative ?? state.confirmed);
    patchComments((list) =>
      list.map((comment) =>
        comment.id === ctx.commentId
          ? {
              ...comment,
              ...projection,
              // Reactions are maintained by their own mutation queue.
              emojiReactionsJson: comment.emojiReactionsJson,
            }
          : comment,
      ),
    );

    if (state.pending.size === 0) {
      void queryClient.invalidateQueries({ queryKey });
      editStatesRef.current.delete(ctx.commentId);
    }
  };

  const rollbackComments = (ctx: CommentsMutationContext | undefined) => {
    if (!ctx) return;
    if (ctx.type === "add" && ctx.tempId) {
      patchComments((list) =>
        list.filter((comment) => comment.id !== ctx.tempId),
      );
      return;
    }
    if (ctx.type === "remove" && ctx.removed) {
      // The query cache may have changed while deletion was in flight. Avoid
      // restoring a stale snapshot; refetch the authoritative list instead.
      patchComments((list) =>
        list.filter(
          (comment) => !successfulDeletionIdsRef.current.has(comment.id),
        ),
      );
      void queryClient.invalidateQueries({ queryKey });
      return;
    }
  };

  const addComment = useActionMutation("add-comment", {
    onMutate: async (vars: any) => {
      await queryClient.cancelQueries({ queryKey });
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
        createdAt: now,
        updatedAt: now,
      };
      patchComments((list) => [...list, optimistic]);
      return { type: "add", tempId } satisfies CommentsMutationContext;
    },
    onError: (_err, _vars, ctx: any) => {
      rollbackComments(ctx);
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

  const reactToComment = useActionMutation("react-to-comment", {
    onMutate: async (vars: any) => {
      await queryClient.cancelQueries({ queryKey });
      const currentUser = currentUserEmail;
      if (!currentUser) {
        return {
          type: "reaction",
          commentId: vars.commentId,
          emoji: vars.emoji,
        } satisfies CommentsMutationContext;
      }
      const currentComment = visibleCommentsRef.current.find(
        (comment) => comment.id === vars.commentId,
      );
      const previousUsers = currentComment
        ? (parseReactions(currentComment.emojiReactionsJson)[vars.emoji] ?? [])
        : [];
      const optimisticUsers = previousUsers.includes(currentUser)
        ? previousUsers.filter((email) => email !== currentUser)
        : [...previousUsers, currentUser];
      const reactionKey = `${vars.commentId}\u0000${vars.emoji}`;
      const operationToken = ++reactionSequenceRef.current;
      const state =
        reactionStatesRef.current.get(reactionKey) ??
        (() => {
          const next: ReactionState = {
            confirmedUsers: previousUsers,
            confirmedToken: 0,
            latestToken: operationToken,
            pending: new Map(),
          };
          reactionStatesRef.current.set(reactionKey, next);
          return next;
        })();
      state.latestToken = operationToken;
      state.pending.set(operationToken, { optimisticUsers });
      patchComments((commentList) =>
        commentList.map((comment) =>
          comment.id === vars.commentId
            ? {
                ...comment,
                emojiReactionsJson: updateReactionUsers(
                  comment.emojiReactionsJson,
                  vars.emoji,
                  optimisticUsers,
                ),
              }
            : comment,
        ),
      );
      return {
        type: "reaction",
        commentId: vars.commentId,
        emoji: vars.emoji,
        reactionKey,
        operationToken,
      } satisfies CommentsMutationContext;
    },
    onError: (_err, _vars, ctx: any) => {
      reconcileReactionMutation(ctx, undefined, false);
    },
    onSuccess: (data: any, _vars: any, ctx: any) => {
      const users = ctx?.emoji
        ? (data?.reactions?.[ctx.emoji] ?? [])
        : undefined;
      reconcileReactionMutation(
        ctx,
        Array.isArray(users) ? users : undefined,
        true,
      );
    },
  });

  const remove = useActionMutation("delete-comment", {
    onMutate: async (vars: any) => {
      await queryClient.cancelQueries({ queryKey });
      const current = visibleCommentsRef.current;
      const target = current.find((comment) => comment.id === vars.id);
      const removedIds = target
        ? collectCommentSubtreeIds(current, target.id)
        : new Set<string>();
      const removed = current.filter((comment) => removedIds.has(comment.id));
      patchComments((list) => {
        return list.filter((comment) => !removedIds.has(comment.id));
      });
      return {
        type: "remove",
        removed,
      } satisfies CommentsMutationContext;
    },
    onError: (_err, _vars, ctx: any) => {
      rollbackComments(ctx);
    },
    onSuccess: (data: any, _vars: any, ctx: any) => {
      const deletedIds = Array.isArray(data?.deletedCommentIds)
        ? data.deletedCommentIds
        : (ctx?.removed ?? []).map((comment: Comment) => comment.id);
      deletedIds.forEach((id: string) =>
        successfulDeletionIdsRef.current.add(id),
      );
      patchComments((list) =>
        list.filter(
          (comment) => !successfulDeletionIdsRef.current.has(comment.id),
        ),
      );
    },
  });

  const updateComment = useActionMutation("update-comment", {
    onMutate: async (vars: any) => {
      await queryClient.cancelQueries({ queryKey });
      const updatedAt = new Date().toISOString();
      const current = visibleCommentsRef.current.find(
        (comment) => comment.id === vars.id,
      );
      const operationToken = ++editSequenceRef.current;
      if (current) {
        const state =
          editStatesRef.current.get(vars.id) ??
          (() => {
            const next: EditState = {
              confirmed: current,
              confirmedToken: 0,
              latestToken: operationToken,
              pending: new Map(),
            };
            editStatesRef.current.set(vars.id, next);
            return next;
          })();
        state.latestToken = operationToken;
        state.pending.set(operationToken, {
          ...current,
          content: vars.content,
          ...(vars.mentions === undefined
            ? {}
            : { mentions: displayCommentMentions(vars.mentions) }),
          updatedAt,
        });
      }
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
      return {
        type: "update",
        commentId: vars.id,
        operationToken,
      } satisfies CommentsMutationContext;
    },
    onError: (_err, vars: any, ctx: any) => {
      reconcileEditMutation(ctx, undefined, false);
      setEditingId(vars.id);
      setEditDraft(vars.content);
      setEditMentions(vars.mentions ?? []);
    },
    onSuccess: (data: any, _vars: any, ctx: any) => {
      reconcileEditMutation(ctx, data, true);
    },
  });

  // Group by thread
  const threads = useMemo(() => {
    const map = new Map<string, Comment[]>();
    visibleComments.forEach((c) => {
      const list = map.get(c.threadId) ?? [];
      list.push(c);
      map.set(c.threadId, list);
    });
    // Sort within threads by createdAt
    return Array.from(map.values()).map((list) =>
      list.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
  }, [visibleComments]);

  // Sort threads by the first comment's videoTimestampMs
  const sortedThreads = useMemo(
    () =>
      threads.slice().sort((a, b) => {
        return (a[0]?.videoTimestampMs ?? 0) - (b[0]?.videoTimestampMs ?? 0);
      }),
    [threads],
  );

  const threadRoots = useMemo(
    () =>
      sortedThreads
        .map(buildCommentThread)
        .filter((root): root is CommentThreadNode => root !== null),
    [sortedThreads],
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
          videoTimestampMs: getCurrentMs?.() ?? currentMs,
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

  function openReply(comment: Comment) {
    if (!canComment) {
      if (!isSignedIn && onUnauthenticated) {
        onUnauthenticated("comment");
      }
      return;
    }
    if (!isSignedIn && onUnauthenticated) {
      onUnauthenticated("comment");
      return;
    }
    setReplyTo(comment);
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

  const renderCommentNode = (
    node: CommentThreadNode,
    depth: number,
    ancestors = new Set<string>(),
  ): ReactNode => {
    if (ancestors.has(node.comment.id)) return null;
    const nextAncestors = new Set(ancestors).add(node.comment.id);
    const replyAllowed = depth < MAX_COMMENT_REPLY_DEPTH;
    const childDepth = Math.min(depth + 1, MAX_COMMENT_REPLY_DEPTH);
    return (
      <li
        key={node.comment.id}
        className={cn(depth === 0 && !isInlinePresentation && "px-3")}
      >
        <CommentCard
          comment={node.comment}
          formatRelativeTime={formatters.formatRelativeTime}
          currentUserEmail={currentUserEmail}
          canComment={canComment}
          onSeek={onSeek}
          onReply={() => openReply(node.comment)}
          onDelete={(id) => remove.mutate({ id })}
          isEditing={editingId === node.comment.id}
          editDraft={editDraft}
          onEditDraftChange={setEditDraft}
          onEditMentionAdd={(mention) =>
            setEditMentions((current) => upsertMention(current, mention))
          }
          hasSelectedEditMentions={selectedEditMentions.length > 0}
          members={mentionMembers}
          onStartEdit={() => startEditing(node.comment)}
          onCancelEdit={cancelEditing}
          onSaveEdit={() => submitEdit(node.comment)}
          onReact={(commentId, emoji) =>
            reactToComment.mutate({ commentId, emoji })
          }
          onUnauthenticated={onUnauthenticated}
          canReply={replyAllowed}
          isReply={depth > 0}
        />
        {replyAllowed && replyTo?.id === node.comment.id ? (
          <div className="ps-8">
            <InlineReplyComposer
              draft={replyDraft}
              textareaRef={replyComposerRef}
              currentUserEmail={currentUserEmail}
              currentUserName={currentUserName}
              onDraftChange={setReplyDraft}
              onMentionAdd={(mention) =>
                setReplyMentions((current) => upsertMention(current, mention))
              }
              members={mentionMembers}
              onCancel={() => {
                setReplyDraft("");
                setReplyMentions([]);
                setReplyTo(null);
              }}
              onSubmit={() => submitDraft(replyDraft, replyTo)}
            />
          </div>
        ) : null}
        {node.children.length > 0 ? (
          <ul
            className={cn(
              "flex flex-col gap-0",
              depth >= MAX_COMMENT_REPLY_DEPTH ? "ps-0" : "ps-8",
            )}
          >
            {node.children.map((child) =>
              renderCommentNode(child, childDepth, nextAncestors),
            )}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto",
          isInlinePresentation && "overscroll-contain",
          isSharePresentation && "flex min-h-0 flex-col",
        )}
      >
        {threadRoots.length === 0 ? (
          <EmptyCommentsState
            enableComments={enableComments}
            isSharePresentation={isSharePresentation}
          />
        ) : (
          <ul
            className={cn(
              "flex flex-col gap-5",
              isInlinePresentation && "gap-0 pb-16",
            )}
          >
            {threadRoots.map((root) => renderCommentNode(root, 0))}
          </ul>
        )}
      </div>

      {isInlinePresentation && enableComments ? (
        <div className="pointer-events-none relative z-10 -mt-16 shrink-0 bg-transparent pt-16">
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 z-0 h-16 bg-gradient-to-b from-background/0 to-background lg:from-background/0 lg:to-background"
          />
          <div className="pointer-events-auto relative z-10 bg-background">
            {composer}
          </div>
        </div>
      ) : isSharePresentation && enableComments ? (
        <div className="px-4 py-4">{composer}</div>
      ) : !isSharePresentation && !isInlinePresentation ? (
        composer
      ) : null}
    </div>
  );
}

function EmptyCommentsState({
  enableComments,
  isSharePresentation,
}: {
  enableComments: boolean;
  isSharePresentation: boolean;
}) {
  const t = useT();
  if (!enableComments) {
    return (
      <Empty
        className={cn(
          "gap-2 rounded-none px-8 py-10",
          isSharePresentation ? "flex-1" : "min-h-full",
        )}
      >
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconMessageCircle />
          </EmptyMedia>
          <EmptyTitle className="text-sm font-medium text-muted-foreground">
            {t("commentsPanel.disabled")}
          </EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Empty
      className={cn(
        "gap-2 rounded-none px-8 py-10",
        isSharePresentation ? "flex-1" : "min-h-full",
      )}
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconMessageCircle />
        </EmptyMedia>
        <EmptyTitle className="text-sm font-medium text-muted-foreground">
          {t("commentsPanel.beFirst")}
        </EmptyTitle>
      </EmptyHeader>
    </Empty>
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
    if (isInlinePresentation) {
      return (
        <button
          type="button"
          onClick={() => onUnauthenticated("comment")}
          className="flex h-[117px] w-full flex-col items-start overflow-hidden px-2.5 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex min-h-0 flex-1 w-full flex-col overflow-hidden rounded-xl border border-transparent bg-background shadow-[var(--comment-input-shadow)]">
            <span className="flex min-h-0 flex-1 items-start px-4 pt-[11px] text-sm leading-5 text-muted-foreground">
              <span className="truncate">
                {t("commentsPanel.leaveComment")}
              </span>
            </span>
            <span className="h-px w-full bg-border" />
            <span className="flex h-[38px] w-full items-center justify-end px-[7px]">
              <span className="flex size-[22px] items-center justify-center rounded-full bg-muted text-muted-foreground">
                <IconArrowUp className="size-3" />
              </span>
            </span>
          </span>
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => onUnauthenticated("comment")}
        className={cn(
          "flex w-full gap-2 text-left text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isInlinePresentation ? "items-center" : "items-start",
          !isInlinePresentation &&
            "rounded-xl bg-muted/60 p-2 transition-colors duration-150 hover:bg-muted",
        )}
      >
        <Avatar
          className={cn("size-7 shrink-0", !isInlinePresentation && "mt-1")}
        >
          <AvatarFallback className="bg-muted text-xs text-muted-foreground">
            A
          </AvatarFallback>
        </Avatar>
        {isInlinePresentation ? (
          <span className="flex min-h-10 min-w-0 flex-1 items-center rounded-[20px] bg-muted/60 px-3 transition-colors duration-150 hover:bg-muted">
            <span className="min-w-0 flex-1 truncate">
              {t("commentsPanel.leaveComment")}
            </span>
          </span>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate">
              {t("commentsPanel.leaveComment")}
            </span>
            <IconMoodSmile className="size-4 shrink-0" />
          </>
        )}
      </button>
    );
  }

  if (isInlinePresentation) {
    return (
      <CommentSubmissionWidget
        draft={draft}
        onDraftChange={onDraftChange}
        onMentionAdd={onMentionAdd}
        members={members}
        onSubmit={onSubmit}
      />
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
          isConversationPresentation ? "items-center" : "items-start",
          isConversationPresentation &&
            !isInlinePresentation &&
            "rounded-xl bg-muted/60 p-2",
        )}
      >
        {isConversationPresentation ? (
          <Avatar className="size-7 shrink-0">
            {avatarUrl ? (
              <AvatarImage
                src={avatarUrl}
                alt={
                  currentUserName ||
                  currentUserEmail ||
                  t("recordingInsights.anonymous")
                }
              />
            ) : null}
            <AvatarFallback className="bg-primary/15 text-xs text-primary">
              {initials(
                currentUserName ||
                  currentUserEmail ||
                  t("recordingInsights.anonymous"),
              )}
            </AvatarFallback>
          </Avatar>
        ) : null}
        <div
          className={cn(
            "flex min-w-0 flex-1 gap-1",
            isConversationPresentation &&
              "items-end bg-muted/60 transition-colors duration-150",
            isConversationPresentation &&
              "rounded-xl p-1.5 ps-3 ring-1 ring-transparent transition-[background-color,box-shadow] focus-within:bg-background focus-within:ring-ring",
          )}
        >
          <CommentTextComposer
            value={draft}
            aria-label={t("commentsPanel.leaveComment")}
            onChange={onDraftChange}
            onMentionAdd={onMentionAdd}
            members={members}
            onSubmit={onSubmit}
            placeholder={t("commentsPanel.leaveComment")}
            rows={2}
            className={cn(
              "resize-none bg-transparent text-base leading-5 sm:text-sm",
              isConversationPresentation
                ? "min-h-8 flex-1 border-0 px-0 py-1 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                : "min-h-[60px]",
            )}
            submitOnEnter
          />
          <Button
            type="button"
            aria-label={t("commentsPanel.commentButton")}
            data-comment-submit
            onClick={onSubmit}
            disabled={!draft.trim()}
            size="icon"
            className={cn(
              "shrink-0 rounded-full",
              isConversationPresentation && "size-7",
            )}
          >
            <IconArrowUp className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function InlineReplyComposer({
  draft,
  textareaRef,
  currentUserEmail,
  currentUserName,
  onDraftChange,
  onMentionAdd,
  members,
  onCancel,
  onSubmit,
}: {
  draft: string;
  textareaRef: Ref<HTMLTextAreaElement>;
  currentUserEmail?: string;
  currentUserName?: string;
  onDraftChange: (value: string) => void;
  onMentionAdd: (mention: MentionEntry) => void;
  members: { email: string; name: string | null }[];
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const t = useT();
  const avatarUrl = useAvatarUrl(currentUserEmail);
  const displayName =
    currentUserName || currentUserEmail || t("recordingInsights.anonymous");

  return (
    <div className="flex items-center gap-2.5">
      <Avatar className="size-6 shrink-0">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName} /> : null}
        <AvatarFallback className="bg-primary/15 text-[10px] text-primary">
          {initials(displayName)}
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 items-end gap-1 rounded-[16px] border border-transparent bg-muted/60 p-[3px] ps-[9px] transition-colors duration-150 focus-within:border-ring">
        <CommentTextComposer
          ref={textareaRef}
          autoFocus
          value={draft}
          aria-label={t("commentsPanel.writeReply")}
          onChange={onDraftChange}
          onMentionAdd={onMentionAdd}
          members={members}
          onSubmit={onSubmit}
          placeholder={t("commentsPanel.writeReply")}
          rows={1}
          className="min-h-6 resize-none border-0 bg-transparent px-0 py-0.5 text-sm leading-5 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          onEscape={onCancel}
          submitOnEnter
        />
        <Button
          size="icon"
          onClick={onSubmit}
          disabled={!draft.trim()}
          aria-label={t("commentsPanel.writeReply")}
          className="size-[22px] rounded-full"
        >
          <IconArrowUp className="size-3" />
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
        submitOnEnter
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
  formatRelativeTime,
  currentUserEmail,
  canComment,
  editDraft,
  isEditing,
  onSeek,
  onReply,
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
  canReply = true,
  isReply,
}: {
  comment: Comment;
  formatRelativeTime: ReturnType<typeof useFormatters>["formatRelativeTime"];
  currentUserEmail?: string;
  canComment: boolean;
  editDraft: string;
  isEditing: boolean;
  onSeek: (ms: number) => void;
  onReply: () => void;
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
  canReply?: boolean;
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
  const canParticipate =
    canComment || (!currentUserEmail && Boolean(onUnauthenticated));

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
  const commentAuthor =
    comment.authorName ||
    comment.authorEmail.split("@")[0] ||
    t("recordingInsights.anonymous");

  return (
    <div className="group/comment flex items-start gap-2 pt-2">
      <Avatar className="size-6 shrink-0">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt={commentAuthor} /> : null}
        <AvatarFallback className="bg-primary text-[10px] text-primary-foreground">
          {initials(commentAuthor)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex h-6 items-center gap-1.5">
          <span className="min-w-0 truncate text-sm font-medium leading-5 text-foreground">
            {commentAuthor}
          </span>
          <span className="text-xs leading-4 text-muted-foreground">
            {relativeTime(comment.createdAt, formatRelativeTime)}
          </span>
          {!isReply ? (
            <button
              type="button"
              onClick={() => onSeek(comment.videoTimestampMs)}
              className="ms-auto rounded-sm font-mono text-xs leading-4 text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {msToClock(comment.videoTimestampMs)}
            </button>
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
              className="mt-0.5 text-sm leading-5 text-foreground [overflow-wrap:anywhere]"
              linkClassName="text-link underline-offset-2 hover:underline"
              renderLists
              protectedSpans={commentMentionSpans(comment.mentions)}
            />

            <div
              data-comment-actions
              className="mt-1 flex min-h-7 min-w-0 flex-nowrap items-center gap-0.5 overflow-x-auto text-xs text-muted-foreground"
            >
              {canParticipate && canReply ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onReply}
                  className="h-7 gap-1.5 rounded-md px-2 text-xs font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <IconCornerDownRight className="size-3" />
                  {t("commentsPanel.reply")}
                </Button>
              ) : null}

              {canParticipate ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("commentsPanel.react")}
                      title={t("commentsPanel.react")}
                      className="size-7 rounded-md text-foreground hover:bg-accent hover:text-accent-foreground"
                    >
                      <IconMoodSmile className="size-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    side="top"
                    align="start"
                    className="w-auto p-1"
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
                          aria-label={`${t("commentsPanel.react")} ${e}`}
                          className="flex size-8 items-center justify-center rounded text-lg hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              ) : null}

              {Object.entries(reactions).map(([emoji, users]) => {
                const mine =
                  !!currentUserEmail && users.includes(currentUserEmail);
                return canParticipate ? (
                  <Button
                    key={emoji}
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      if (!currentUserEmail) {
                        onUnauthenticated?.("react");
                        return;
                      }
                      setLocalJson(JSON.stringify(toggleEmoji(emoji)));
                      onReact(comment.id, emoji);
                    }}
                    aria-pressed={mine}
                    title={t("commentsPanel.react")}
                    className={cn(
                      "h-7 min-w-7 shrink-0 gap-1 rounded-md px-1.5 text-xs font-normal",
                      mine && "text-primary",
                    )}
                  >
                    {emoji} {users.length}
                  </Button>
                ) : (
                  <span
                    key={emoji}
                    className="flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs"
                  >
                    {emoji} {users.length}
                  </span>
                );
              })}

              {isOwner && canComment ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("commentsPanel.moreActions", {
                        author: commentAuthor,
                      })}
                      className="pointer-events-none ms-auto size-7 rounded-md text-muted-foreground opacity-0 transition-opacity group-hover/comment:pointer-events-auto group-hover/comment:opacity-100 group-focus-within/comment:pointer-events-auto group-focus-within/comment:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-accent hover:text-accent-foreground"
                    >
                      <IconDots className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={onStartEdit}>
                      {t("commentsPanel.editComment")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => onDelete(comment.id)}
                    >
                      {t("commentsPanel.delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          </>
        )}
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

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function relativeTime(
  iso: string,
  formatRelativeTime: ReturnType<typeof useFormatters>["formatRelativeTime"],
  now = Date.now(),
): string {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "";

  // RelativeTimeFormat expects negative values for past dates. Keep the
  // thresholds in one place so comment rows consistently use full unit names.
  const deltaSeconds = (timestamp - now) / 1000;
  const absoluteSeconds = Math.abs(deltaSeconds);
  if (absoluteSeconds < 60) {
    return formatRelativeTime(0, "second", { numeric: "auto" });
  }
  if (absoluteSeconds < 3600) {
    return formatRelativeTime(Math.trunc(deltaSeconds / 60), "minute");
  }
  if (absoluteSeconds < 86400) {
    return formatRelativeTime(Math.trunc(deltaSeconds / 3600), "hour");
  }
  if (absoluteSeconds < 30 * 86400) {
    return formatRelativeTime(Math.trunc(deltaSeconds / 86400), "day");
  }
  if (absoluteSeconds < 365 * 86400) {
    return formatRelativeTime(Math.trunc(deltaSeconds / (30 * 86400)), "month");
  }
  return formatRelativeTime(Math.trunc(deltaSeconds / (365 * 86400)), "year");
}
