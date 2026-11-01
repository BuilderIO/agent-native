import {
  ReviewAuthorAvatar,
  type ReviewAgentKind,
} from "@agent-native/toolkit/app/review";
import { IconCircleCheck } from "@tabler/icons-react";
import type { ComponentPropsWithRef } from "react";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export interface ReviewPinAuthor {
  name?: string | null;
  email?: string | null;
  agent?: { kind: ReviewAgentKind } | null;
}

const MAX_AUTHOR_AVATARS = 3;

export function ReviewPinBadge({
  authors,
  count,
  selected = false,
  resolved = false,
  unread = false,
  pending = false,
  ariaLabel,
  className,
  ...buttonProps
}: {
  authors: ReviewPinAuthor[];
  // Total comments in the thread. A count of one is implied by the avatar.
  count?: number;
  selected?: boolean;
  resolved?: boolean;
  unread?: boolean | undefined;
  pending?: boolean;
  ariaLabel: string;
  className?: string;
} & Omit<ComponentPropsWithRef<"button">, "children">) {
  const shownAuthors = uniqueReviewPinAuthors(authors).slice(
    0,
    MAX_AUTHOR_AVATARS,
  );
  const showCount = count !== undefined && count > 1;
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={cn(
        "relative flex h-7 items-center rounded-[14px_14px_14px_4px] bg-popover p-0.5 shadow-md transition-transform",
        selected &&
          "ring-2 ring-[hsl(var(--review-pin-ring))] ring-offset-2 ring-offset-popover",
        className,
      )}
      {...buttonProps}
    >
      {pending ? (
        <Spinner className="mx-1 size-3" />
      ) : (
        shownAuthors.map((author, index) => (
          <ReviewAuthorAvatar
            key={authorKey(author) ?? index}
            name={author.name?.trim() || author.email?.trim() || ""}
            email={author.email}
            agent={author.agent}
            size={24}
            decorative
            className={cn("border-2 border-popover", index > 0 && "-ml-2")}
          />
        ))
      )}
      {showCount && !pending ? (
        <span className="pl-[13px] pr-1.5 text-[11px] font-semibold leading-none text-foreground">
          {count}
        </span>
      ) : null}
      {resolved && !pending ? (
        <IconCircleCheck
          aria-hidden="true"
          data-review-pin-resolved-check
          className={cn(
            "mr-1.5 size-3 shrink-0 text-muted-foreground",
            !showCount && "ml-1.5",
          )}
        />
      ) : null}
      {unread && !pending ? (
        <span
          aria-hidden="true"
          data-review-pin-unread-dot
          className="absolute -right-1 -top-1 size-2.5 rounded-full bg-[hsl(var(--review-pin-ring))] ring-2 ring-popover"
        />
      ) : null}
    </button>
  );
}

export function uniqueReviewPinAuthors(
  authors: ReviewPinAuthor[],
): ReviewPinAuthor[] {
  const seen = new Set<string>();
  return authors.filter((author, index) => {
    const key = authorKey(author) ?? `index:${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// An agent's comments carry its owner's email, so two agents of one owner share
// it; an agent is told apart by its name.
function authorKey(author: ReviewPinAuthor): string | null {
  const name = author.name?.trim().toLowerCase();
  if (author.agent) return `agent:${name || author.agent.kind}`;
  const identity = author.email?.trim().toLowerCase() || name;
  return identity ? `person:${identity}` : null;
}
