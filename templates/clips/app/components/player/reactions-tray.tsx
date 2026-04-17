import { useState } from "react";
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
    <div className="relative flex items-center gap-1 rounded-full border border-border bg-card px-2 py-1 shadow-sm w-fit">
      {EMOJIS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => fire(emoji)}
          disabled={disabled}
          className={cn(
            "h-9 w-9 rounded-full flex items-center justify-center text-xl transition-transform hover:scale-125 active:scale-110",
            disabled && "opacity-50 cursor-not-allowed",
          )}
          title={`React with ${emoji}`}
        >
          {emoji}
        </button>
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
