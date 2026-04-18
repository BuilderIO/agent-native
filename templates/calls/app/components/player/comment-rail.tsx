import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  IconSend,
  IconCheck,
  IconCornerDownRight,
  IconX,
  IconMessage,
} from "@tabler/icons-react";
import { useActionMutation } from "@agent-native/core/client";
import { formatMs } from "@/lib/timestamp-format";

export interface CommentRow {
  id: string;
  threadId: string;
  parentId: string | null;
  authorEmail: string;
  authorName: string | null;
  authorAvatarUrl?: string | null;
  content: string;
  videoTimestampMs: number;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CommentRailProps {
  callId: string;
  comments: CommentRow[];
  currentMs: number;
  currentUserEmail?: string;
  enableComments: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSeek: (ms: number) => void;
  onRefetch?: () => void;
  className?: string;
}

export function CommentRail(props: CommentRailProps) {
  const {
    callId,
    comments,
    currentMs,
    currentUserEmail,
    enableComments,
    open,
    onOpenChange,
    onSeek,
    onRefetch,
    className,
  } = props;

  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<CommentRow | null>(null);

  const add = useActionMutation("add-comment", {
    onSuccess: () => {
      setDraft("");
      setReplyTo(null);
      onRefetch?.();
    },
  });

  const threads = useMemo(() => {
    const map = new Map<string, CommentRow[]>();
    for (const c of comments) {
      const arr = map.get(c.threadId) ?? [];
      arr.push(c);
      map.set(c.threadId, arr);
    }
    const grouped = Array.from(map.values()).map((list) =>
      list.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
    return grouped.sort(
      (a, b) => (a[0]?.videoTimestampMs ?? 0) - (b[0]?.videoTimestampMs ?? 0),
    );
  }, [comments]);

  if (!open) {
    return (
      <div className={cn("absolute top-4 right-4 z-10", className)}>
        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          onClick={() => onOpenChange(true)}
        >
          <IconMessage className="h-4 w-4" />
          Comments
          <span className="text-xs font-mono text-muted-foreground">
            {comments.length}
          </span>
        </Button>
      </div>
    );
  }

  function submit() {
    const text = draft.trim();
    if (!text) return;
    if (replyTo) {
      add.mutate({
        callId,
        content: text,
        videoTimestampMs: replyTo.videoTimestampMs,
        threadId: replyTo.threadId,
        parentId: replyTo.id,
      } as any);
    } else {
      add.mutate({
        callId,
        content: text,
        videoTimestampMs: currentMs,
      } as any);
    }
  }

  return (
    <div
      className={cn(
        "h-full flex flex-col border-l border-border bg-background",
        className,
      )}
    >
      <div className="p-3 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2">
          <IconMessage className="h-4 w-4" />
          <h3 className="text-sm font-semibold">Comments</h3>
          <span className="text-xs font-mono text-muted-foreground">
            {comments.length}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onOpenChange(false)}
        >
          <IconX className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">
            No comments yet. Add one at{" "}
            <span className="font-mono">{formatMs(currentMs)}</span>.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {threads.map((thread) => {
              const root = thread[0];
              const replies = thread.slice(1);
              return (
                <li key={root.threadId} className="p-3 space-y-2">
                  <CommentCard
                    comment={root}
                    currentUserEmail={currentUserEmail}
                    onSeek={onSeek}
                    onReply={() => setReplyTo(root)}
                    onRefetch={onRefetch}
                  />
                  {replies.length ? (
                    <ul className="pl-8 space-y-2 border-l border-border ml-3">
                      {replies.map((r) => (
                        <li key={r.id}>
                          <CommentCard
                            comment={r}
                            currentUserEmail={currentUserEmail}
                            onSeek={onSeek}
                            onReply={() => setReplyTo(root)}
                            onRefetch={onRefetch}
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

      {enableComments ? (
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
              <span className="font-mono">{formatMs(currentMs)}</span>
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
              disabled={!draft.trim() || add.isPending}
              size="icon"
              className="shrink-0"
            >
              <IconSend className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="border-t border-border p-3 text-xs text-muted-foreground">
          Comments are disabled for this call.
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
  onRefetch,
  isReply,
}: {
  comment: CommentRow;
  currentUserEmail?: string;
  onSeek: (ms: number) => void;
  onReply: () => void;
  onRefetch?: () => void;
  isReply?: boolean;
}) {
  const resolve = useActionMutation("resolve-comment", {
    onSuccess: () => onRefetch?.(),
  });
  const remove = useActionMutation("delete-comment", {
    onSuccess: () => onRefetch?.(),
  });
  const isOwner = currentUserEmail && comment.authorEmail === currentUserEmail;

  return (
    <div className={cn("flex gap-2", comment.resolved && "opacity-60")}>
      <Avatar className="h-7 w-7 shrink-0">
        {comment.authorAvatarUrl ? (
          <AvatarImage src={comment.authorAvatarUrl} />
        ) : null}
        <AvatarFallback className="text-[10px] font-semibold">
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
              className="font-mono text-[11px] text-foreground hover:underline"
            >
              {formatMs(comment.videoTimestampMs)}
            </button>
          ) : null}
          <span className="text-muted-foreground text-[11px]">
            {relativeTime(comment.createdAt)}
          </span>
          {comment.resolved ? (
            <span className="ml-auto text-[10px] text-muted-foreground flex items-center gap-1">
              <IconCheck className="h-3 w-3" /> Resolved
            </span>
          ) : null}
        </div>
        <p className="text-sm text-foreground whitespace-pre-wrap break-words mt-0.5">
          {comment.content}
        </p>

        <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
          <button
            onClick={onReply}
            className="hover:text-foreground flex items-center gap-1"
          >
            <IconCornerDownRight className="h-3 w-3" />
            Reply
          </button>
          <button
            onClick={() =>
              resolve.mutate({
                id: comment.id,
                resolved: !comment.resolved,
              } as any)
            }
            className="hover:text-foreground"
          >
            {comment.resolved ? "Unresolve" : "Resolve"}
          </button>
          {isOwner ? (
            <button
              onClick={() => remove.mutate({ id: comment.id } as any)}
              className="hover:text-destructive ml-auto"
            >
              Delete
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function displayName(c: CommentRow): string {
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
