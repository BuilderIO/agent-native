import { IconPlayerSkipForwardFilled, IconX } from "@tabler/icons-react";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";

const COUNTDOWN_STEP_MS = 1000;

export function Countdown({ attemptId }: { attemptId?: string }) {
  const [n, setN] = useState(3);
  const [started, setStarted] = useState(false);
  const closingRef = useRef(false);

  const closeWithEvent = useCallback(
    (
      eventName: "clips:countdown-done" | "clips:countdown-cancel",
      cause: "escape" | "return" | "button" | "timer",
    ) => {
      if (closingRef.current) return;
      closingRef.current = true;
      void emit(eventName, { attemptId, cause }).finally(() => {
        getCurrentWindow()
          .close()
          .catch(() => {});
      });
    },
    [attemptId],
  );

  useEffect(() => {
    const countdownWindow = getCurrentWindow();
    let active = true;
    let started = false;
    let checkingPresentation = false;
    let recheckPresentation = false;
    let presentationCheckFailed = false;
    let secondFrame: number | undefined;
    let firstFrame: number | undefined;
    let presentedFrame: number | undefined;
    let presentationTimer: ReturnType<typeof setTimeout> | undefined;
    let unlistenFocus: (() => void) | undefined;

    const startAfterPaint = () => {
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
          if (!active) return;
          setStarted(true);
          presentedFrame = requestAnimationFrame(() => {
            if (active && attemptId) {
              void emit("clips:countdown-presented", { attemptId }).catch(
                (error) => {
                  console.error(
                    "[clips-countdown] presentation acknowledgement failed:",
                    error,
                  );
                },
              );
            }
          });
        });
      });
    };

    const startWhenPresented = async () => {
      if (!active || started) return;
      if (checkingPresentation) {
        recheckPresentation = true;
        return;
      }

      checkingPresentation = true;
      try {
        const visible = await countdownWindow.isVisible();
        presentationCheckFailed = false;
        if (active && visible && !started) {
          started = true;
          if (presentationTimer !== undefined) {
            clearTimeout(presentationTimer);
            presentationTimer = undefined;
          }
          startAfterPaint();
        }
      } catch (error) {
        if (!presentationCheckFailed) {
          console.error(
            "[clips-countdown] window presentation check failed:",
            error,
          );
          presentationCheckFailed = true;
        }
      } finally {
        checkingPresentation = false;
        if (active && recheckPresentation && !started) {
          recheckPresentation = false;
          void startWhenPresented();
        } else if (active && !started) {
          presentationTimer = setTimeout(
            () => {
              presentationTimer = undefined;
              void startWhenPresented();
            },
            presentationCheckFailed ? 250 : 50,
          );
        }
      }
    };

    void startWhenPresented();
    void countdownWindow
      .onFocusChanged(({ payload: focused }) => {
        if (focused) void startWhenPresented();
      })
      .then((unlisten) => {
        if (!active) {
          unlisten();
          return;
        }
        unlistenFocus = unlisten;
      })
      .catch((error) => {
        console.error("[clips-countdown] focus listener failed:", error);
      });

    return () => {
      active = false;
      unlistenFocus?.();
      if (presentationTimer !== undefined) clearTimeout(presentationTimer);
      if (firstFrame !== undefined) cancelAnimationFrame(firstFrame);
      if (secondFrame !== undefined) cancelAnimationFrame(secondFrame);
      if (presentedFrame !== undefined) cancelAnimationFrame(presentedFrame);
    };
  }, [attemptId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeWithEvent("clips:countdown-cancel", "escape");
      } else if (event.key === "Enter") {
        event.preventDefault();
        closeWithEvent("clips:countdown-done", "return");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeWithEvent]);

  useEffect(() => {
    if (!started) return;
    if (n <= 0) {
      closeWithEvent("clips:countdown-done", "timer");
      return;
    }
    const t = setTimeout(() => setN((v) => v - 1), COUNTDOWN_STEP_MS);
    return () => clearTimeout(t);
  }, [closeWithEvent, n, started]);

  return (
    <div className="countdown-root">
      <div className="countdown-controls">
        <button
          type="button"
          className="countdown-control countdown-control-cancel"
          aria-label="Cancel recording"
          onClick={() => closeWithEvent("clips:countdown-cancel", "button")}
        >
          <IconX size={30} stroke={2.4} />
        </button>
        <div className="countdown-number-wrap" aria-hidden="true">
          <div className={`countdown-numbers${started ? " is-running" : ""}`}>
            {[3, 2, 1].map((number) => (
              <span
                className={`countdown-number countdown-number-${number}`}
                key={number}
              >
                {number}
              </span>
            ))}
          </div>
        </div>
        <span
          className="countdown-sr-only"
          aria-live="polite"
          aria-atomic="true"
        >
          {started && n > 0 ? n : ""}
        </span>
        <button
          type="button"
          className="countdown-control countdown-control-skip"
          aria-label="Skip countdown and start recording now"
          onClick={() => closeWithEvent("clips:countdown-done", "button")}
        >
          <IconPlayerSkipForwardFilled size={28} />
        </button>
      </div>
    </div>
  );
}
