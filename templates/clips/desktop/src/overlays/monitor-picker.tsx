import { emit } from "@tauri-apps/api/event";
import { useEffect } from "react";

interface MonitorPickerParams {
  index: number;
  total: number;
  displayId: number | null;
}

function parseParams(search: string): MonitorPickerParams {
  const params = new URLSearchParams(search);
  const index = Number.parseInt(params.get("index") ?? "", 10);
  const total = Number.parseInt(params.get("total") ?? "", 10);
  const displayIdRaw = Number.parseInt(params.get("displayId") ?? "", 10);
  return {
    index: Number.isFinite(index) && index > 0 ? index : 1,
    total: Number.isFinite(total) && total > 0 ? total : 1,
    displayId:
      Number.isFinite(displayIdRaw) && displayIdRaw > 0 ? displayIdRaw : null,
  };
}

/**
 * One of these opens centered on every connected monitor before a
 * full-screen native recording starts with more than one monitor attached
 * (see `show_monitor_picker` on the Rust side). The display id this specific
 * monitor resolves to is baked into this window's own URL rather than looked
 * up again here, so a click can report it without a round trip. The recorder
 * driver — not this component — closes every sibling window once it hears
 * either event, so a click never closes just itself.
 */
export function MonitorPicker() {
  const { index, total, displayId } =
    typeof window === "undefined"
      ? { index: 1, total: 1, displayId: null }
      : parseParams(window.location.search);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      emit("clips:monitor-picker-cancelled").catch(() => {});
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function select() {
    emit("clips:monitor-picker-selected", { displayId }).catch(() => {});
  }

  return (
    <div className="monitor-picker-root">
      <button
        type="button"
        className="monitor-picker-card"
        onClick={select}
        autoFocus
      >
        <span className="monitor-picker-title">Screen {index}</span>
        <span className="monitor-picker-subtitle">
          Click to record this display
        </span>
        <span className="monitor-picker-hint">
          {total} displays connected · Esc to cancel
        </span>
      </button>
    </div>
  );
}
