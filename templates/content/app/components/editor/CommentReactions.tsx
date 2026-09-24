import { useT } from "@agent-native/core/client/i18n";
import { IconMoodSmile } from "@tabler/icons-react";
import { useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { CommentIconButton } from "./CommentRow";
import { EmojiPickerPanel } from "./EmojiPicker";

/** One-tap reactions shown first; the full picker sits beneath them. */
export const QUICK_REACTIONS = ["👍", "❤️", "🎉", "👀"] as const;

export interface CommentReactionSummary {
  reaction: string;
  count: number;
  reactedByMe: boolean;
}

/**
 * Reaction chips under a comment or suggestion. The same chips back both
 * kinds of thread so a reaction reads and toggles the same way everywhere.
 */
export function CommentReactionChips({
  reactions,
  canReact,
  onToggle,
}: {
  reactions: CommentReactionSummary[];
  canReact: boolean;
  onToggle: (reaction: string, active: boolean) => void;
}) {
  const t = useT();
  if (!reactions.length) return null;
  return (
    <div
      className="flex flex-wrap gap-1"
      data-comment-reactions
      onClick={(event) => event.stopPropagation()}
    >
      {reactions.map((entry) => (
        <button
          key={entry.reaction}
          type="button"
          aria-pressed={entry.reactedByMe}
          aria-label={t("comments.reactionCount", {
            reaction: entry.reaction,
            count: entry.count,
          })}
          disabled={!canReact}
          onClick={() => onToggle(entry.reaction, !entry.reactedByMe)}
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-xs text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
            entry.reactedByMe
              ? "border-foreground/20 bg-accent text-foreground"
              : "border-transparent bg-muted hover:bg-accent",
          )}
        >
          <span aria-hidden>{entry.reaction}</span>
          {entry.count > 1 ? (
            <span className="tabular-nums">{entry.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/** The 🙂 button: quick reactions first, then the searchable picker. */
export function AddReactionButton({
  onSelect,
  className,
}: {
  onSelect: (reaction: string) => void;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const choose = (reaction: string) => {
    setOpen(false);
    onSelect(reaction);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <CommentIconButton
          aria-label={t("comments.addReaction")}
          className={className}
          data-comment-add-reaction
          onClick={(event) => event.stopPropagation()}
        >
          <IconMoodSmile size={18} />
        </CommentIconButton>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 p-0"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex gap-1 border-b border-border p-2">
          {QUICK_REACTIONS.map((reaction) => (
            <button
              key={reaction}
              type="button"
              aria-label={reaction}
              onClick={() => choose(reaction)}
              className="flex size-9 items-center justify-center rounded-md text-lg hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {reaction}
            </button>
          ))}
        </div>
        <EmojiPickerPanel autoFocus={open} onSelect={choose} />
      </PopoverContent>
    </Popover>
  );
}
