import { IconPlayerSkipForwardFilled, IconX } from "@tabler/icons-react";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";

const COUNTDOWN_STEP_MS = 1000;

/**
 * Full-screen transparent countdown overlay. Runs 3 → 2 → 1 on full-second
 * beats, then emits `clips:countdown-done` and closes its own window. The
 * recorder waits for that event before it starts capturing.
 */
export function Countdown() {
  const [n, setN] = useState(3);
  const closingRef = useRef(false);

  const closeWithEvent = useCallback(
    (eventName: "clips:countdown-done" | "clips:countdown-cancel") => {
      if (closingRef.current) return;
      closingRef.current = true;
      emit(eventName)
        .finally(() => emit("clips:countdown-shortcuts-active", false))
        .finally(() => {
          getCurrentWindow()
            .close()
            .catch(() => {});
        });
    },
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeWithEvent("clips:countdown-cancel");
      } else if (event.key === "Enter") {
        event.preventDefault();
        closeWithEvent("clips:countdown-done");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      emit("clips:countdown-shortcuts-active", false).catch(() => {});
    };
  }, [closeWithEvent]);

  useEffect(() => {
    if (n <= 0) {
      closeWithEvent("clips:countdown-done");
      return;
    }
    const t = setTimeout(() => setN((v) => v - 1), COUNTDOWN_STEP_MS);
    return () => clearTimeout(t);
  }, [closeWithEvent, n]);

  return (
    <div className="countdown-root">
      <div className="countdown-controls">
        <button
          type="button"
          className="countdown-control countdown-control-cancel"
          aria-label="Cancel recording"
          onClick={() => closeWithEvent("clips:countdown-cancel")}
        >
          <IconX size={30} stroke={2.4} />
        </button>
        <div className="countdown-number-wrap">
          <div className="countdown-number" key={n} aria-live="polite">
            {n > 0 ? n : ""}
          </div>
        </div>
        <button
          type="button"
          className="countdown-control countdown-control-skip"
          aria-label="Skip countdown and start recording now"
          onClick={() => closeWithEvent("clips:countdown-done")}
        >
          <IconPlayerSkipForwardFilled size={28} />
        </button>
      </div>
      <div className="countdown-hint" aria-label="Countdown shortcuts">
        <span>
          <kbd>Esc</kbd> cancel
        </span>
        <span>
          <kbd>Return</kbd> start now
        </span>
      </div>
    </div>
  );
}
