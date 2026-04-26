import { useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Floating pill indicator visible on the right screen edge during an active
 * meeting recording. Vertical pill (44x120 logical px) with:
 *   - Green pulsing dot (8px, #16A34A) — reuses the `rec-pulse` keyframes
 *   - Meeting initial letter (white)
 *   - Drag handle (three horizontal lines)
 *
 * Click emits `meetings:nub-clicked` so the Rust side can bring the meeting
 * note window to focus. Drag via Tauri's `startDragging()`.
 */
export function MeetingNub() {
  const [initial, setInitial] = useState("M");

  useEffect(() => {
    const unlistens: Array<() => void> = [];
    let stopped = false;

    const trackListen = (p: Promise<() => void>) => {
      p.then((u) => {
        if (stopped) {
          try {
            u();
          } catch {
            // ignore
          }
          return;
        }
        unlistens.push(u);
      }).catch(() => {});
    };

    trackListen(
      listen<{ initial: string }>("meetings:nub-config", (ev) => {
        if (ev.payload.initial) {
          setInitial(ev.payload.initial.charAt(0).toUpperCase());
        }
      }),
    );

    return () => {
      stopped = true;
      unlistens.forEach((u) => {
        try {
          u();
        } catch {
          // ignore
        }
      });
      unlistens.length = 0;
    };
  }, []);

  function handleClick() {
    emit("meetings:nub-clicked").catch(() => {});
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-no-drag]")) return;
    getCurrentWindow()
      .startDragging()
      .catch((err) => {
        console.warn("[meeting-nub] startDragging failed", err);
      });
  }

  return (
    <div className="meeting-nub-root" onMouseDown={handleMouseDown}>
      <div className="meeting-nub" onClick={handleClick}>
        <div className="meeting-nub-dot" />
        <div className="meeting-nub-initial">{initial}</div>
        <div className="meeting-nub-handle" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}
