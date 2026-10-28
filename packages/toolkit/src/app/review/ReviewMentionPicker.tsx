import { useAvatarUrl } from "@agent-native/core/client/use-avatar";
import type { ReviewMention } from "@agent-native/core/review/types";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@agent-native/toolkit/ui/avatar";
import { PopoverContent } from "@agent-native/toolkit/ui/popover";
import { cn } from "@agent-native/toolkit/utils";
import { useEffect, type ComponentPropsWithoutRef } from "react";

import { resolveReviewAgent } from "./review-agent.js";
import { ReviewAgentMark } from "./ReviewAgentMark.js";
import { isReviewAgentMention } from "./ReviewMentionChip.js";

export function reviewMentionInitials(mention: ReviewMention): string {
  const source = mention.label.trim() || mention.email?.split("@")[0] || "";
  const parts = source.split(/[\s._+-]+/).filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

export function ReviewMentionAvatar({
  mention,
  className,
}: {
  mention: ReviewMention;
  className?: string;
}) {
  const avatarUrl = useAvatarUrl(mention.email);
  const agent = isReviewAgentMention(mention)
    ? resolveReviewAgent({ createdBy: "agent", authorName: mention.label })
    : null;
  return (
    <Avatar aria-hidden="true" className={cn("size-8", className)}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
      <AvatarFallback
        className={cn(
          "text-xs font-semibold text-foreground",
          agent && "bg-popover",
        )}
      >
        {agent ? (
          <ReviewAgentMark kind={agent.kind} className="size-4" />
        ) : (
          reviewMentionInitials(mention)
        )}
      </AvatarFallback>
    </Avatar>
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
  options: readonly ReviewMention[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (mention: ReviewMention) => void;
  /** The listbox's accessible name. */
  label: string;
  emptyLabel: string;
  /** The editor's `aria-controls` points at this id while options are listed. */
  listboxId: string;
} & Omit<
  ComponentPropsWithoutRef<typeof PopoverContent>,
  "children" | "onSelect" | "id" | "role"
>;

/**
 * The people list under an `@`, a listbox the editor drives through
 * `aria-activedescendant`. DOM focus never leaves the editor: the editor
 * handles the arrow keys and sets `activeIndex`, and nothing in here is
 * focusable.
 */
export function ReviewMentionPicker({
  options,
  activeIndex,
  onActiveIndexChange,
  onSelect,
  label,
  emptyLabel,
  listboxId,
  className,
  ...props
}: ReviewMentionPickerProps) {
  const hasOptions = options.length > 0;

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
          return (
            <div
              key={reviewMentionKey(mention)}
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
                {mention.email ? (
                  <span
                    className={cn(
                      "truncate",
                      active
                        ? "text-accent-foreground/80"
                        : "text-muted-foreground",
                    )}
                  >
                    {mention.email}
                  </span>
                ) : null}
              </span>
            </div>
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
