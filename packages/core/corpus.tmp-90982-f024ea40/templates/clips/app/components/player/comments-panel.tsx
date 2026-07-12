import { useActionMutation, useT } from "@agent-native/core/client";
import {
  IconSend,
  IconCheck,
  IconMoodSmile,
  IconCornerDownRight,
  IconDots,
  IconMessageCircle,
  IconPlus,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { type Ref, useEffect, useMemo, useRef, useState } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

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

const COMMENT_EMOJIS = ["👍", "❤️", "🔥", "👏", "🎉", "😂"];

export interface Comment {
  id: string;
  threadId: string;
  parentId: string | null;
  authorEmail: string;
  authorName: string | null;
  content: string;
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
  enableComments: boolean;
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
   * The public share page uses a quieter Loom-style activity panel:
   * composer first, empty state centered below. The authenticated recording
   * editor keeps the denser bottom-composer layout.
   */
  presentation?: "default" | "share";
}

export function CommentsPanel(props: CommentsPanelProps) {
  const {
    recordingId,
    comments,
    currentMs,
    currentUserEmail,
    enableComments,
    onSeek,
    onUnauthenticated,
    queryKey,
    selectComments = defaultLens.selectComments,
    applyComments = defaultLens.applyComments,
    presentation = "default",
  } = props;
  const isSignedIn = !!currentUserEmail;
  const isSharePresentation = presentation === "share";
  const [draft, setDraft] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const replyComposerRef = useRef<HTMLTextAreaElement>(null);

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
        authorName: null,
        content: vars.content,
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
        }
      : { recordingId, content: text, videoTimestampMs: currentMs };
    // Clear composer state before firing the mutation so the UI feels instant —
    // the optimistic cache patch in onMutate puts the comment in the list.
    if (target) {
      setReplyDraft("");
      setReplyTo(null);
    } else {
      setDraft("");
    }
    addComment.mutate(vars);
  }

  function openReply(root: Comment) {
    if (!isSignedIn && onUnauthenticated) {
      onUnauthenticated("comment");
      return;
    }
    setReplyTo(root);
    setTimeout(() => replyComposerRef.current?.focus(), 0);
  }

  const composer = (
    <CommentComposer
      draft={draft}
      currentMs={currentMs}
      currentUserEmail={currentUserEmail}
      isSignedIn={isSignedIn}
      isSharePresentation={isSharePresentation}
      enableComments={enableComments}
      onDraftChange={setDraft}
      onSubmit={() => submitDraft(draft, null)}
      onUnauthenticated={onUnauthenticated}
    />
  );

  return (
    <div className="flex h-full flex-col">
      <div
        className={cn(
          "flex-1 overflow-y-auto",
          isSharePresentation && "flex min-h-0 flex-col",
        )}
      >
        {sortedThreads.length === 0 ? (
          <EmptyCommentsState
            enableComments={enableComments}
            isSharePresentation={isSharePresentation}
          />
        ) : (
          <ul className="divide-y divide-border">
            {sortedThreads.map((thread) => {
              const root = thread[0];
              const replies = thread.slice(1);
              return (
                <li key={root.threadId} className="p-3 space-y-2">
                  <CommentCard
                    comment={root}
                    currentUserEmail={currentUserEmail}
                    onSeek={onSeek}
                    onReply={() => openReply(root)}
                    onResolve={(id, resolved) =>
                      resolve.mutate({ id, resolved })
                    }
                    onDelete={(id) => remove.mutate({ id })}
                    onReact={(commentId, emoji) =>
                      reactToComment.mutate({ commentId, emoji })
                    }
                    onUnauthenticated={onUnauthenticated}
                  />
                  {replies.length ? (
                    <ul className="pl-8 space-y-2 border-l-2 border-border ml-3">
                      {replies.map((r) => (
                        <li key={r.id}>
                          <CommentCard
                            comment={r}
                            currentUserEmail={currentUserEmail}
                            onSeek={onSeek}
                            onReply={() => openReply(root)}
                            onResolve={(id, resolved) =>
                              resolve.mutate({ id, resolved })
                            }
                            onDelete={(id) => remove.mutate({ id })}
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
                      onCancel={() => {
                        setReplyDraft("");
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
        <div className="border-t border-border px-4 py-4">{composer}</div>
      ) : !isSharePresentation ? (
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

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-8 py-12 text-center",
        isSharePresentation ? "flex-1" : "min-h-full",
      )}
    >
      <div className="relative mb-5 flex size-16 items-center justify-center text-muted-foreground/40">
        <IconMessageCircle className="size-16 stroke-[1.35]" />
        <span className="absolute -right-1 top-1 flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
          <IconPlus className="size-4" />
        </span>
      </div>
      <p className="text-base font-semibold text-foreground">
        {t("commentsPanel.beFirst")}
      </p>
      <p className="mt-2 max-w-[240px] text-sm leading-5 text-muted-foreground">
        {isSharePresentation
          ? t("commentsPanel.leaveNotePanel")
          : t("commentsPanel.leaveNoteTimestamp")}
      </p>
    </div>
  );
}

function CommentComposer({
  draft,
  currentMs,
  currentUserEmail,
  isSignedIn,
  isSharePresentation,
  enableComments,
  onDraftChange,
  onSubmit,
  onUnauthenticated,
}: {
  draft: string;
  currentMs: number;
  currentUserEmail?: string;
  isSignedIn: boolean;
  isSharePresentation: boolean;
  enableComments: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onUnauthenticated?: (intent: "comment" | "react") => void;
}) {
  const t = useT();
  if (!enableComments) {
    return (
      <div className="border-t border-border p-3 text-xs text-muted-foreground">
        {t("commentsPanel.disabled")}
      </div>
    );
  }

  if (!isSignedIn && onUnauthenticated) {
    if (isSharePresentation) {
      return (
        <button
          type="button"
          onClick={() => onUnauthenticated("comment")}
          className="flex min-h-16 w-full items-center gap-3 rounded-md border border-border bg-background px-3 py-2.5 text-left text-sm text-muted-foreground shadow-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar className="size-7 shrink-0">
            <AvatarFallback className="bg-primary/15 text-xs text-primary">
              A
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 truncate">
            {t("commentsPanel.leaveComment")}
          </span>
          <IconMoodSmile className="size-4 shrink-0 text-muted-foreground" />
        </button>
      );
    }

    return (
      <div className="flex items-center justify-between gap-3 border-t border-border bg-background p-3">
        <span className="text-xs text-muted-foreground">
          {t("commentsPanel.signInToComment")}
        </span>
        <Button
          size="sm"
          onClick={() => onUnauthenticated("comment")}
          className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {t("commentsPanel.signIn")}
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "bg-background",
        isSharePresentation
          ? "space-y-2"
          : "space-y-2 border-t border-border p-3",
      )}
    >
      {!isSharePresentation ? (
        <div className="px-1 text-[11px] text-muted-foreground">
          {t("commentsPanel.commentAt")}{" "}
          <span className="font-mono">{msToClock(currentMs)}</span>
        </div>
      ) : null}
      <div
        className={cn(
          "flex gap-2",
          isSharePresentation &&
            "items-start rounded-md border border-border bg-background p-3 shadow-sm",
        )}
      >
        {isSharePresentation ? (
          <Avatar className="mt-0.5 size-7 shrink-0">
            <AvatarFallback className="bg-primary/15 text-xs text-primary">
              {initials(currentUserEmail ?? "Anonymous")}
            </AvatarFallback>
          </Avatar>
        ) : null}
        <Textarea
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder={t("commentsPanel.leaveComment")}
          className={cn(
            "resize-none text-sm",
            isSharePresentation
              ? "min-h-10 flex-1 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              : "min-h-[60px]",
          )}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        <Button
          onClick={onSubmit}
          disabled={!draft.trim()}
          size="icon"
          className={cn(
            "shrink-0 bg-primary text-primary-foreground hover:bg-primary/90",
            isSharePresentation && "size-8",
          )}
        >
          <IconSend className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function InlineReplyComposer({
  draft,
  textareaRef,
  onDraftChange,
  onCancel,
  onSubmit,
}: {
  draft: string;
  textareaRef: Ref<HTMLTextAreaElement>;
  onDraftChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const t = useT();

  return (
    <div className="ml-9 mt-2 rounded-lg border border-border bg-muted/20 p-2">
      <Textarea
        ref={textareaRef}
        autoFocus
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        placeholder={t("commentsPanel.writeReply")}
        className="min-h-16 resize-none bg-background text-sm"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (
            event.key === "Enter" &&
            (event.metaKey || event.ctrlKey)
          ) {
            event.preventDefault();
            onSubmit();
          }
        }}
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

function CommentCard({
  comment,
  currentUserEmail,
  onSeek,
  onReply,
  onResolve,
  onDelete,
  onReact,
  onUnauthenticated,
  isReply,
}: {
  comment: Comment;
  currentUserEmail?: string;
  onSeek: (ms: number) => void;
  onReply: () => void;
  onResolve: (id: string, resolved: boolean) => void;
  onDelete: (id: string) => void;
  onReact: (commentId: string, emoji: string) => void;
  onUnauthenticated?: (intent: "comment" | "react") => void;
  isReply?: boolean;
}) {
  // Local override forces a synchronous re-render the instant the user clicks
  // an emoji — independent of React Query cache propagation. It's cleared as
  // soon as the prop (server-confirmed) catches up to whatever we showed.
  const [localJson, setLocalJson] = useState<string | null>(null);
  useEffect(() => {
    setLocalJson(null);
  }, [comment.emojiReactionsJson]);

  const reactions = parseReactions(localJson ?? comment.emojiReactionsJson);
  const isOwner = currentUserEmail && comment.authorEmail === currentUserEmail;

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

  const commentContent = linkifyCommentContent(comment.content);

  return (
    <div className={cn("flex gap-2", comment.resolved && "opacity-60")}>
      <Avatar className="h-7 w-7 shrink-0">
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
        <p className="text-sm text-foreground whitespace-pre-wrap break-words mt-0.5">
          {commentContent}
        </p>

        <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
          <button
            onClick={onReply}
            className="hover:text-foreground flex items-center gap-1"
          >
            <IconCornerDownRight className="h-3 w-3" />
            Reply
          </button>

          <Popover>
            <PopoverTrigger asChild>
              <button className="hover:text-foreground flex items-center gap-1">
                <IconMoodSmile className="h-3 w-3" /> React
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="p-1 w-auto">
              <div className="flex gap-0.5">
                {COMMENT_EMOJIS.map((e) => (
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

          {currentUserEmail ? (
            <button
              onClick={() => onResolve(comment.id, !comment.resolved)}
              className="hover:text-foreground"
            >
              {comment.resolved ? "Unresolve" : "Resolve"}
            </button>
          ) : null}

          {isOwner ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="ml-auto hover:text-foreground">
                  <IconDots className="h-3 w-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
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

        {Object.keys(reactions).length > 0 ? (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {Object.entries(reactions).map(([emoji, users]) => {
              const mine =
                !!currentUserEmail && users.includes(currentUserEmail);
              return (
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
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const COMMENT_URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<]+/gi;
const ALWAYS_TRAILING_PUNCTUATION = new Set([
  ".",
  ",",
  "!",
  "?",
  ";",
  ":",
  "'",
  '"',
]);
const PAIRED_TRAILING_PUNCTUATION: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{",
};

function trimTrailingUrlPunctuation(value: string): {
  url: string;
  trailing: string;
} {
  let end = value.length;

  while (end > 0) {
    const lastCharacter = value[end - 1];
    if (ALWAYS_TRAILING_PUNCTUATION.has(lastCharacter)) {
      end -= 1;
      continue;
    }

    const openingCharacter = PAIRED_TRAILING_PUNCTUATION[lastCharacter];
    if (openingCharacter) {
      const candidate = value.slice(0, end);
      const openingCount = candidate.split(openingCharacter).length - 1;
      const closingCount = candidate.split(lastCharacter).length - 1;
      if (closingCount > openingCount) {
        end -= 1;
        continue;
      }
    }

    break;
  }

  return {
    url: value.slice(0, end),
    trailing: value.slice(end),
  };
}

function linkifyCommentContent(content: string): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(COMMENT_URL_PATTERN)) {
    const matchIndex = match.index;
    const matchedText = match[0];
    const { url, trailing } = trimTrailingUrlPunctuation(matchedText);
    const href = url.toLowerCase().startsWith("www.") ? `https://${url}` : url;

    let isValidUrl = false;
    try {
      isValidUrl = Boolean(new URL(href).hostname);
    } catch {
      // Leave malformed URL-like text unlinked.
    }

    if (!isValidUrl) continue;

    if (matchIndex > lastIndex) {
      result.push(content.slice(lastIndex, matchIndex));
    }
    result.push(
      <a
        key={`${matchIndex}-${url}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:underline"
      >
        {url}
      </a>,
    );
    if (trailing) result.push(trailing);

    lastIndex = matchIndex + matchedText.length;
  }

  if (lastIndex < content.length) {
    result.push(content.slice(lastIndex));
  }

  return result;
}

function parseReactions(raw: string): Record<string, string[]> {
  try {
    const v = JSON.parse(raw ?? "{}");
    if (v && typeof v === "object") return v as Record<string, string[]>;
  } catch {}
  return {};
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
