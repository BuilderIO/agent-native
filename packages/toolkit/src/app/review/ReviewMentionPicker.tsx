import { useAvatarUrl } from "@agent-native/core/client/use-avatar";
import type { ReviewMention } from "@agent-native/core/review/types";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@agent-native/toolkit/ui/avatar";
import {
  DropdownMenuContent,
  DropdownMenuItem,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { cn } from "@agent-native/toolkit/utils";
import type { ComponentPropsWithoutRef } from "react";

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
    <Avatar className={cn("size-8", className)}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
      <AvatarFallback
        className={cn(
          "text-xs font-semibold text-muted-foreground",
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

type ReviewMentionPickerProps = {
  options: readonly ReviewMention[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (mention: ReviewMention) => void;
  label: string;
  emptyLabel: string;
} & Omit<
  ComponentPropsWithoutRef<typeof DropdownMenuContent>,
  "children" | "onSelect"
>;

/**
 * The people list under an `@`. Focus stays in the editor, so the highlight is
 * driven by `activeIndex` (the editor handles the arrow keys) rather than by
 * the menu's own roving focus.
 */
export function ReviewMentionPicker({
  options,
  activeIndex,
  onActiveIndexChange,
  onSelect,
  label,
  emptyLabel,
  className,
  ...props
}: ReviewMentionPickerProps) {
  return (
    <DropdownMenuContent
      data-review-popover=""
      side="top"
      align="start"
      alignOffset={4}
      sideOffset={8}
      aria-label={label}
      className={cn(
        "w-[296px] max-w-[calc(100vw-2rem)] min-w-0 p-2",
        className,
      )}
      onCloseAutoFocus={(event) => event.preventDefault()}
      onFocusOutside={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      {...props}
    >
      {options.length > 0 ? (
        options.map((mention, index) => (
          <DropdownMenuItem
            key={reviewMentionKey(mention)}
            data-review-mention-option=""
            data-active={index === activeIndex ? "" : undefined}
            className={cn(
              "h-auto gap-2 rounded-[8px] px-2 py-1",
              index === activeIndex && "bg-accent text-accent-foreground",
            )}
            // Radix focuses an item on hover, which would pull focus out of
            // the editor mid-sentence.
            onPointerMove={(event) => {
              event.preventDefault();
              onActiveIndexChange(index);
            }}
            onPointerLeave={(event) => event.preventDefault()}
            onSelect={() => onSelect(mention)}
          >
            <ReviewMentionAvatar mention={mention} />
            <span className="flex min-w-0 flex-1 flex-col text-sm leading-5">
              <span className="truncate text-foreground">{mention.label}</span>
              {mention.email ? (
                <span className="truncate text-muted-foreground">
                  {mention.email}
                </span>
              ) : null}
            </span>
          </DropdownMenuItem>
        ))
      ) : (
        <div className="px-2 py-1.5 text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      )}
    </DropdownMenuContent>
  );
}
