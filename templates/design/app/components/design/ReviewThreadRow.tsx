import { useFormatters, useT } from "@agent-native/core/client/i18n";
import {
  formatReviewCommentRelativeTime,
  resolveReviewAgent,
  ReviewAuthorAvatar,
  type ReviewThread,
} from "@agent-native/toolkit/app/review";
import { IconCircleCheck } from "@tabler/icons-react";

import { cn } from "@/lib/utils";

export interface ReviewThreadRowProps {
  thread: ReviewThread;
  unread: boolean;
  active: boolean;
  onSelect: (thread: ReviewThread) => void;
}

export function ReviewThreadRow({
  thread,
  unread,
  active,
  onSelect,
}: ReviewThreadRowProps) {
  const t = useT();
  const formatters = useFormatters();
  const { root } = thread;
  const resolved = root.status === "resolved";
  const agent = resolveReviewAgent({
    createdBy: root.createdBy,
    authorName: root.authorName,
  });
  // An agent's email is its owner's address, so only people fall back to it.
  const author =
    root.authorName?.trim() ||
    (agent ? null : root.authorEmail?.trim()) ||
    (agent ? t("review.agentBadge") : t("review.reviewer"));
  const screenReaderName = [
    author,
    unread ? t("review.unread") : null,
    resolved ? t("review.resolved") : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ");

  return (
    <button
      type="button"
      data-review-thread-row
      data-review-thread-id={root.threadId}
      data-review-thread-unread={unread ? "true" : undefined}
      aria-current={active ? "true" : undefined}
      onClick={() => onSelect(thread)}
      className={cn(
        "relative flex h-8 w-full min-w-0 items-center gap-2 px-4 text-left transition-colors hover:bg-muted/60",
        active && "bg-secondary",
      )}
    >
      {unread ? (
        <span
          aria-hidden="true"
          className="absolute start-1 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary"
        />
      ) : null}
      <span className="sr-only">{screenReaderName}</span>{" "}
      <ReviewAuthorAvatar
        name={author}
        email={root.authorEmail}
        agent={agent}
        size={16}
        decorative
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[11px] leading-4 text-foreground",
          unread && "font-medium",
        )}
      >
        {reviewThreadPreview(root.body)}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {resolved ? (
          <IconCircleCheck
            aria-hidden="true"
            className="size-3 shrink-0 text-muted-foreground"
          />
        ) : null}
        <time
          dateTime={root.createdAt}
          className={cn(
            "text-[11px] leading-4",
            // The active row sits on `bg-secondary`, where the muted token falls to 4.26:1.
            active ? "text-foreground/70" : "text-muted-foreground",
          )}
        >
          {formatReviewCommentRelativeTime(root.createdAt, formatters)}
        </time>
      </span>
    </button>
  );
}

/**
 * The first non-empty line of a comment as plain text. The mention markup is
 * `@[name](mailto:…)`; the toolkit keeps its equivalent private, so the same
 * rule lives here.
 */
export function reviewThreadPreview(body: string): string {
  const plain = body.replace(/@\[([^\]]+)\]\(mailto:[^)]+\)/g, "@$1");
  return (
    plain
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  );
}
