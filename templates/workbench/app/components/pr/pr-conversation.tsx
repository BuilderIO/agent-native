import { IconMessage, IconMessageDots } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

/**
 * Right-rail Conversation tab on `/prs/:owner/:repo/:n`.
 *
 * Renders a flat, chronologically ordered list of issue comments + review
 * comments. v1 doesn't thread by review session — that lands in v1.1
 * alongside reaction support. The review comments include their `path:line`
 * so the user can scan inline comments without bouncing to the diff.
 */
export interface PRComment {
  id: number;
  kind: "issue" | "review";
  author: string | null;
  avatarUrl: string | null;
  body: string;
  createdAt: string;
  url?: string;
  path?: string;
  line?: number | null;
}

interface PRConversationProps {
  comments: PRComment[];
}

export function PRConversation({ comments }: PRConversationProps) {
  if (comments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center text-xs text-muted-foreground">
        <IconMessageDots size={24} aria-hidden />
        <p>No comments on this PR yet.</p>
      </div>
    );
  }

  const sorted = [...comments].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return (
    <ol className="space-y-3 px-3 py-3">
      {sorted.map((comment) => (
        <li key={`${comment.kind}-${comment.id}`}>
          <CommentItem comment={comment} />
        </li>
      ))}
    </ol>
  );
}

function CommentItem({ comment }: { comment: PRComment }) {
  return (
    <article className="flex gap-2 rounded-md border bg-card p-3 text-xs">
      <Avatar src={comment.avatarUrl} alt={comment.author ?? "GitHub user"} />
      <div className="min-w-0 flex-1 space-y-1">
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 truncate">
            <span className="truncate font-medium text-foreground">
              {comment.author ?? "ghost"}
            </span>
            {comment.kind === "review" ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground",
                )}
                title={`${comment.path}:${comment.line ?? "?"}`}
              >
                <IconMessage size={10} aria-hidden />
                {truncateMid(comment.path ?? "", 24)}
                {comment.line ? `:${comment.line}` : ""}
              </span>
            ) : null}
          </div>
          <time className="shrink-0 tabular-nums text-muted-foreground">
            {formatRelative(comment.createdAt)}
          </time>
        </header>
        <div className="whitespace-pre-wrap break-words text-foreground/90">
          {comment.body || (
            <span className="text-muted-foreground">(empty body)</span>
          )}
        </div>
      </div>
    </article>
  );
}

function Avatar({ src, alt }: { src: string | null; alt: string }) {
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        className="size-7 shrink-0 rounded-full border bg-muted object-cover"
      />
    );
  }
  return (
    <div aria-hidden className="size-7 shrink-0 rounded-full border bg-muted" />
  );
}

function truncateMid(path: string, limit: number): string {
  if (path.length <= limit) return path;
  const head = Math.max(1, Math.floor(limit / 2) - 2);
  const tail = limit - head - 1;
  return `${path.slice(0, head)}…${path.slice(-tail)}`;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const seconds = Math.max(1, Math.round((now - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.round(months / 12);
  return `${years}y ago`;
}
