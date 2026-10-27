import type { ReviewAgentKind } from "@agent-native/toolkit/app/review";
import type { ButtonHTMLAttributes } from "react";

import { ReviewInitialAvatar } from "@/components/design/ReviewInitialAvatar";
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
  pending?: boolean;
  ariaLabel: string;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  const shownAuthors = uniqueAuthors(authors).slice(0, MAX_AUTHOR_AVATARS);
  const showCount = count !== undefined && count > 1;
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={cn(
        "flex h-7 items-center rounded-[14px_14px_14px_4px] bg-popover p-0.5 shadow-md transition-transform",
        selected && "ring-2 ring-[var(--design-editor-accent-color)]",
        resolved && "opacity-60",
        className,
      )}
      {...buttonProps}
    >
      {pending ? (
        <Spinner className="mx-1 size-3" />
      ) : (
        shownAuthors.map((author, index) => (
          <ReviewInitialAvatar
            key={authorKey(author) ?? index}
            name={author.name}
            email={author.email}
            agent={author.agent}
            size={24}
            className={cn("border-2 border-popover", index > 0 && "-ml-2")}
          />
        ))
      )}
      {showCount && !pending ? (
        <span className="pl-[13px] pr-1.5 text-[11px] font-semibold leading-none text-foreground">
          {count}
        </span>
      ) : null}
    </button>
  );
}

function uniqueAuthors(authors: ReviewPinAuthor[]): ReviewPinAuthor[] {
  const seen = new Set<string>();
  return authors.filter((author, index) => {
    const key = authorKey(author) ?? `index:${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function authorKey(author: ReviewPinAuthor): string | null {
  const identity =
    author.email?.trim().toLowerCase() ||
    author.name?.trim().toLowerCase() ||
    author.agent?.kind ||
    null;
  if (!identity) return null;
  return `${author.agent ? "agent" : "person"}:${identity}`;
}
