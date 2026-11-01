import type { ReviewCommentReaction } from "@agent-native/core/review/types";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { cn } from "@agent-native/toolkit/utils";
import { IconMoodSmile } from "@tabler/icons-react";

export const DEFAULT_REACTION_CHOICES = ["👍", "❤️", "🎉", "👀", "🔥"] as const;

export interface ReviewReactionLabelInput {
  emoji: string;
  count: number;
  /** The current user has reacted with this emoji. */
  includesYou: boolean;
}

function defaultReactionLabel({
  emoji,
  count,
  includesYou,
}: ReviewReactionLabelInput): string {
  const noun = count === 1 ? "reaction" : "reactions";
  return `${emoji}, ${count} ${noun}${includesYou ? ", including you" : ""}`;
}

export interface ReviewReactionBarProps {
  reactions?: readonly ReviewCommentReaction[] | undefined;
  /** Enables the chips and the picker; without it chips render disabled. */
  canReact?: boolean | undefined;
  /** Set false to show existing chips without the react button. */
  showAddButton?: boolean | undefined;
  choices?: readonly string[] | undefined;
  addReactionLabel?: string | undefined;
  /** Accessible name of a reaction chip, which shows only the emoji and count. */
  reactionLabel?: ((input: ReviewReactionLabelInput) => string) | undefined;
  onReact: (reaction: string, active: boolean) => void;
  className?: string | undefined;
}

export function ReviewReactionBar({
  reactions = [],
  canReact = false,
  showAddButton = true,
  choices = DEFAULT_REACTION_CHOICES,
  addReactionLabel = "Add reaction",
  reactionLabel = defaultReactionLabel,
  onReact,
  className,
}: ReviewReactionBarProps) {
  const addVisible = canReact && showAddButton;
  if (!addVisible && reactions.length === 0) return null;
  return (
    <div
      className={cn("flex flex-wrap items-center gap-1", className)}
      data-review-reaction-bar
    >
      {addVisible ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 rounded-[8px] text-muted-foreground hover:text-foreground"
              aria-label={addReactionLabel}
            >
              <IconMoodSmile className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            data-review-popover=""
            align="start"
            className="flex w-auto gap-0.5 p-1"
          >
            {choices.map((reaction) => (
              <DropdownMenuItem
                key={reaction}
                className="size-8 justify-center p-0 text-base"
                onSelect={() => onReact(reaction, true)}
              >
                <span aria-hidden="true">{reaction}</span>
                <span className="sr-only">{reaction}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {reactions.map((item) => (
        <button
          key={item.reaction}
          type="button"
          disabled={!canReact}
          className={cn(
            "inline-flex h-6 min-w-6 items-center justify-center gap-1 rounded-md border bg-secondary px-2 text-xs font-medium text-foreground transition-colors",
            item.reactedByMe
              ? "border-primary"
              : "border-transparent hover:bg-secondary/70 disabled:hover:bg-secondary",
          )}
          onClick={() => onReact(item.reaction, !item.reactedByMe)}
          aria-label={reactionLabel({
            emoji: item.reaction,
            count: item.count,
            includesYou: item.reactedByMe,
          })}
          aria-pressed={item.reactedByMe}
        >
          <span aria-hidden="true">{item.reaction}</span>
          {item.count >= 2 ? <span>{item.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
