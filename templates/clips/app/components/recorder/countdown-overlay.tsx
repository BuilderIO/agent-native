import { useT } from "@agent-native/core/client";
import { IconPlayerSkipForward, IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface CountdownOverlayProps {
  /** Total seconds to count down from. Default 3. */
  seconds?: number;
  /** Called when the countdown reaches 1 (drives the recording-start cue). */
  onOneSecond?: () => void;
  /** Called when the countdown reaches 0 (or the user skips). */
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
  const t = useT();
  const [remaining, setRemaining] = useState(seconds);
  // Ensure each callback fires exactly once for the lifetime of the countdown,
  // even if identities change or the user skips while the timer is mid-flight.
  const hasCompletedRef = useRef(false);
  const hasPlayedOneSecondCueRef = useRef(false);

  const playOneSecondCue = useCallback(() => {
    if (hasPlayedOneSecondCueRef.current) return;
    hasPlayedOneSecondCueRef.current = true;
    onOneSecond?.();
  }, [onOneSecond]);

  const complete = useCallback(() => {
    if (hasCompletedRef.current) return;
    hasCompletedRef.current = true;
    onComplete();
  }, [onComplete]);

  // Skip the rest of the countdown and start recording immediately. Still play
  // the start cue so the user gets the same audible confirmation they'd get if
  // the countdown had run to zero.
  const handleSkip = useCallback(() => {
    playOneSecondCue();
    complete();
  }, [playOneSecondCue, complete]);

  useEffect(() => {
    if (remaining === 1) playOneSecondCue();
  }, [remaining, playOneSecondCue]);

  useEffect(() => {
    if (remaining <= 0) {
      complete();
      return;
    }
    const id = window.setTimeout(() => setRemaining((v) => v - 1), 1000);
    return () => window.clearTimeout(id);
  }, [remaining, complete]);

  // Keyboard parity with the desktop overlay: Enter starts now, Esc cancels.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleSkip();
      } else if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSkip, onCancel]);

  const controlClasses =
    "flex h-16 w-16 items-center justify-center rounded-full border border-white/25 bg-white/5 text-white/90 shadow-lg backdrop-blur transition-colors hover:border-white/60 hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70";

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm"
      aria-live="polite"
      aria-label={t("countdownOverlay.startsIn", { count: remaining })}
    >
      <div className="flex items-center gap-10 sm:gap-14">
        <button
          type="button"
          onClick={onCancel}
          aria-label={t("countdownOverlay.cancel")}
          className={controlClasses}
        >
          <IconX className="h-7 w-7" stroke={1.75} />
        </button>

        <div
          key={remaining}
          className="flex min-w-32 items-center justify-center text-[clamp(96px,22vmin,240px)] font-extrabold leading-none text-white duration-200 animate-in zoom-in-75 fade-in"
          style={{
            fontVariantNumeric: "tabular-nums",
            textShadow:
              "1px 0 1px rgba(17,24,39,0.22), -1px 0 1px rgba(17,24,39,0.22), 0 1px 1px rgba(17,24,39,0.22), 0 -1px 1px rgba(17,24,39,0.22), 0 2px 4px rgba(0,0,0,0.48), 0 12px 34px rgba(0,0,0,0.36), 0 0 2px rgba(0,0,0,0.72)",
          }}
        >
          {remaining > 0 ? remaining : "Go"}
        </div>

        <button
          type="button"
          onClick={handleSkip}
          aria-label={t("countdownOverlay.skip")}
          className={controlClasses}
        >
          <IconPlayerSkipForward className="h-7 w-7" stroke={1.75} />
        </button>
      </div>

      <p className="absolute bottom-16 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-white/70 backdrop-blur">
        {t("countdownOverlay.hint")}
      </p>
    </div>
  );
}
