import { useEffect, useState } from "react";

export interface CountdownOverlayProps {
  /** Total seconds to count down from. Default 3. */
  seconds?: number;
  /** Called when the countdown reaches 0. */
  onComplete: () => void;
}

export function CountdownOverlay({
  seconds = 3,
  onComplete,
}: CountdownOverlayProps) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (remaining <= 0) {
      onComplete();
      return;
    }
    const id = window.setTimeout(() => setRemaining((v) => v - 1), 1000);
    return () => window.clearTimeout(id);
  }, [remaining, onComplete]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      aria-live="polite"
      aria-label={`Recording starts in ${remaining}`}
    >
      <div
        key={remaining}
        className="flex h-48 w-48 items-center justify-center rounded-full text-[120px] font-bold text-white shadow-2xl"
        style={{
          background:
            "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.15), transparent 60%), #625DF5",
        }}
      >
        {remaining > 0 ? remaining : "Go"}
      </div>
    </div>
  );
}
