import { useEffect, useMemo, useState } from "react";
import {
  IconSend,
  IconCheck,
  IconMoodSmile,
  IconCornerDownRight,
  IconDots,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActionMutation } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
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
  } = props;
  const isSignedIn = !!currentUserEmail;
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<Comment | null>(null);

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

  function submit() {
    const text = draft.trim();
    if (!text) return;
    if (!isSignedIn && onUnauthenticated) {
      onUnauthenticated("comment");
      return;
    }
    const vars = replyTo
      ? {
          recordingId,
          content: text,
          videoTimestampMs: replyTo.videoTimestampMs,
          threadId: replyTo.threadId,
          parentId: replyTo.id,
        }
      : { recordingId, content: text, videoTimestampMs: currentMs };
    // Clear composer state before firing the mutation so the UI feels instant —
    // the optimistic cache patch in onMutate puts the comment in the list.
    setDraft("");
    setReplyTo(null);
    addComment.mutate(vars);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {sortedThreads.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">
            No comments yet. Add one at the current timestamp.
          </div>
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
                    onReply={() => {
                      if (!isSignedIn && onUnauthenticated) {
                        onUnauthenticated("comment");
                        return;
                      }
                      setReplyTo(root);
                    }}
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
                            onReply={() => {
                              if (!isSignedIn && onUnauthenticated) {
                                onUnauthenticated("comment");
                                return;
                              }
                              setReplyTo(root);
                            }}
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
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {!enableComments ? (
        <div className="border-t border-border p-3 text-xs text-muted-foreground">
          Comments are disabled for this recording.
        </div>
      ) : !isSignedIn && onUnauthenticated ? (
        <div className="border-t border-border p-3 flex items-center justify-between gap-3 bg-background">
          <span className="text-xs text-muted-foreground">
            Sign in to leave a comment.
          </span>
          <Button
            size="sm"
            onClick={() => onUnauthenticated("comment")}
            className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
          >
            Sign in
          </Button>
        </div>
      ) : (
        <div className="border-t border-border p-3 space-y-2 bg-background">
          {replyTo ? (
            <div className="flex items-center justify-between text-xs text-muted-foreground rounded bg-accent/50 px-2 py-1">
              <span>
                Replying to{" "}
                <span className="font-medium text-foreground">
                  {displayName(replyTo)}
                </span>
              </span>
              <button
                onClick={() => setReplyTo(null)}
                className="hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground px-1">
              Comment at{" "}
              <span className="font-mono">{msToClock(currentMs)}</span>
            </div>
          )}
          <div className="flex gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={replyTo ? "Write a reply…" : "Leave a comment…"}
              className="min-h-[60px] resize-none text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <Button
              onClick={submit}
              disabled={!draft.trim()}
              size="icon"
              className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
            >
              <IconSend className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
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
          {comment.content}
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
