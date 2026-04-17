import { useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Floating recording toolbar. Mirrors Loom's bottom-center pill: pause/resume,
 * stop, live mm:ss timer. Pure command emitter — the popover owns the
 * MediaRecorder and handles the actual stream lifecycle.
 *
 * IPC contract:
 *   receives   → `clips:recorder-state` { paused, elapsedMs }
 *   emits      → `clips:recorder-pause`, `:resume`, `:stop`, `:cancel`
 */
export function Toolbar() {
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    // Make the toolbar window draggable by its own chrome.
    const unlistens: Array<() => void> = [];
    listen<{ paused: boolean; elapsedMs: number }>(
      "clips:recorder-state",
      (ev) => {
        setPaused(!!ev.payload.paused);
        setElapsed(ev.payload.elapsedMs ?? 0);
      },
    ).then((u) => unlistens.push(u));
    return () => {
      unlistens.forEach((u) => u());
    };
  }, []);

  function stop() {
    emit("clips:recorder-stop").finally(() => {
      getCurrentWindow()
        .close()
        .catch(() => {});
    });
  }
  function togglePause() {
    emit(paused ? "clips:recorder-resume" : "clips:recorder-pause");
  }
  function cancel() {
    emit("clips:recorder-cancel").finally(() => {
      getCurrentWindow()
        .close()
        .catch(() => {});
    });
  }

  return (
    <div className={`toolbar-root ${paused ? "toolbar-paused" : ""}`}>
      <div className="toolbar-inner" data-tauri-drag-region>
        <button
          className="toolbar-btn toolbar-stop"
          onClick={stop}
          aria-label="Stop recording"
          title="Stop recording"
        >
          <span className="stop-square" />
        </button>
        <div className="toolbar-timer" data-tauri-drag-region>
          <span className={`rec-pulse ${paused ? "rec-pulse-paused" : ""}`} />
          {formatTime(elapsed)}
        </div>
        <button
          className="toolbar-btn"
          onClick={togglePause}
          aria-label={paused ? "Resume" : "Pause"}
          title={paused ? "Resume (⌥⇧P)" : "Pause (⌥⇧P)"}
        >
          {paused ? <PlayGlyph /> : <PauseGlyph />}
        </button>
        <button
          className="toolbar-btn toolbar-cancel"
          onClick={cancel}
          aria-label="Cancel"
          title="Cancel (⌥⇧C)"
        >
          <XGlyph />
        </button>
      </div>
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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
    </svg>
  );
}
function PlayGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M7 5l13 7-13 7z" fill="currentColor" />
    </svg>
  );
}
function XGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
