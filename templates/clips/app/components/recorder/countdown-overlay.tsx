import { useEffect, useRef, useState } from "react";
import { IconPlayerPause, IconPlayerPlay, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";

export interface CountdownOverlayProps {
  /** Total seconds to count down from. Default 3. */
  seconds?: number;
  /** Called when the countdown reaches 1. */
  onOneSecond?: () => void;
  /** Called when the countdown reaches 0. */
  onComplete: () => void;
  /** Called when the user cancels before recording begins. */
  onCancel: () => void;
}

export function CountdownOverlay({
  seconds = 3,
  onOneSecond,
  onComplete,
  onCancel,
}: CountdownOverlayProps) {
  const [remaining, setRemaining] = useState(seconds);
  const [paused, setPaused] = useState(false);
  // Ensure onComplete fires exactly once for the lifetime of the countdown,
  // even if its identity changes while `remaining` is already 0 (which would
  // otherwise re-run this effect and call it again).
  const hasCompletedRef = useRef(false);
  const hasPlayedOneSecondCueRef = useRef(false);

  useEffect(() => {
    if (remaining !== 1 || hasPlayedOneSecondCueRef.current) return;
    hasPlayedOneSecondCueRef.current = true;
    onOneSecond?.();
  }, [remaining, onOneSecond]);

  useEffect(() => {
    if (remaining <= 0) {
      if (!hasCompletedRef.current) {
        hasCompletedRef.current = true;
        onComplete();
      }
      return;
    }
    if (paused) return;
    const id = window.setTimeout(() => setRemaining((v) => v - 1), 1000);
    return () => window.clearTimeout(id);
  }, [remaining, onComplete, paused]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      aria-live="polite"
      aria-label={`Recording starts in ${remaining}`}
    >
      <div className="flex flex-col items-center gap-6">
        <div
          key={remaining}
          className="flex h-48 w-48 items-center justify-center rounded-full text-[120px] font-bold text-white shadow-2xl"
          style={{
            background:
              "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.15), transparent 60%), hsl(var(--primary))",
          }}
        >
          {remaining > 0 ? remaining : "Go"}
        </div>

        <div className="flex items-center gap-2 rounded-full border border-white/15 bg-black/40 p-1.5 shadow-2xl backdrop-blur">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="rounded-full"
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? (
              <IconPlayerPlay className="h-4 w-4" />
            ) : (
              <IconPlayerPause className="h-4 w-4" />
            )}
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            onClick={onCancel}
          >
            <IconX className="h-4 w-4" />
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
