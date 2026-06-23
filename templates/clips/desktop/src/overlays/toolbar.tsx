import { useEffect, useRef, useState } from "react";
import type { FocusEvent } from "react";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  IconAlertTriangle,
  IconLoader2,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";

const OVERLAY_SHADOW_GUTTER = 18;
const TOOLBAR_CONTENT_WIDTH = 72;
const TOOLBAR_COLLAPSED_HEIGHT = 150;
const TOOLBAR_EXPANDED_HEIGHT = 234;
const TOOLBAR_WINDOW_WIDTH = TOOLBAR_CONTENT_WIDTH + OVERLAY_SHADOW_GUTTER * 2;
const TOOLBAR_COLLAPSED_WINDOW_HEIGHT =
  TOOLBAR_COLLAPSED_HEIGHT + OVERLAY_SHADOW_GUTTER * 2;
const TOOLBAR_EXPANDED_WINDOW_HEIGHT =
  TOOLBAR_EXPANDED_HEIGHT + OVERLAY_SHADOW_GUTTER * 2;

/**
 * Floating recording toolbar — vertical pill anchored to the LEFT edge of
 * the screen (Loom's placement). Big orange Stop at the top, elapsed time
 * below, pause underneath. On hover, it grows downward to expose restart
 * and cancel controls. Pure command emitter — the popover owns the
 * MediaRecorder.
 *
 * IPC contract:
 *   receives → `clips:recorder-state` { paused, elapsedMs }
 *   emits    → `clips:recorder-stop`, `:pause`, `:resume`, `:restart`, `:cancel`
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
  const [pendingAction, setPendingAction] = useState<
    "stop" | "restart" | "cancel" | null
  >(null);
  // Pre-record mode: the toolbar shows alongside the pre-record bubble so
  // the user can drag both around and position them before hitting Start.
  // Stop / Pause are disabled until the recorder actually begins, at which
  // point `clips:toolbar-enabled` fires with `true` from the recorder.
  const [enabled, setEnabled] = useState(false);
  const [diskSpaceLevel, setDiskSpaceLevel] = useState<
    "ok" | "warning" | "critical"
  >("ok");
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandedRef = useRef(false);

  useEffect(() => {
    const unlistens: Array<() => void> = [];
    let stopped = false;
    // Same race-safe listen tracker as elsewhere: if this effect
    // cleans up before `listen()` resolves, the unlisten is called
    // immediately — otherwise the listener lingers for the life of
    // the webview, holding the setState closures captive.
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
      }).catch(() => {
        // ignore
      });
    };
    trackListen(
      listen<{ paused: boolean; elapsedMs: number }>(
        "clips:recorder-state",
        (ev) => {
          setPaused(!!ev.payload.paused);
          setElapsed(ev.payload.elapsedMs ?? 0);
        },
      ),
    );
    trackListen(
      listen<boolean>("clips:toolbar-enabled", (ev) => {
        setEnabled(!!ev.payload);
        if (!ev.payload) {
          setDiskSpaceLevel("ok");
        }
      }),
    );
    trackListen(
      listen<{ freeMb: number }>("clips:disk-space-warning", () => {
        setDiskSpaceLevel((prev) =>
          prev === "critical" ? "critical" : "warning",
        );
      }),
    );
    trackListen(
      listen<{ freeMb: number }>("clips:disk-space-critical", () => {
        setDiskSpaceLevel("critical");
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
      if (fallbackTimer.current) {
        clearTimeout(fallbackTimer.current);
        fallbackTimer.current = null;
      }
    };
  }, []);

  function scheduleCloseFallback(action: string) {
    fallbackTimer.current = setTimeout(() => {
      console.warn(
        `[clips-toolbar] recorder did not close toolbar within 3s after ${action} — self-closing`,
      );
      getCurrentWindow()
        .close()
        .catch(() => {});
    }, 3_000);
  }

  function resizeToolbarWindow(expanded: boolean) {
    if (expandedRef.current === expanded) return;
    expandedRef.current = expanded;
    const height = expanded
      ? TOOLBAR_EXPANDED_WINDOW_HEIGHT
      : TOOLBAR_COLLAPSED_WINDOW_HEIGHT;
    getCurrentWindow()
      .setSize(new LogicalSize(TOOLBAR_WINDOW_WIDTH, height))
      .catch((err) => {
        console.warn("[clips-toolbar] resize failed", err);
      });
  }

  function stop() {
    if (pendingAction || !enabled) return;
    setPendingAction("stop");
    console.log("[clips-toolbar] stop clicked — emitting clips:recorder-stop");
    emit("clips:recorder-stop")
      .then(() => scheduleCloseFallback("stop"))
      .catch((err) => {
        console.error("[clips-toolbar] emit clips:recorder-stop failed:", err);
        setPendingAction(null);
      });
    // Defensive fallback: the recorder normally closes us via
    // `hide_overlays` within a second or two. If for any reason the
    // popover listener never fires (popover window closed, listener
    // torn down mid-emit, etc.), self-close after 3s so the user isn't
    // left with a zombie pill floating over their screen. The recorder
    // closing us first is a no-op on the already-closed window.
  }
  function togglePause() {
    if (!enabled || pendingAction) return;
    emit(paused ? "clips:recorder-resume" : "clips:recorder-pause").catch(
      () => {},
    );
  }
  function restart() {
    if (pendingAction || !enabled) return;
    setPendingAction("restart");
    console.log(
      "[clips-toolbar] restart clicked — emitting clips:recorder-restart",
    );
    emit("clips:recorder-restart")
      .then(() => scheduleCloseFallback("restart"))
      .catch((err) => {
        console.error(
          "[clips-toolbar] emit clips:recorder-restart failed:",
          err,
        );
        setPendingAction(null);
      });
  }
  function cancel() {
    if (pendingAction || !enabled) return;
    setPendingAction("cancel");
    console.log(
      "[clips-toolbar] cancel clicked — emitting clips:recorder-cancel",
    );
    emit("clips:recorder-cancel")
      .then(() => scheduleCloseFallback("cancel"))
      .catch((err) => {
        console.error(
          "[clips-toolbar] emit clips:recorder-cancel failed:",
          err,
        );
        setPendingAction(null);
      });
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
  const handleToolbarBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    resizeToolbarWindow(false);
  };

  const pendingActionLabel =
    pendingAction === "restart"
      ? "Restarting..."
      : pendingAction === "cancel"
        ? "Cancelling..."
        : "Stopping...";

  return (
    <div
      className={`toolbar-v ${paused ? "toolbar-v-paused" : ""} ${enabled ? "" : "toolbar-v-disabled"} ${diskSpaceLevel !== "ok" ? `toolbar-v-disk-${diskSpaceLevel}` : ""}`}
      onMouseDown={handleToolbarMouseDown}
      onMouseEnter={() => resizeToolbarWindow(true)}
      onMouseLeave={() => resizeToolbarWindow(false)}
      onFocusCapture={() => resizeToolbarWindow(true)}
      onBlurCapture={handleToolbarBlur}
    >
      <button
        className="toolbar-v-stop"
        onClick={stop}
        disabled={!!pendingAction || !enabled}
        aria-label={
          pendingAction === "stop" ? "Stopping recording" : "Stop recording"
        }
        title={
          pendingAction === "stop"
            ? pendingActionLabel
            : enabled
              ? "Stop recording"
              : "Recording not started yet"
        }
        data-no-drag
      >
        {pendingAction === "stop" ? (
          <IconLoader2 className="toolbar-v-spinner" size={18} />
        ) : (
          <span className="toolbar-v-stop-square" />
        )}
      </button>
      <div className="toolbar-v-time">{formatTime(elapsed)}</div>
      {diskSpaceLevel !== "ok" && (
        <div
          className={`toolbar-v-disk-indicator toolbar-v-disk-indicator-${diskSpaceLevel}`}
          title={
            diskSpaceLevel === "critical"
              ? "Disk almost full — stop recording now to avoid losing your clip"
              : "Low disk space — save your recording soon"
          }
          data-no-drag
        >
          <IconAlertTriangle size={12} />
        </div>
      )}
      <button
        className="toolbar-v-pause"
        onClick={togglePause}
        disabled={!enabled || !!pendingAction}
        aria-label={paused ? "Resume" : "Pause"}
        title={
          pendingAction
            ? pendingActionLabel
            : enabled
              ? paused
                ? "Resume"
                : "Pause"
              : "Recording not started yet"
        }
        data-no-drag
      >
        {paused ? (
          <IconPlayerPlayFilled size={18} />
        ) : (
          <IconPlayerPauseFilled size={18} />
        )}
      </button>
      <div
        className="toolbar-v-hover-actions"
        role="group"
        aria-label="Recording actions"
      >
        <button
          className="toolbar-v-action"
          onClick={restart}
          disabled={!enabled || !!pendingAction}
          aria-label="Restart recording"
          title={
            pendingAction === "restart"
              ? pendingActionLabel
              : enabled
                ? "Restart"
                : "Recording not started yet"
          }
          data-no-drag
        >
          {pendingAction === "restart" ? (
            <IconLoader2 className="toolbar-v-spinner" size={18} />
          ) : (
            <IconRefresh size={24} stroke={1.9} />
          )}
        </button>
        <button
          className="toolbar-v-action toolbar-v-action-danger"
          onClick={cancel}
          disabled={!enabled || !!pendingAction}
          aria-label="Cancel recording"
          title={
            pendingAction === "cancel"
              ? pendingActionLabel
              : enabled
                ? "Cancel"
                : "Recording not started yet"
          }
          data-no-drag
        >
          {pendingAction === "cancel" ? (
            <IconLoader2 className="toolbar-v-spinner" size={18} />
          ) : (
            <IconTrash size={24} stroke={1.9} />
          )}
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
