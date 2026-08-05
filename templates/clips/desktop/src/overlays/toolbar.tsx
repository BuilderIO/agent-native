import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronUp,
  IconLoader2,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconBookmarkFilled,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";

const OVERLAY_SHADOW_GUTTER = 18;
const TOOLBAR_CONTENT_WIDTH = 72;
// 170px primary zone (Stop / time / Pause / marker) + 88px action zone
// (+2 margin) + 20px caret row + 20 vertical padding. The action zone is
// toggled by the caret CLICK, never by hover — WKWebView in a non-focused
// window doesn't deliver hover events until the window is clicked (made
// key), which made hover-revealed buttons undiscoverable.
const TOOLBAR_HEIGHT_EXPANDED = 300;
// Collapsed: just the grab handle, the timer, and the caret — recording
// control moves to the popover/tray/shortcuts until re-expanded.
const TOOLBAR_HEIGHT_COLLAPSED = 88;
const TOOLBAR_WINDOW_WIDTH = TOOLBAR_CONTENT_WIDTH + OVERLAY_SHADOW_GUTTER * 2;
const TOOLBAR_COLLAPSED_KEY = "clips:toolbar-actions-collapsed";

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
  // Restart/discard zone visibility — caret-toggled, persisted so the
  // preference sticks across recordings.
  const [actionsCollapsed, setActionsCollapsed] = useState(
    () => localStorage.getItem(TOOLBAR_COLLAPSED_KEY) === "1",
  );
  function toggleActionsCollapsed() {
    setActionsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(TOOLBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Private-mode storage failures just lose the preference.
      }
      return next;
    });
  }
  // Pre-record mode: the toolbar shows alongside the pre-record bubble so
  // the user can drag both around and position them before hitting Start.
  // Stop / Pause are disabled until the recorder actually begins, at which
  // point `clips:toolbar-enabled` fires with `true` from the recorder.
  const [enabled, setEnabled] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [popoverVisible, setPopoverVisible] = useState(true);
  const [diskSpaceLevel, setDiskSpaceLevel] = useState<
    "ok" | "warning" | "critical"
  >("ok");
  // Sink-watchdog warning ("capture isn't writing to disk") — sticky for the
  // rest of the session so a glance at the pill shows something is wrong.
  const [recordingWarning, setRecordingWarning] = useState<string | null>(null);
  const [markerCount, setMarkerCount] = useState(0);
  const [markerFlash, setMarkerFlash] = useState(false);
  const markerFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pauseTransitionRef = useRef<"pause" | "resume" | null>(null);
  const pauseTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  function clearPauseTransition() {
    pauseTransitionRef.current = null;
    if (pauseTransitionTimerRef.current) {
      clearTimeout(pauseTransitionTimerRef.current);
      pauseTransitionTimerRef.current = null;
    }
  }

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
          const nextPaused = !!ev.payload.paused;
          const pendingTransition = pauseTransitionRef.current;
          const transitionReached =
            (pendingTransition === "pause" && nextPaused) ||
            (pendingTransition === "resume" && !nextPaused);
          // Native pause/resume can take a beat. Keep the first click's
          // optimistic state instead of letting an in-flight timer tick briefly
          // flip the button back and invite duplicate clicks.
          if (!pendingTransition || transitionReached) {
            setPaused(nextPaused);
          }
          if (transitionReached) clearPauseTransition();
          setElapsed(ev.payload.elapsedMs ?? 0);
        },
      ),
    );
    trackListen(
      listen<boolean>("clips:toolbar-enabled", (ev) => {
        setEnabled(!!ev.payload);
        setPreparing(false);
        setPendingAction(null);
        if (!ev.payload) {
          setDiskSpaceLevel("ok");
          setRecordingWarning(null);
          setPaused(false);
          setElapsed(0);
          setMarkerCount(0);
        }
      }),
    );
    trackListen(
      listen<{ count: number }>("clips:marker-added", (ev) => {
        setMarkerCount(ev.payload.count ?? 0);
        setMarkerFlash(true);
        if (markerFlashTimer.current) clearTimeout(markerFlashTimer.current);
        markerFlashTimer.current = setTimeout(() => setMarkerFlash(false), 700);
      }),
    );
    trackListen(
      listen<boolean>("clips:toolbar-preparing", (ev) => {
        setPreparing(!!ev.payload);
      }),
    );
    trackListen(
      listen<boolean>("clips:popover-visible", (ev) => {
        setPopoverVisible(!!ev.payload);
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
      // Emitted by the Rust sink watchdog when a capture is "running" but
      // never materialized its file on disk — the recording is not being
      // written and continuing is pointless. Surface it on the pill; the
      // timer keeps ticking, so without this the failure is invisible until
      // stop reports "recording file missing" minutes later.
      listen<string>("clips:recording-warning", (ev) => {
        setRecordingWarning(
          typeof ev.payload === "string" && ev.payload.trim()
            ? ev.payload
            : "Recording warning — the capture may not be saving. Stop and re-record.",
        );
      }),
    );
    trackListen(
      listen<{ freeMb: number }>("clips:disk-space-critical", () => {
        setDiskSpaceLevel("critical");
      }),
    );
    trackListen(
      listen<{ freeMb: number }>("clips:disk-space-ok", () => {
        setDiskSpaceLevel("ok");
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
      if (markerFlashTimer.current) {
        clearTimeout(markerFlashTimer.current);
        markerFlashTimer.current = null;
      }
      clearPauseTransition();
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

  // Size the native window to the current collapse state (also fixes the
  // size when an older tray build created the window smaller). Transparent
  // window pixels would block clicks beneath the pill, so the window always
  // hugs the visible content.
  useEffect(() => {
    const height =
      (actionsCollapsed ? TOOLBAR_HEIGHT_COLLAPSED : TOOLBAR_HEIGHT_EXPANDED) +
      OVERLAY_SHADOW_GUTTER * 2;
    getCurrentWindow()
      .setSize(new LogicalSize(TOOLBAR_WINDOW_WIDTH, height))
      .catch((err) => {
        console.warn("[clips-toolbar] resize failed", err);
      });
  }, [actionsCollapsed]);

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

  const isPreparing = preparing || (!enabled && !popoverVisible);
  function togglePause() {
    if (!enabled || pendingAction) return;
    const transition = paused ? "resume" : "pause";
    clearPauseTransition();
    pauseTransitionRef.current = transition;
    setPaused(transition === "pause");
    pauseTransitionTimerRef.current = setTimeout(clearPauseTransition, 3_000);
    emit(`clips:recorder-${transition}`).catch((err) => {
      console.error(
        `[clips-toolbar] emit clips:recorder-${transition} failed:`,
        err,
      );
      clearPauseTransition();
      setPaused(paused);
    });
  }
  function activatePauseFromPointer(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    // The native toolbar resizes as the pointer enters it. Dispatch on
    // pointer-down so that resize/focus changes cannot cancel the subsequent
    // click, while the click handler below remains available to keyboards.
    e.preventDefault();
    togglePause();
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
  const pendingActionLabel =
    pendingAction === "restart"
      ? "Restarting..."
      : pendingAction === "cancel"
        ? "Cancelling..."
        : "Stopping...";

  return (
    <div
      className={`toolbar-v ${actionsCollapsed ? "toolbar-v-collapsed" : ""} ${paused ? "toolbar-v-paused" : ""} ${enabled ? "" : "toolbar-v-disabled"} ${diskSpaceLevel !== "ok" ? `toolbar-v-disk-${diskSpaceLevel}` : ""}`}
      onMouseDown={handleToolbarMouseDown}
    >
      {/* Primary controls live in a fixed-height zone so they stay pinned
          to the same vertical position whether or not the pill is hovered.
          Centering happens INSIDE this zone (not on the pill), so the
          collapsed→expanded `justify-content` change can't nudge the Stop
          button up — only the hover actions below grow into the new space. */}
      <div className="toolbar-v-primary">
        <div className="toolbar-v-handle" aria-hidden />
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
          {pendingAction === "stop" || isPreparing ? (
            <IconLoader2 className="toolbar-v-spinner" size={18} />
          ) : (
            <span className="toolbar-v-stop-square" />
          )}
        </button>
        <button
          type="button"
          className={`toolbar-v-time ${isPreparing ? "toolbar-v-time-preparing" : ""}`}
          onClick={() => invoke("show_popover").catch(() => {})}
          aria-label="Open Clips"
          title="Open Clips"
          data-no-drag
        >
          {isPreparing ? "Preparing…" : formatTime(elapsed)}
        </button>
        {recordingWarning && (
          <div
            className="toolbar-v-disk-indicator toolbar-v-disk-indicator-critical"
            title={recordingWarning}
            role="alert"
            aria-label={recordingWarning}
            data-no-drag
          >
            <IconAlertTriangle size={12} />
          </div>
        )}
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
          onPointerDown={activatePauseFromPointer}
          onClick={(e) => {
            if (e.detail === 0) togglePause();
          }}
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
        <button
          className={`toolbar-v-marker ${markerFlash ? "toolbar-v-marker-flash" : ""}`}
          onClick={() => {
            if (!enabled || pendingAction) return;
            emit("clips:marker", { kind: "generic" }).catch(() => {});
          }}
          disabled={!enabled || !!pendingAction}
          aria-label="Add timestamp marker"
          title={
            enabled
              ? "Add timestamp marker (⌥⇧M · note ⌥⇧E · b-roll ⌥⇧B · retake ⌥⇧N)"
              : "Recording not started yet"
          }
          data-no-drag
        >
          <IconBookmarkFilled size={14} />
          {markerCount > 0 && (
            <span className="toolbar-v-marker-count">{markerCount}</span>
          )}
        </button>
      </div>
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
      <button
        className="toolbar-v-caret"
        onClick={toggleActionsCollapsed}
        aria-label={
          actionsCollapsed ? "Show more actions" : "Hide extra actions"
        }
        title={actionsCollapsed ? "Show restart & discard" : "Hide"}
        data-no-drag
      >
        {actionsCollapsed ? (
          <IconChevronDown size={14} stroke={2.2} />
        ) : (
          <IconChevronUp size={14} stroke={2.2} />
        )}
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
