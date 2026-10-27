import { useFormatters, useT } from "@agent-native/core/client/i18n";
import {
  formatReviewCommentRelativeTime,
  resolveReviewAgent,
  type ReviewThread,
} from "@agent-native/toolkit/app/review";

import { cn } from "@/lib/utils";

import { ReviewInitialAvatar } from "./ReviewInitialAvatar";

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
        resolved && "opacity-60",
      )}
    >
      {unread ? (
        <>
          <span
            aria-hidden="true"
            className="absolute start-1 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary"
          />
          <span className="sr-only">{t("review.unread")}</span>
        </>
      ) : null}
      <ReviewInitialAvatar
        name={root.authorName}
        email={root.authorEmail}
        agent={resolveReviewAgent({
          createdBy: root.createdBy,
          authorName: root.authorName,
        })}
        size={16}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[11px] leading-4 text-foreground",
          unread && "font-medium",
        )}
      >
        {reviewThreadPreview(root.body)}
      </span>
      <time
        dateTime={root.createdAt}
        className="shrink-0 text-[11px] leading-4 text-muted-foreground"
      >
        {formatReviewCommentRelativeTime(root.createdAt, formatters)}
      </time>
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
