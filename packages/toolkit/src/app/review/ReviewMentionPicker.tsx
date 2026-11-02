import type { ReviewMention } from "@agent-native/core/review/types";
import { PopoverContent } from "@agent-native/toolkit/ui/popover";
import { cn } from "@agent-native/toolkit/utils";
import { Fragment, useEffect, type ComponentPropsWithoutRef } from "react";

import { resolveReviewAgent } from "./review-agent.js";
import { ReviewAuthorAvatar, reviewInitials } from "./ReviewAuthorAvatar.js";
import { isReviewAgentMention } from "./ReviewMentionChip.js";

/**
 * A row in the `@` picker. `description` is a second line (an agent's provider,
 * say) that shows only when the row has no `email`.
 */
export type ReviewMentionOption = ReviewMention & {
  description?: string | undefined;
};

export function reviewMentionInitials(mention: ReviewMention): string {
  return reviewInitials(mention.label.trim() || mention.email || "");
}

export function ReviewMentionAvatar({
  mention,
  className,
}: {
  mention: ReviewMention;
  className?: string;
}) {
  const agent = isReviewAgentMention(mention)
    ? resolveReviewAgent({ createdBy: "agent", authorName: mention.label })
    : null;
  return (
    <ReviewAuthorAvatar
      name={mention.label.trim() || mention.email || ""}
      email={mention.email}
      agent={agent}
      size={32}
      decorative
      className={className}
    />
  );
}

export function reviewMentionKey(mention: ReviewMention): string {
  return `${mention.email ?? mention.id ?? mention.label}`;
}

/** The DOM id of option `index`, which the editor's `aria-activedescendant` names. */
export function reviewMentionOptionId(
  listboxId: string,
  index: number,
): string {
  return `${listboxId}-option-${index}`;
}

type ReviewMentionPickerProps = {
  options: readonly ReviewMentionOption[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (mention: ReviewMentionOption) => void;
  /** The listbox's accessible name. */
  label: string;
  /** Heading above the first agent row. People and agents share one list. */
  agentsLabel: string;
  emptyLabel: string;
  /** The editor's `aria-controls` points at this id while options are listed. */
  listboxId: string;
} & Omit<
  ComponentPropsWithoutRef<typeof PopoverContent>,
  "children" | "onSelect" | "id" | "role"
>;

/**
 * The people and agents list under an `@`, a listbox the editor drives through
 * `aria-activedescendant`. DOM focus never leaves the editor: the editor
 * handles the arrow keys and sets `activeIndex`, and nothing in here is
 * focusable. The agents heading is not an option, so `activeIndex` and the
 * option ids count only the rows.
 */
export function ReviewMentionPicker({
  options,
  activeIndex,
  onActiveIndexChange,
  onSelect,
  label,
  agentsLabel,
  emptyLabel,
  listboxId,
  className,
  ...props
}: ReviewMentionPickerProps) {
  const hasOptions = options.length > 0;
  const firstAgentIndex = options.findIndex((option) =>
    isReviewAgentMention(option),
  );

  useEffect(() => {
    if (!hasOptions) return;
    document
      .getElementById(reviewMentionOptionId(listboxId, activeIndex))
      ?.scrollIntoView({ block: "nearest" });
  }, [hasOptions, listboxId, activeIndex]);

  return (
    <PopoverContent
      data-review-popover=""
      side="top"
      align="start"
      alignOffset={4}
      sideOffset={8}
      {...(hasOptions
        ? { role: "listbox", id: listboxId, "aria-label": label }
        : { role: "presentation" })}
      className={cn(
        "max-h-[min(18rem,var(--radix-popover-content-available-height))] w-[296px] max-w-[calc(100vw-2rem)] min-w-0 overflow-y-auto rounded-[10px] border-border p-2",
        className,
      )}
      onOpenAutoFocus={(event) => event.preventDefault()}
      onCloseAutoFocus={(event) => event.preventDefault()}
      // A press on an option must not move focus out of the editor.
      onMouseDown={(event) => event.preventDefault()}
      {...props}
    >
      {hasOptions ? (
        options.map((mention, index) => {
          const active = index === activeIndex;
          const detail = mention.email || mention.description;
          return (
            <Fragment key={reviewMentionKey(mention)}>
              {index === firstAgentIndex ? (
                <>
                  {index > 0 ? (
                    <div
                      role="presentation"
                      aria-hidden="true"
                      data-review-mention-separator=""
                      className="my-1 h-px bg-border"
                    />
                  ) : null}
                  <div
                    role="presentation"
                    data-review-mention-heading=""
                    className="px-2 py-1 text-xs font-medium text-muted-foreground"
                  >
                    {agentsLabel}
                  </div>
                </>
              ) : null}
              <div
                id={reviewMentionOptionId(listboxId, index)}
                role="option"
                aria-selected={active}
                data-review-mention-option=""
                data-active={active ? "" : undefined}
                className={cn(
                  "flex cursor-pointer select-none items-center gap-2 rounded-[8px] px-2 py-1 text-sm",
                  active && "bg-accent text-accent-foreground",
                )}
                onPointerMove={() => onActiveIndexChange(index)}
                onClick={() => onSelect(mention)}
              >
                <ReviewMentionAvatar mention={mention} />
                <span className="flex min-w-0 flex-1 flex-col text-sm leading-5">
                  <span className="truncate text-foreground">
                    {mention.label}
                  </span>
                  {detail ? (
                    <span
                      className={cn(
                        "truncate",
                        active
                          ? "text-accent-foreground/80"
                          : "text-muted-foreground",
                      )}
                    >
                      {detail}
                    </span>
                  ) : null}
                </span>
              </div>
            </Fragment>
          );
        })
      ) : (
        // The composer's live region announces this text, so a screen reader
        // does not hear it twice.
        <div
          aria-hidden="true"
          className="px-2 py-1.5 text-sm text-muted-foreground"
        >
          {emptyLabel}
        </div>
      )}
    </PopoverContent>
  );
}
