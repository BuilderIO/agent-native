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
                "flex h-8 w-8 items-center justify-center rounded-full text-lg sm:h-9 sm:w-9 sm:text-xl",
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
            className="absolute bottom-1 text-2xl"
            style={{
              left: f.left + "%",
              animation: "float-up 2.5s ease-out forwards",
            }}
          >
            {f.emoji}
          </span>
        ))}
      </div>

      <style>{`
        @keyframes float-up {
          0% { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(-200px); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
