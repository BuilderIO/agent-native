import { useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const EMOJIS = ["👍", "❤️", "🔥", "👏", "🎉", "😂", "🤯"] as const;

export interface ReactionsTrayProps {
  onReact: (emoji: string) => void;
  disabled?: boolean;
}

interface Float {
  id: number;
  emoji: string;
  left: number;
}

let idc = 0;

export function ReactionsTray({ onReact, disabled }: ReactionsTrayProps) {
  const [floats, setFloats] = useState<Float[]>([]);

  function fire(emoji: string) {
    if (disabled) return;
    onReact(emoji);
    const id = ++idc;
    const left = 10 + Math.random() * 80; // random horizontal variance within tray
    setFloats((f) => [...f, { id, emoji, left }]);
    setTimeout(() => {
      setFloats((f) => f.filter((x) => x.id !== id));
    }, 2500);
  }

  return (
    <div className="relative flex w-fit max-w-full items-center gap-0.5 rounded-full border border-border bg-card px-1.5 py-1 shadow-sm sm:gap-1 sm:px-2">
      {EMOJIS.map((emoji) => (
        <Tooltip key={emoji}>
          <TooltipTrigger asChild>
            <button
              onClick={() => fire(emoji)}
              disabled={disabled}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full text-base sm:h-9 sm:w-9 sm:text-xl",
                disabled && "opacity-50 cursor-not-allowed",
              )}
            >
              {emoji}
            </button>
          </TooltipTrigger>
          <TooltipContent>{`React with ${emoji}`}</TooltipContent>
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
