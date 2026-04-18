import { useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Floating recording toolbar — vertical pill anchored to the LEFT edge of
 * the screen (Loom's placement). Big orange Stop at the top, elapsed time
 * below, pause underneath. Pure command emitter — the popover owns the
 * MediaRecorder.
 *
 * IPC contract:
 *   receives → `clips:recorder-state` { paused, elapsedMs }
 *   emits    → `clips:recorder-stop`, `:pause`, `:resume`, `:cancel`
 *
 * IMPORTANT: The Stop button MUST NOT close its own window. The popover's
 * recorder listener is what drives the stop flow, and it invokes
 * `hide_overlays` from the Rust side once the MediaRecorder has been
 * flushed. Closing the toolbar window synchronously here races the
 * IPC delivery: Tauri's `emit()` promise resolves when the event is
 * queued on the wire, not when listeners have run — if we immediately
 * `.close()` the emitting window, the popover listener can miss the
 * event entirely (observed as: toolbar disappears, nothing else
 * happens, user has to hit the tray icon to actually stop the
 * recording). Let the recorder own the close.
 */
export function Toolbar() {
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [stopping, setStopping] = useState(false);
  // Pre-record mode: the toolbar shows alongside the pre-record bubble so
  // the user can drag both around and position them before hitting Start.
  // Stop / Pause are disabled until the recorder actually begins, at which
  // point `clips:toolbar-enabled` fires with `true` from the recorder.
  const [enabled, setEnabled] = useState(false);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unlistens: Array<() => void> = [];
    listen<{ paused: boolean; elapsedMs: number }>(
      "clips:recorder-state",
      (ev) => {
        setPaused(!!ev.payload.paused);
        setElapsed(ev.payload.elapsedMs ?? 0);
      },
    ).then((u) => unlistens.push(u));
    listen<boolean>("clips:toolbar-enabled", (ev) => {
      setEnabled(!!ev.payload);
    }).then((u) => unlistens.push(u));
    return () => {
      unlistens.forEach((u) => u());
      if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    };
  }, []);

  function stop() {
    if (stopping || !enabled) return;
    setStopping(true);
    console.log("[clips-toolbar] stop clicked — emitting clips:recorder-stop");
    emit("clips:recorder-stop").catch((err) => {
      console.error("[clips-toolbar] emit clips:recorder-stop failed:", err);
    });
    // Defensive fallback: the recorder normally closes us via
    // `hide_overlays` within a second or two. If for any reason the
    // popover listener never fires (popover window closed, listener
    // torn down mid-emit, etc.), self-close after 3s so the user isn't
    // left with a zombie pill floating over their screen. The recorder
    // closing us first is a no-op on the already-closed window.
    fallbackTimer.current = setTimeout(() => {
      console.warn(
        "[clips-toolbar] recorder did not close toolbar within 3s — self-closing",
      );
      getCurrentWindow()
        .close()
        .catch(() => {});
    }, 3_000);
  }
  function togglePause() {
    if (!enabled) return;
    emit(paused ? "clips:recorder-resume" : "clips:recorder-pause").catch(
      () => {},
    );
  }

  // Same explicit-drag pattern the bubble uses — `data-tauri-drag-region`
  // has been unreliable across iterations so we call `startDragging()`
  // directly on mousedown. Interactive controls are marked `data-no-drag`
  // so their clicks reach onClick instead of starting a drag.
  const handleToolbarMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-no-drag]")) return;
    getCurrentWindow()
      .startDragging()
      .catch((err) => {
        console.warn("[clips-toolbar] startDragging failed", err);
      });
  };

  return (
    <div
      className={`toolbar-v ${paused ? "toolbar-v-paused" : ""} ${enabled ? "" : "toolbar-v-disabled"}`}
      onMouseDown={handleToolbarMouseDown}
    >
      <button
        className="toolbar-v-stop"
        onClick={stop}
        disabled={stopping || !enabled}
        aria-label="Stop recording"
        title={enabled ? "Stop recording" : "Recording not started yet"}
        data-no-drag
      >
        <span className="toolbar-v-stop-square" />
      </button>
      <div className="toolbar-v-time">{formatTime(elapsed)}</div>
      <button
        className="toolbar-v-pause"
        onClick={togglePause}
        disabled={!enabled}
        aria-label={paused ? "Resume" : "Pause"}
        title={
          enabled ? (paused ? "Resume" : "Pause") : "Recording not started yet"
        }
        data-no-drag
      >
        {paused ? <PlayGlyph /> : <PauseGlyph />}
      </button>
    </div>
  );
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function PauseGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="7" y="5" width="3.5" height="14" rx="1.5" fill="currentColor" />
      <rect
        x="13.5"
        y="5"
        width="3.5"
        height="14"
        rx="1.5"
        fill="currentColor"
      />
    </svg>
  );
}
function PlayGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M7 5l13 7-13 7z" fill="currentColor" />
    </svg>
  );
}
