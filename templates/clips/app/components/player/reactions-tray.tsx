import { IconCheck } from "@tabler/icons-react";
import { useMemo, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { REACTION_EMOJIS, REACTION_NAMES } from "./reaction-emojis";

export type ReactionHandlerResult = boolean | void | Promise<boolean | void>;
export type ReactionHandler = (emoji: string) => ReactionHandlerResult;

export interface ReactionSummary {
  id: string;
  emoji: string;
  videoTimestampMs: number;
}

export interface ReactionsTrayProps {
  onReact: ReactionHandler;
  reactions?: Pick<ReactionSummary, "emoji">[];
  disabled?: boolean;
}

interface Float {
  id: number;
  emoji: string;
  left: number;
}

let idc = 0;

export function ReactionsTray({
  onReact,
  reactions,
  disabled,
}: ReactionsTrayProps) {
  const [floats, setFloats] = useState<Float[]>([]);
  const [savingEmoji, setSavingEmoji] = useState<string | null>(null);
  const [savedEmoji, setSavedEmoji] = useState<string | null>(null);

  const reactionCounts = useMemo(() => {
    const counts: Partial<Record<(typeof REACTION_EMOJIS)[number], number>> =
      {};
    for (const reaction of reactions ?? []) {
      if (REACTION_EMOJIS.includes(reaction.emoji as never)) {
        const emoji = reaction.emoji as (typeof REACTION_EMOJIS)[number];
        counts[emoji] = (counts[emoji] ?? 0) + 1;
      }
    }
    return counts;
  }, [reactions]);

  function fire(emoji: string) {
    if (disabled || savingEmoji === emoji) return;
    const id = ++idc;
    const left = 10 + Math.random() * 80; // random horizontal variance within tray
    setFloats((f) => [...f, { id, emoji, left }]);
    setTimeout(() => {
      setFloats((f) => f.filter((x) => x.id !== id));
    }, 2500);

    let result: ReactionHandlerResult;
    try {
      result = onReact(emoji);
    } catch {
      setSavedEmoji((current) => (current === emoji ? null : current));
      return;
    }

    if (result && typeof result === "object" && "then" in result) {
      setSavingEmoji(emoji);
      void Promise.resolve(result)
        .then((saved) => {
          setSavedEmoji((current) =>
            saved === false ? (current === emoji ? null : current) : emoji,
          );
        })
        .catch(() => {
          setSavedEmoji((current) => (current === emoji ? null : current));
        })
        .finally(() => {
          setSavingEmoji((current) => (current === emoji ? null : current));
        });
      return;
    }

    if (result !== false) setSavedEmoji(emoji);
  }

  return (
    <div className="relative flex w-fit max-w-full items-center gap-0.5 rounded-full border border-border bg-card px-1.5 py-1 shadow-sm sm:gap-1 sm:px-2">
      {REACTION_EMOJIS.map((emoji) => (
        <Tooltip key={emoji}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => fire(emoji)}
              disabled={disabled || savingEmoji === emoji}
              aria-label={
                reactionCounts[emoji]
                  ? `${REACTION_NAMES[emoji]} ${reactionCounts[emoji]}`
                  : `React with ${emoji}`
              }
              aria-pressed={savedEmoji === emoji}
              data-reaction-emoji={emoji}
              data-reaction-count={reactionCounts[emoji] ?? 0}
              data-reaction-saved={savedEmoji === emoji}
              className={cn(
                "relative flex h-8 w-8 items-center justify-center rounded-full text-base transition-[background-color,transform,box-shadow] hover:scale-110 hover:bg-accent sm:h-9 sm:w-9 sm:text-xl",
                savedEmoji === emoji &&
                  "bg-accent shadow-[0_0_0_2px_hsl(var(--primary)/0.35)]",
                savingEmoji === emoji && "animate-pulse",
                disabled && "opacity-50 cursor-not-allowed",
              )}
            >
              {emoji}
              {savedEmoji === emoji ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                  <IconCheck className="h-2.5 w-2.5" stroke={3} />
                </span>
              ) : reactionCounts[emoji] ? (
                <span className="absolute -right-0.5 -top-0.5 min-w-3.5 rounded-full bg-muted px-0.5 text-[9px] font-semibold leading-3 text-muted-foreground shadow-sm">
                  {reactionCounts[emoji]}
                </span>
              ) : null}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {reactionCounts[emoji]
              ? `${REACTION_NAMES[emoji]} ${reactionCounts[emoji]}`
              : `React with ${emoji}`}
          </TooltipContent>
        </Tooltip>
      ))}

      {/* Floating reactions */}
      <div className="pointer-events-none absolute inset-0 overflow-visible">
        {floats.map((f) => (
          <span
            key={f.id}
            className="floating-reaction absolute bottom-1 text-2xl"
            style={{ left: f.left + "%" }}
          >
            {f.emoji}
          </span>
        ))}
      </div>

      <style>{`
        .floating-reaction {
          animation: float-up 2.5s ease-out forwards;
        }

        @keyframes float-up {
          0% { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(-200px); opacity: 0; }
        }

        @keyframes float-fade {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }

        @media (prefers-reduced-motion: reduce) {
          .floating-reaction {
            animation: float-fade 600ms ease-out forwards;
          }
        }
      `}</style>
    </div>
  );
}
