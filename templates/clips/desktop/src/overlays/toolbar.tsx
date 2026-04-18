import { useEffect, useState } from "react";
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
 */
export function Toolbar() {
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const unlistens: Array<() => void> = [];
    listen<{ paused: boolean; elapsedMs: number }>(
      "clips:recorder-state",
      (ev) => {
        setPaused(!!ev.payload.paused);
        setElapsed(ev.payload.elapsedMs ?? 0);
      },
    ).then((u) => unlistens.push(u));
    return () => unlistens.forEach((u) => u());
  }, []);

  function stop() {
    emit("clips:recorder-stop").finally(() => {
      getCurrentWindow()
        .close()
        .catch(() => {});
    });
  }
  function togglePause() {
    emit(paused ? "clips:recorder-resume" : "clips:recorder-pause").catch(
      () => {},
    );
  }

  return (
    <div
      className={`toolbar-v ${paused ? "toolbar-v-paused" : ""}`}
      data-tauri-drag-region
    >
      <button
        className="toolbar-v-stop"
        onClick={stop}
        aria-label="Stop recording"
        title="Stop recording"
      >
        <span className="toolbar-v-stop-square" />
      </button>
      <div className="toolbar-v-time" data-tauri-drag-region>
        {formatTime(elapsed)}
      </div>
      <button
        className="toolbar-v-pause"
        onClick={togglePause}
        aria-label={paused ? "Resume" : "Pause"}
        title={paused ? "Resume" : "Pause"}
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
