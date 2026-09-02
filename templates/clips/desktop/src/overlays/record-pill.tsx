import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconLink,
  IconLoader2,
  IconX,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { RecordingPlayhead } from "../../../shared/recording-playhead";
import type {
  RecordingPlayheadConfirmChange,
  RecordingPlayheadIntent,
} from "../../../shared/recording-playhead";
import {
  positionRecordingPlayheadAtEdge,
  RECORDING_PLAYHEAD_EDGE_THRESHOLD,
} from "../../../shared/recording-playhead-position";
import type {
  RecordingPlayheadDock,
  RecordingPlayheadDockLocation,
  RecordingPlayheadDockMode,
  RecordingPlayheadOrientation,
  RecordingPlayheadSize,
} from "../../../shared/recording-playhead-position";
import { LiveWaveform } from "../components/live-waveform";
import {
  completionCardState,
  isCompletionForSession,
  resolveCompletion,
} from "../lib/pill-completion";
import type {
  NativeUploadFinished,
  PillDoneStage as DoneStage,
} from "../lib/pill-completion";
import { toolbarEnabledEffect } from "../lib/pill-session";
import type { PillMode } from "../lib/pill-session";

// Within this distance of the right screen edge the pill anchors its RIGHT
// edge and grows left instead, so growth never runs off-screen.
const RIGHT_EDGE_ANCHOR_PX = 200;
const NATIVE_LAYOUT_GUARD_MS = 1_500;
const NATIVE_DOCK_SETTLE_MS = 32;
const FINALIZING_RESULT_STORAGE_KEY = "clips-finalizing-result";

const FALLBACK_HORIZONTAL_PLAYHEAD_SIZE: RecordingPlayheadSize = {
  width: 150,
  height: 42,
};
const FALLBACK_VERTICAL_PLAYHEAD_SIZE: RecordingPlayheadSize = {
  width: 42,
  height: 118,
};

type RecorderSession = {
  viewUrl?: string | null;
  recordingId?: string | null;
  localOnly?: boolean;
};

const hasTauri = "__TAURI_INTERNALS__" in window;
const demoMode = import.meta.env.DEV && !hasTauri;

function safeEmit(event: string, payload?: unknown): Promise<void> {
  if (!hasTauri) return Promise.resolve();
  return emit(event, payload);
}

function safeInvoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T | undefined> {
  if (!hasTauri) return Promise.resolve(undefined);
  return invoke<T>(cmd, args).then(
    (v) => v,
    (err) => {
      console.warn(`[record-pill] invoke ${cmd} failed:`, err);
      return undefined;
    },
  );
}

function safeListen<T>(
  event: string,
  cb: (payload: T) => void,
): Promise<() => void> {
  if (!hasTauri) return Promise.resolve(() => {});
  return listen<T>(event, (ev) => cb(ev.payload));
}

function formatTimer(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const totalMin = Math.floor(total / 60);
  // Past 99:59 the m:ss form overflows its slot; switch to a compact h:mm so
  // the anchored controls never shift for a marathon take.
  if (totalMin >= 100) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h}:${m.toString().padStart(2, "0")}h`;
  }
  const s = total % 60;
  return `${totalMin}:${s.toString().padStart(2, "0")}`;
}

function formatDurationCopy(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total} sec`;
  return `${Math.round(total / 60)} min`;
}

/**
 * The recording pill — one dark capsule with four modes: recording, paused,
 * confirm, done. The leading stop square is the recording indicator and the
 * stop/save action — red while live, grey-white while paused — with the
 * timer sharing its color, plain against the chrome. Every control is a bare
 * glyph; no rings or fills. Left edge anchored: hover extras
 * and the inline confirms grow rightward while the stop circle, timer, and
 * pause button hold position (near the right screen edge the anchor
 * mirrors). Stop swaps the
 * pill for the completion card in place; the link is copied only when the
 * user clicks Copy (an automatic copy would clear their clipboard
 * unannounced). While paused the pause circle swaps to a play glyph — the
 * amber dot carries the paused state; the button carries the way back.
 * Pure command emitter — the recorder in the popover window owns
 * capture, and drives us through the same IPC contract the old toolbar used:
 *
 *   receives → `clips:recorder-state` { paused, elapsedMs },
 *              `clips:toolbar-enabled`, `clips:toolbar-preparing`,
 *              `clips:recorder-session` { viewUrl, recordingId, localOnly },
 *              `clips:native-upload-progress` / `-finished`,
 *              `voice:audio-level` { level, source }
 *   emits    → `clips:recorder-stop`, `:pause`, `:resume`, `:restart`,
 *              `:cancel`, `clips:toolbar-ready`
 *
 * Stop must NOT close this window: it invokes `set_toolbar_finishing(true)`
 * BEFORE emitting stop so every teardown path skips the toolbar label, then
 * renders the completion card here until the user dismisses it.
 */
export function RecordingPill() {
  const [mode, setMode] = useState<PillMode>("recording");
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [enabled, setEnabled] = useState(demoMode);
  const [toolbarVisible, setToolbarVisible] = useState(true);
  /** Demo harness only: the meter reads capture events in the real app. */
  const [demoLevel, setDemoLevel] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [doneStage, setDoneStage] = useState<DoneStage>("finishing");
  const [doneDurationMs, setDoneDurationMs] = useState(0);
  const [copied, setCopied] = useState(false);
  const [savedLocally, setSavedLocally] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "restart" | "cancel" | null
  >(null);
  const [playheadOrientation, setPlayheadOrientation] =
    useState<RecordingPlayheadOrientation>("horizontal");
  const [playheadDock, setPlayheadDockState] =
    useState<RecordingPlayheadDock>("free");
  const [playheadDockTransitioning, setPlayheadDockTransitioning] =
    useState(false);

  const modeRef = useRef<PillMode>("recording");
  const elapsedRef = useRef(0);
  const sessionRef = useRef<RecorderSession>({});
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const viewUrlRef = useRef<string | null>(null);
  const reducedRef = useRef(
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const revealedRef = useRef(false);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animatingUntilRef = useRef(0);
  const toolbarDraggingRef = useRef(false);
  const toolbarDragGenerationRef = useRef(0);
  const toolbarMoveFrameRef = useRef<number | null>(null);
  const toolbarMovePromiseRef = useRef<Promise<void> | null>(null);
  const toolbarPendingMoveRef = useRef<{
    generation: number;
    startPromise: Promise<unknown>;
  } | null>(null);
  const toolbarDragStartPromiseRef = useRef<Promise<unknown>>(
    Promise.resolve(),
  );
  const playheadOrientationRef =
    useRef<RecordingPlayheadOrientation>("horizontal");
  const playheadDockTransitioningRef = useRef(false);
  const dockPreferenceReadyRef = useRef(false);
  const playheadDockRef = useRef<RecordingPlayheadDock>("free");
  const playheadSizesRef = useRef({
    horizontal: FALLBACK_HORIZONTAL_PLAYHEAD_SIZE,
    vertical: FALLBACK_VERTICAL_PLAYHEAD_SIZE,
  });
  const pendingNativeDockRef = useRef<{
    x: number;
    y: number;
    mode: RecordingPlayheadDockMode;
    location: RecordingPlayheadDockLocation | null;
  } | null>(null);
  const toolbarDismissedRef = useRef(false);
  const pauseTransitionRef = useRef<"pause" | "resume" | null>(null);
  const pauseTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const playheadConfirmOpenRef = useRef(false);

  const cardRef = useRef<HTMLDivElement | null>(null);

  modeRef.current = mode;
  elapsedRef.current = elapsed;
  viewUrlRef.current = viewUrl;

  function clearPauseTransition() {
    pauseTransitionRef.current = null;
    if (pauseTransitionTimerRef.current) {
      clearTimeout(pauseTransitionTimerRef.current);
      pauseTransitionTimerRef.current = null;
    }
  }

  function setPlayheadDock(
    orientation: RecordingPlayheadOrientation,
    dock: RecordingPlayheadDock,
  ) {
    playheadOrientationRef.current = orientation;
    playheadDockRef.current = dock;
    setPlayheadOrientation(orientation);
    setPlayheadDockState(dock);
  }

  // Native window ops run strictly one at a time. Concurrent
  // setSize/setPosition sequences read stale rects out from under each other
  // and strand the window clipped and offset (a half-cut pill with content
  // painting past the window edge). Every op re-reads geometry at execution
  // time inside the chain. Resize requests are also coalesced: a fast hover
  // reversal must not replay an obsolete intermediate frame after the newer
  // layout has already won.
  const windowOpChainRef = useRef<Promise<void>>(Promise.resolve());
  const resizeGenerationRef = useRef(0);
  function queueWindowOp(op: () => Promise<void>): Promise<void> {
    const queued = windowOpChainRef.current.then(op);
    windowOpChainRef.current = queued.catch((err) => {
      console.warn("[record-pill] window op failed", err);
    });
    return queued.catch(() => {});
  }

  /**
   * Resize the native window around the content, keeping the pill's anchor
   * edge fixed. The left edge is the anchor unless the pill sits within
   * RIGHT_EDGE_ANCHOR_PX of the screen's right edge — then the right edge
   * holds and growth extends left. Height keeps the bottom edge fixed so the
   * taller completion card rises from where the pill sat.
   */
  function resizeWindowTo(contentW: number, contentH: number): Promise<void> {
    if (!hasTauri) return Promise.resolve();
    const resizeGeneration = ++resizeGenerationRef.current;
    return queueWindowOp(async () => {
      if (resizeGeneration !== resizeGenerationRef.current) return;
      // Tauri emits `moved` for these programmatic anchor corrections too;
      // keep them out of the persisted user drag position.
      animatingUntilRef.current = Date.now() + NATIVE_LAYOUT_GUARD_MS;
      const win = getCurrentWindow();
      const [pos, size, scale, monitor] = await Promise.all([
        win.outerPosition(),
        win.outerSize(),
        win.scaleFactor(),
        currentMonitor(),
      ]);
      if (resizeGeneration !== resizeGenerationRef.current) return;
      const w = Math.ceil(contentW * scale);
      const h = Math.ceil(contentH * scale);
      let x = pos.x;
      let y = pos.y + size.height - h;
      const activeDock = playheadDockRef.current;
      const dockToPersist = pendingNativeDockRef.current;
      if (monitor) {
        const monRight = monitor.position.x + monitor.size.width;
        if (dockToPersist) {
          x = dockToPersist.x;
          y = dockToPersist.y;
        } else if (activeDock !== "free") {
          const docked = positionRecordingPlayheadAtEdge(
            activeDock,
            pos.x,
            pos.y,
            { width: w, height: h },
            {
              left: monitor.position.x,
              top: monitor.position.y,
              width: monitor.size.width,
              height: monitor.size.height,
            },
            Math.round(16 * scale),
          );
          x = docked.left;
          y = docked.top;
        } else {
          const nearRightEdge =
            pos.x + size.width >=
            monRight - Math.round(RIGHT_EDGE_ANCHOR_PX * scale);
          if (nearRightEdge) x = pos.x + size.width - w;
          // Never let growth push past the screen edge — macOS shoves the
          // window back and the correction fights the next resize.
          x = Math.min(x, monRight - w);
          x = Math.max(x, monitor.position.x);
          const monBottom = monitor.position.y + monitor.size.height;
          // The vertical pill's bottom anchor can land below the visible
          // desktop when it is pulled away from an edge and becomes horizontal.
          y = Math.min(y, monBottom - h);
          y = Math.max(y, monitor.position.y);
        }
      }
      // Position and size must land in one native frame transaction. Applying
      // them separately makes a right-docked confirmation collapse against
      // its old left edge before the small pill moves back to the right.
      await invoke("toolbar_set_bounds", { x, y, width: w, height: h });
      if (dockToPersist && pendingNativeDockRef.current === dockToPersist) {
        pendingNativeDockRef.current = null;
        await safeInvoke("toolbar_save_position", {
          x,
          y,
          mode: dockToPersist.mode,
          location: dockToPersist.location,
        });
      }
    });
  }

  function afterPaint(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  async function transitionPlayheadDock(
    orientation: RecordingPlayheadOrientation,
    dock: RecordingPlayheadDock,
    positionToPersist: {
      x: number;
      y: number;
      mode: RecordingPlayheadDockMode;
      location: RecordingPlayheadDockLocation | null;
    } | null,
  ) {
    playheadDockTransitioningRef.current = true;
    setPlayheadDockTransitioning(true);
    await afterPaint();

    pendingNativeDockRef.current = positionToPersist;
    setPlayheadDock(orientation, dock);
    await afterPaint();

    const fallback =
      orientation === "vertical"
        ? FALLBACK_VERTICAL_PLAYHEAD_SIZE
        : FALLBACK_HORIZONTAL_PLAYHEAD_SIZE;
    const measured = playheadSizesRef.current[orientation];
    await resizeWindowTo(
      measured.width || fallback.width,
      measured.height || fallback.height,
    );
    await afterPaint();
    playheadDockTransitioningRef.current = false;
    setPlayheadDockTransitioning(false);
  }

  async function settleNativePlayheadDock() {
    if (!hasTauri || modeRef.current === "done") return;
    const win = getCurrentWindow();
    const [monitor, position, size, scale] = await Promise.all([
      currentMonitor(),
      win.outerPosition(),
      win.outerSize(),
      win.scaleFactor(),
    ]);
    if (!monitor) return;
    if (!dockPreferenceReadyRef.current) return;

    const gutter = Math.round(16 * scale);
    const edgeThreshold = Math.round(RECORDING_PLAYHEAD_EDGE_THRESHOLD * scale);
    const viewport = {
      left: monitor.position.x,
      top: monitor.position.y,
      width: monitor.size.width,
      height: monitor.size.height,
    };
    const monitorRight = viewport.left + viewport.width;
    const monitorBottom = viewport.top + viewport.height;
    const sizes = {
      horizontal: {
        width: Math.ceil(playheadSizesRef.current.horizontal.width * scale),
        height: Math.ceil(playheadSizesRef.current.horizontal.height * scale),
      },
      vertical: {
        width: Math.ceil(playheadSizesRef.current.vertical.width * scale),
        height: Math.ceil(playheadSizesRef.current.vertical.height * scale),
      },
    };
    const nearLeft = position.x <= viewport.left + gutter + edgeThreshold;
    const nearRight =
      position.x + size.width >= monitorRight - gutter - edgeThreshold;
    const nearTop = position.y <= viewport.top + gutter + edgeThreshold;
    const nearBottom =
      position.y + size.height >= monitorBottom - gutter - edgeThreshold;

    // Docking is a post-drag decision. While the renderer-owned drag is active,
    // the webview must not resize itself or fight the cursor-follow loop.
    // Pulling a pill clear of every edge is the escape hatch back to a normal
    // horizontal floating playhead.
    const dock: RecordingPlayheadDockLocation | null = nearLeft
      ? "left"
      : nearRight
        ? "right"
        : nearTop
          ? "top"
          : nearBottom
            ? "bottom"
            : null;
    if (!dock) {
      const horizontalWidth = sizes.horizontal.width;
      const horizontalHeight = sizes.horizontal.height;
      // Preserve the point the user was holding through the axis change. A
      // bottom-edge anchor makes a vertical pill leap when it becomes wide.
      const nextX = Math.max(
        monitor.position.x + gutter,
        Math.min(
          position.x + size.width / 2 - horizontalWidth / 2,
          monitorRight - horizontalWidth - gutter,
        ),
      );
      const nextY = Math.max(
        monitor.position.y + gutter,
        Math.min(
          position.y + size.height / 2 - horizontalHeight / 2,
          monitorBottom - horizontalHeight - gutter,
        ),
      );
      const needsFloatingLayout =
        playheadDockRef.current !== "free" ||
        playheadOrientationRef.current !== "horizontal" ||
        Math.abs(position.x - nextX) > 1 ||
        Math.abs(position.y - nextY) > 1 ||
        size.width !== horizontalWidth ||
        size.height !== horizontalHeight;
      if (needsFloatingLayout) {
        await transitionPlayheadDock("horizontal", "free", {
          x: nextX,
          y: nextY,
          mode: "floating",
          location: null,
        });
      } else {
        await safeInvoke("toolbar_save_position", {
          x: nextX,
          y: nextY,
          mode: "floating",
          location: null,
        });
      }
      return;
    }

    const verticalDock = dock === "left" || dock === "right";
    const nextSize = verticalDock ? sizes.vertical : sizes.horizontal;
    const target = positionRecordingPlayheadAtEdge(
      dock,
      position.x + size.width / 2 - nextSize.width / 2,
      position.y + size.height / 2 - nextSize.height / 2,
      nextSize,
      viewport,
      gutter,
    );
    const alreadySettled =
      playheadDockRef.current === dock &&
      playheadOrientationRef.current ===
        (verticalDock ? "vertical" : "horizontal");
    if (
      alreadySettled &&
      Math.abs(position.x - target.left) <= 1 &&
      Math.abs(position.y - target.top) <= 1
    ) {
      void safeInvoke("toolbar_save_position", {
        x: target.left,
        y: target.top,
        mode: "docked",
        location: dock,
      });
      return;
    }
    await transitionPlayheadDock(
      verticalDock ? "vertical" : "horizontal",
      dock,
      {
        x: target.left,
        y: target.top,
        mode: "docked",
        location: dock,
      },
    );
  }

  function applyToolbarDockPreference(
    mode: RecordingPlayheadDockMode,
    location: RecordingPlayheadDockLocation,
  ) {
    if (!hasTauri) return;
    dockPreferenceReadyRef.current = true;
    pendingNativeDockRef.current = null;
    if (mode === "floating") {
      void transitionPlayheadDock("horizontal", "free", null);
      return;
    }
    const verticalDock = location === "left" || location === "right";
    void transitionPlayheadDock(
      verticalDock ? "vertical" : "horizontal",
      location,
      null,
    );
  }

  function syncWindowToContent() {
    const el = cardRef.current;
    if (!el) return;
    // offsetWidth/Height are layout metrics, immune to the card's scale-in
    // entrance — a rect measured mid-animation locks the window too narrow.
    resizeWindowTo(el.offsetWidth, el.offsetHeight);
  }

  /** Return the outer overlay to its idle state when a session ends. */
  function resetToRest() {
    revealedRef.current = false;
    setMode("recording");
    clearPauseTransition();
    setPaused(false);
  }

  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const enabledRef = useRef(false);
  enabledRef.current = enabled;
  const elapsedAnchorRef = useRef<{ elapsedMs: number; at: number } | null>(
    null,
  );

  // The recorder reports state every 500ms; rendering only those ticks makes
  // the clock feel like it starts late and counts in lurches. Interpolate
  // from the last report at 250ms so the timer runs the moment capture is
  // live and re-anchors on every real tick.
  useEffect(() => {
    if (!enabled || paused || mode === "done") return;
    const t = setInterval(() => {
      const anchor = elapsedAnchorRef.current;
      if (!anchor) return;
      setElapsed(anchor.elapsedMs + (performance.now() - anchor.at));
    }, 250);
    return () => clearInterval(t);
  }, [enabled, paused, mode]);

  function applyPauseIntent(transition: "pause" | "resume") {
    clearPauseTransition();
    pauseTransitionRef.current = transition;
    setPaused(transition === "pause");
    pauseTransitionTimerRef.current = setTimeout(clearPauseTransition, 3_000);
    void safeEmit(`clips:recorder-${transition}`).catch(() => {
      clearPauseTransition();
    });
  }

  function togglePause() {
    if (!enabled || modeRef.current !== "recording") return;
    const transition = pausedRef.current ? "resume" : "pause";
    applyPauseIntent(transition);
    setAnnouncement(transition === "pause" ? "Paused" : "Recording");
  }

  // Copying is always the user's click — an automatic copy would clear their
  // clipboard without them knowing.
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  async function copyLink(url: string) {
    try {
      if (hasTauri) await writeText(url);
      else await navigator.clipboard.writeText(url);
      setCopied(true);
      setAnnouncement("Link copied");
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1_600);
    } catch (err) {
      console.error("[record-pill] clipboard write failed:", err);
    }
  }

  function stop() {
    // Guarded through the ref: the tray-stop listener holds a first-render
    // closure of this function, where the `enabled` state is still false.
    if (
      !enabledRef.current ||
      modeRef.current === "done" ||
      playheadConfirmOpenRef.current
    )
      return;
    setDoneDurationMs(elapsedRef.current);
    // Every stop — hosted or local-only — starts as "finishing" and is only
    // called done by the completion event the stop actually produces. A
    // local-only export that fails must not have already claimed it saved.
    setDoneStage("finishing");
    // Anchor the card on THIS take. The window is reused across restarts, so
    // anything a previous session's late completion left behind has to go.
    setViewUrl(sessionRef.current.viewUrl ?? null);
    setSavedLocally(false);
    setCopied(false);
    // Hold the window open BEFORE the stop event so the recorder's teardown
    // can't close us out from under the card.
    void safeInvoke("set_toolbar_finishing", { hold: true }).then(() => {
      void safeEmit("clips:recorder-stop");
    });
    // Pre-grow the window for the card so its entrance never renders clipped;
    // the done-mode effect refits to the exact card rect one frame later.
    resizeWindowTo(340, 180);
    setMode("done");
    if (demoMode) {
      setTimeout(() => {
        handleUploadFinished({
          ok: true,
          viewUrl: "https://clips.agent-native.com/r/demo",
        });
      }, 2_000);
    }
  }

  function scheduleCloseFallback(action: string) {
    fallbackTimerRef.current = setTimeout(() => {
      console.warn(
        `[record-pill] recorder did not close the pill within 3s after ${action} — self-closing`,
      );
      if (hasTauri)
        getCurrentWindow()
          .close()
          .catch(() => {});
    }, 3_000);
  }

  function confirmDestructive(intent: RecordingPlayheadIntent) {
    if (pendingAction) return;
    playheadConfirmOpenRef.current = false;
    resetToRest();
    if (intent === "restart") {
      setPendingAction("restart");
      setElapsed(0);
      // Hide immediately — the restart teardown follows. The replacement
      // session's `clips:toolbar-preparing` re-shows the disabled pill for its
      // countdown, reusing this window when the finishing hold keeps it alive.
      toolbarDismissedRef.current = true;
      setToolbarVisible(false);
      setEnabled(false);
      void safeInvoke("set_toolbar_finishing", { hold: true }).then(() => {
        void safeEmit("clips:recorder-restart");
      });
      fallbackTimerRef.current = setTimeout(() => {
        console.warn(
          "[record-pill] recorder did not restart within 15s — self-closing",
        );
        void safeInvoke("set_toolbar_finishing", { hold: false });
        if (hasTauri)
          getCurrentWindow()
            .close()
            .catch(() => {});
      }, 15_000);
      return;
    }
    setPendingAction("cancel");
    // Vanish now — feedback must not wait on the recorder's teardown. The
    // window close (or its 3s fallback) follows behind.
    toolbarDismissedRef.current = true;
    setToolbarVisible(false);
    setEnabled(false);
    void safeEmit("clips:recorder-cancel").then(() =>
      scheduleCloseFallback("cancel"),
    );
  }

  function dismissCard() {
    void safeInvoke("set_toolbar_finishing", { hold: false }).then(() => {
      if (hasTauri)
        getCurrentWindow()
          .close()
          .catch(() => {});
      else resetToRest();
    });
  }

  async function openRecording(url: string) {
    try {
      if (hasTauri) {
        await openExternal(url);
      } else if (!window.open(url, "_blank")) {
        return;
      }
      dismissCard();
    } catch (err) {
      console.warn("[record-pill] opening recording failed:", err);
    }
  }

  function handleUploadFinished(payload: NativeUploadFinished) {
    // A completion only means something to a card that is on screen. While
    // the pill is recording there is no card, and anything applied here would
    // sit in state waiting to surface on the NEXT take's card — which is how
    // a discarded take's URL reached its replacement. Nothing is lost by
    // dropping these: the done-mode effect drains both the stored result and
    // the localStorage hand-off when a card does open.
    if (modeRef.current !== "done") return;
    const completion = resolveCompletion(
      sessionRef.current.recordingId,
      payload,
    );
    if (!completion) return;
    if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
    setSavedLocally(completion.savedLocally);
    // The session already published this clip's link so Stop could offer Copy
    // immediately; a payload without one must not take it away.
    if (completion.viewUrl) setViewUrl(completion.viewUrl);
    setDoneStage(completion.stage);
  }

  // ---- listeners ----

  useEffect(() => {
    const unlistens: Array<() => void> = [];
    const registrations: Array<Promise<() => void>> = [];
    let stopped = false;
    const track = (p: Promise<() => void>) => {
      registrations.push(
        p.then((u) => {
          if (stopped) u();
          else unlistens.push(u);
          return u;
        }),
      );
    };
    track(
      safeListen<{ paused: boolean; elapsedMs: number }>(
        "clips:recorder-state",
        (payload) => {
          const nextPaused = !!payload.paused;
          const pending = pauseTransitionRef.current;
          const reached =
            (pending === "pause" && nextPaused) ||
            (pending === "resume" && !nextPaused);
          if (!pending || reached) setPaused(nextPaused);
          if (reached) clearPauseTransition();
          elapsedAnchorRef.current = {
            elapsedMs: payload.elapsedMs ?? 0,
            at: performance.now(),
          };
          setElapsed(payload.elapsedMs ?? 0);
        },
      ),
    );
    track(
      safeListen("clips:toolbar-preparing", () => {
        if (modeRef.current === "done") {
          if (stallTimerRef.current) {
            clearTimeout(stallTimerRef.current);
            stallTimerRef.current = null;
          }
          setViewUrl(null);
          setCopied(false);
          setSavedLocally(false);
          setDoneStage("finishing");
          sessionRef.current = {};
        }
        setElapsed(0);
        elapsedAnchorRef.current = null;
        setPendingAction(null);
        resetToRest();
        toolbarDismissedRef.current = false;
        setToolbarVisible(true);
      }),
    );
    track(
      safeListen("clips:toolbar-hidden", () => {
        toolbarDismissedRef.current = true;
        setToolbarVisible(false);
      }),
    );
    track(
      safeListen<boolean>("clips:toolbar-enabled", (payload) => {
        setEnabled(!!payload);
        setPendingAction(null);
        if (payload && !toolbarDismissedRef.current) {
          setToolbarVisible(true);
        }
        if (fallbackTimerRef.current) {
          clearTimeout(fallbackTimerRef.current);
          fallbackTimerRef.current = null;
        }
        if (payload && !elapsedAnchorRef.current) {
          elapsedAnchorRef.current = { elapsedMs: 0, at: performance.now() };
        }
        // A live session owns the pill now: release any restart hold.
        if (payload) void safeInvoke("set_toolbar_finishing", { hold: false });
        switch (toolbarEnabledEffect(!!payload, modeRef.current)) {
          case "adopt-new-session":
            setViewUrl(null);
            setCopied(false);
            setSavedLocally(false);
            setDoneStage("finishing");
            sessionRef.current = {};
            resetToRest();
            break;
          case "reset-to-rest":
            setElapsed(0);
            elapsedAnchorRef.current = null;
            resetToRest();
            break;
          case "keep":
            break;
        }
      }),
    );
    track(
      safeListen("clips:toolbar-sync", () => {
        void safeEmit("clips:toolbar-ready", {});
      }),
    );
    track(
      safeListen<RecorderSession>("clips:recorder-session", (payload) => {
        sessionRef.current = payload ?? {};
        if (payload?.viewUrl) setViewUrl(payload.viewUrl);
      }),
    );
    track(
      safeListen<{
        recordingId?: string;
        stage?: string;
        progress?: number | null;
      }>("clips:native-upload-progress", (payload) => {
        if (modeRef.current !== "done") return;
        // A local-only take never uploads, so any native upload progress
        // reaching this card belongs to some other recording.
        if (sessionRef.current.localOnly) return;
        if (!isCompletionForSession(sessionRef.current.recordingId, payload)) {
          return;
        }
        if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
        stallTimerRef.current = setTimeout(() => {
          setDoneStage((s) => (s === "uploaded" ? s : "failed"));
        }, 120_000);
        if (payload?.stage && payload.stage !== "opening") {
          setDoneStage((s) =>
            s === "uploaded" || s === "failed" ? s : "uploading",
          );
        }
      }),
    );
    track(
      safeListen<NativeUploadFinished>(
        "clips:native-upload-finished",
        (payload) => handleUploadFinished(payload ?? {}),
      ),
    );
    track(
      // The menu-bar status item doubles as a Stop button while recording;
      // route its click through the same stop flow so the finishing hold and
      // completion card run. Before capture is live there is nothing to stop,
      // so the click falls back to opening Clips.
      safeListen("clips:tray-stop-request", () => {
        if (enabledRef.current && modeRef.current !== "done") stop();
        else void safeInvoke("show_popover");
      }),
    );
    // The handshake goes out only once our own listeners exist. The recorder
    // answers `toolbar-ready` immediately, and `listen()` is asynchronous, so
    // emitting first can drop the reply — costing the pill its enable and its
    // session identity until some later event happens to arrive.
    //
    // The audio-level listener that used to sit here is gone: the meter is the
    // shared `LiveWaveform`, which subscribes to capture itself.
    void Promise.allSettled(registrations).then((results) => {
      const failures = results.flatMap((r) =>
        r.status === "rejected" ? [r.reason] : [],
      );
      if (failures.length > 0) {
        console.error("[record-pill] listener registration failed:", failures);
      }
      if (stopped) return;
      void safeEmit("clips:toolbar-ready", {});
    });
    return () => {
      stopped = true;
      unlistens.forEach((u) => {
        try {
          u();
        } catch {
          // coercion-ok: unlisten during window teardown has no failure mode to surface
        }
      });
      for (const t of [
        fallbackTimerRef,
        stallTimerRef,
        pauseTransitionTimerRef,
      ]) {
        if (t.current) clearTimeout(t.current);
      }
    };
  }, []);

  // Fit the native window to the measured pill once fonts have settled.
  useEffect(() => {
    let cancelled = false;
    const fit = () => {
      if (cancelled) return;
      syncWindowToContent();
    };
    if (document.fonts?.ready) {
      void document.fonts.ready.then(fit);
    } else {
      fit();
    }
    if (hasTauri) {
      void safeInvoke<{
        mode?: RecordingPlayheadDockMode;
        location?: RecordingPlayheadDockLocation;
      }>("toolbar_get_dock_preference").then((preference) => {
        const mode =
          preference?.mode === "docked" ? "docked" : ("floating" as const);
        const location =
          preference?.location === "right" ||
          preference?.location === "top" ||
          preference?.location === "bottom"
            ? preference.location
            : "left";
        applyToolbarDockPreference(mode, location);
      });
    } else {
      dockPreferenceReadyRef.current = true;
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // Done mode: card replaces the pill in place — refit the window to the
  // card and drain any completion result the events may have raced past.
  useEffect(() => {
    if (mode !== "done") return;
    requestAnimationFrame(() => syncWindowToContent());
    stallTimerRef.current = setTimeout(() => {
      setDoneStage((s) =>
        s === "uploaded" ? s : s === "failed" ? s : "failed",
      );
    }, 120_000);
    try {
      const raw = window.localStorage.getItem(FINALIZING_RESULT_STORAGE_KEY);
      if (raw) {
        window.localStorage.removeItem(FINALIZING_RESULT_STORAGE_KEY);
        const parsed = JSON.parse(raw) as NativeUploadFinished;
        if (parsed && typeof parsed === "object") handleUploadFinished(parsed);
      }
    } catch {
      // coercion-ok: storage is a best-effort race fallback; the event path is authoritative
    }
    void safeInvoke<NativeUploadFinished | null>(
      "native_fullscreen_take_upload_finished",
    ).then((payload) => {
      if (payload) handleUploadFinished(payload);
    });
  }, [mode]);

  // Demo drive for browser previews (no Tauri): tick the timer and meter.
  useEffect(() => {
    if (!demoMode) return;
    const t = setInterval(() => {
      if (modeRef.current !== "done" && !pausedRef.current) {
        setElapsed((e) => e + 500);
      }
    }, 500);
    const levels = setInterval(() => {
      if (modeRef.current !== "done" && !pausedRef.current) {
        setDemoLevel(0.05 + Math.random() * 0.3);
      }
    }, 90);
    return () => {
      clearInterval(t);
      clearInterval(levels);
    };
  }, []);

  // Self-healing size net: whatever strands the window at the wrong size —
  // a resize racing a transition, a throttled animation clock finishing
  // late, a font swap — the pill's layout size is the truth, so any drift
  // outside a choreographed transition re-syncs the window to it.
  useEffect(() => {
    if (!hasTauri) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (Date.now() < animatingUntilRef.current) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => syncWindowToContent(), 120);
    });
    const el = mode === "done" ? cardRef.current : null;
    if (el) observer.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    };
  }, [mode]);

  // The pill owns its window's visibility: shown in its disabled state while
  // preparing/counting down, enabled once capture is live, and kept up while
  // the completion card is open. Rust never shows this window itself.
  const visibleRef = useRef(false);
  useEffect(() => {
    if (!hasTauri) return;
    const visible = toolbarVisible;
    if (visibleRef.current === visible) return;
    visibleRef.current = visible;
    if (visible) syncWindowToContent();
    queueWindowOp(async () => {
      await invoke("toolbar_set_visible", { visible });
    });
  }, [toolbarVisible]);

  // The pill is also the single writer of the menu bar's recording mode:
  // stop square + ticking timer exactly while capture is live, the app logo
  // otherwise. Rust infers nothing; a window-destroyed backstop covers the
  // one report this effect can never send.
  const trayLive = enabled && mode !== "done";
  // One ordered writer. These calls used to be two independent fire-and-forget
  // invokes, so a timer update issued just before a stop could land after the
  // stop's inactive write and put the stop square back for a session that had
  // already ended, until the dead-man cleared it seconds later.
  const trayOpChainRef = useRef<Promise<unknown>>(Promise.resolve());
  function writeTrayStatus(active: boolean, title: string | null) {
    trayOpChainRef.current = trayOpChainRef.current.then(() =>
      safeInvoke("tray_recording_status", { active, title }),
    );
  }
  function liveTrayTitle() {
    return `${pausedRef.current ? "⏸ " : ""}${formatTimer(elapsedRef.current)}`;
  }
  useEffect(() => {
    if (!hasTauri) return;
    writeTrayStatus(trayLive, trayLive ? liveTrayTitle() : null);
  }, [trayLive, elapsed, paused]);
  // The tray's dead-man clears the status item after 2.5s without a write.
  // While paused, `elapsed` stops advancing and `paused` stops changing, so
  // the effect above stops firing and the menu bar would drop a recording
  // that is still very much live. This heartbeat is what keeps it.
  useEffect(() => {
    if (!hasTauri || !trayLive) return;
    const beat = setInterval(() => writeTrayStatus(true, liveTrayTitle()), 800);
    return () => clearInterval(beat);
  }, [trayLive]);

  // ---- interactions ----

  function queueToolbarDragMove(
    generation: number,
    startPromise: Promise<unknown>,
  ): Promise<void> {
    toolbarPendingMoveRef.current = { generation, startPromise };
    if (toolbarMovePromiseRef.current) return toolbarMovePromiseRef.current;

    const movePromise = (async () => {
      while (toolbarPendingMoveRef.current) {
        const pendingMove = toolbarPendingMoveRef.current;
        toolbarPendingMoveRef.current = null;
        await pendingMove.startPromise;
        if (
          !toolbarDraggingRef.current ||
          toolbarDragGenerationRef.current !== pendingMove.generation
        ) {
          continue;
        }
        await safeInvoke("toolbar_drag_move");
      }
    })();
    toolbarMovePromiseRef.current = movePromise;
    void movePromise.then(() => {
      if (toolbarMovePromiseRef.current !== movePromise) return;
      toolbarMovePromiseRef.current = null;
      const pendingMove = toolbarPendingMoveRef.current;
      if (pendingMove) {
        void queueToolbarDragMove(
          pendingMove.generation,
          pendingMove.startPromise,
        );
      }
    });
    return movePromise;
  }

  async function waitForToolbarDragMoves(generation: number): Promise<void> {
    while (toolbarDragGenerationRef.current === generation) {
      const movePromise = toolbarMovePromiseRef.current;
      if (!movePromise) return;
      await movePromise;
    }
  }

  function handlePillPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!hasTauri || event.pointerType !== "mouse" || event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest("[data-recording-playhead-button]")) return;
    event.preventDefault();
    event.stopPropagation();
    toolbarDraggingRef.current = true;
    ++toolbarDragGenerationRef.current;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // coercion-ok: pointer capture is optional; native dragging remains authoritative
      // Pointer capture is best-effort; the native window can still finish a
      // short drag before the pointer leaves the overlay.
    }
    toolbarDragStartPromiseRef.current = safeInvoke("toolbar_drag_start");
  }

  function handlePillPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      !toolbarDraggingRef.current ||
      event.pointerType !== "mouse" ||
      toolbarMoveFrameRef.current !== null
    ) {
      return;
    }
    event.preventDefault();
    const generation = toolbarDragGenerationRef.current;
    const startPromise = toolbarDragStartPromiseRef.current;
    toolbarMoveFrameRef.current = requestAnimationFrame(() => {
      toolbarMoveFrameRef.current = null;
      if (
        !toolbarDraggingRef.current ||
        toolbarDragGenerationRef.current !== generation
      ) {
        return;
      }
      // Rust reads the live cursor, so keep one move in flight and retain only
      // the newest pending frame instead of replaying stale cursor samples.
      void queueToolbarDragMove(generation, startPromise);
    });
  }

  function handlePillPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (!toolbarDraggingRef.current || event.pointerType !== "mouse") return;
    toolbarDraggingRef.current = false;
    const generation = toolbarDragGenerationRef.current;
    const startPromise = toolbarDragStartPromiseRef.current;
    if (toolbarMoveFrameRef.current !== null) {
      cancelAnimationFrame(toolbarMoveFrameRef.current);
      toolbarMoveFrameRef.current = null;
    }
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // coercion-ok: the platform may release capture before this best-effort cleanup
      // The pointer may already have been released by the platform.
    }
    void (async () => {
      await startPromise;
      await waitForToolbarDragMoves(generation);
      if (toolbarDragGenerationRef.current !== generation) return;
      await safeInvoke("toolbar_drag_move");
      if (toolbarDragGenerationRef.current !== generation) return;
      await safeInvoke("toolbar_drag_end");
      if (toolbarDragGenerationRef.current !== generation) return;
      await new Promise<void>((resolve) =>
        setTimeout(resolve, NATIVE_DOCK_SETTLE_MS),
      );
      if (toolbarDragGenerationRef.current !== generation) return;
      void settleNativePlayheadDock();
    })();
  }

  const card = completionCardState(doneStage, {
    hasLink: Boolean(viewUrl),
    savedLocally,
  });
  const cardBadgeClass =
    card.tone === "ok"
      ? "bg-[var(--pill-card-badge-bg)] text-[var(--pill-card-badge)]"
      : card.tone === "warn"
        ? "bg-[var(--pill-card-badge-warn-bg)] text-[var(--pill-card-badge-warn)]"
        : "bg-[var(--pill-card-well)] text-[var(--pill-card-ink-2)]";
  // Announce what the card actually says, when it says it. Stop announced
  // "Recording saved" the moment it was clicked, before the export or upload
  // had returned anything to say that about.
  const cardTitle = mode === "done" ? card.title : null;
  useEffect(() => {
    if (cardTitle) setAnnouncement(cardTitle);
  }, [cardTitle]);

  return (
    <div
      data-tw-surface
      className={`record-pill-scope flex h-screen w-screen select-none ${mode === "done" || (playheadOrientation === "horizontal" && playheadDock !== "top") ? "items-end" : "items-start"}`}
    >
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {mode === "done" ? (
        <div
          ref={cardRef}
          className={`w-[340px] flex-none rounded-[14px] border-[0.5px] border-[var(--pill-card-border)] bg-[var(--pill-card-surface)] p-4 ${reducedRef.current ? "" : "record-pill-card-in"}`}
        >
          <div className="mb-3 flex items-center gap-2.5">
            <span
              className={`flex size-8 flex-none items-center justify-center rounded-full ${cardBadgeClass}`}
            >
              {card.tone === "ok" ? (
                <IconCheck size={16} stroke={2.4} aria-hidden />
              ) : card.tone === "warn" ? (
                <IconAlertTriangle size={16} stroke={2.2} aria-hidden />
              ) : (
                <IconLoader2
                  size={16}
                  stroke={2.2}
                  aria-hidden
                  className={reducedRef.current ? "" : "animate-spin"}
                />
              )}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--pill-card-ink)]">
                {card.title}
              </div>
              <div className="text-xs text-[var(--pill-card-ink-2)]">
                {formatDurationCopy(doneDurationMs)}
                {card.detail ? ` · ${card.detail}` : ""}
              </div>
            </div>
            <button
              type="button"
              onClick={dismissCard}
              aria-label="Dismiss"
              className="ml-auto flex size-6 flex-none items-center justify-center rounded text-[var(--pill-card-ink-3)] hover:text-[var(--pill-card-ink)]"
            >
              <IconX size={15} aria-hidden />
            </button>
          </div>
          {viewUrl ? (
            <div className="mb-3 flex items-center gap-2 rounded-lg bg-[var(--pill-card-well)] px-2.5 py-2 text-xs">
              <IconLink
                size={14}
                className="flex-none text-[var(--pill-card-ink-2)]"
                aria-hidden
              />
              <span className="record-pill-mono min-w-0 flex-1 truncate text-[var(--pill-card-ink-2)]">
                {viewUrl.replace(/^https?:\/\//, "")}
              </span>
              <button
                type="button"
                onClick={() => void copyLink(viewUrl)}
                aria-label="Copy link"
                className={`flex size-5 flex-none items-center justify-center rounded ${copied ? "text-[var(--pill-card-badge)]" : "text-[var(--pill-card-ink-2)] hover:text-[var(--pill-card-ink)]"}`}
              >
                {copied ? (
                  <IconCheck size={14} aria-hidden />
                ) : (
                  <IconCopy size={14} aria-hidden />
                )}
              </button>
            </div>
          ) : null}
          <div className="flex gap-2">
            {viewUrl ? (
              <>
                <button
                  type="button"
                  onClick={() => void openRecording(viewUrl)}
                  className="h-[34px] flex-1 rounded-lg bg-[var(--pill-card-ink)] text-[13px] font-semibold text-[var(--pill-on-chrome)]"
                >
                  Open
                </button>
                <button
                  type="button"
                  onClick={() => void copyLink(viewUrl)}
                  className="h-[34px] flex-1 rounded-lg border border-[var(--pill-card-border-strong)] bg-[var(--pill-on-chrome)] text-[13px] font-semibold text-[var(--pill-card-ink)]"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <RecordingPlayhead
          elapsedMs={elapsed}
          paused={paused}
          enabled={enabled}
          pendingAction={pendingAction}
          meter={
            <LiveWaveform
              sources="mic"
              dimmed={paused || !enabled}
              level={demoMode ? demoLevel : null}
            />
          }
          labels={{
            controls: "Recording controls",
            stop: "Stop and save",
            pause: "Pause",
            resume: "Resume",
            pauseShortcut: "Pause (⌥⇧P)",
            resumeShortcut: "Resume (⌥⇧P)",
            restart: "Restart recording",
            restartShortcut: "Restart (⌥⇧R)",
            delete: "Delete recording",
            deleteShortcut: "Delete (⌥⇧C)",
            restartQuestion: "Start a new recording?",
            deleteQuestion: (durationMs) =>
              `Delete ${formatDurationCopy(durationMs)}?`,
            restartConfirm: "Restart",
            deleteConfirm: "Delete",
            resumeConfirm: "Resume",
          }}
          onStop={stop}
          onTogglePause={togglePause}
          onConfirmAction={confirmDestructive}
          onConfirmChange={(change: RecordingPlayheadConfirmChange) => {
            if (change.type === "open") {
              playheadConfirmOpenRef.current = true;
              if (!change.enteredPaused) applyPauseIntent("pause");
              setAnnouncement("Paused");
              return;
            }
            playheadConfirmOpenRef.current = false;
            if (change.resume || !change.enteredPaused) {
              applyPauseIntent("resume");
            }
            setAnnouncement(change.resume ? "Recording" : "Paused");
          }}
          onExpandedChange={(expanded) => {
            revealedRef.current = expanded;
          }}
          onLayoutChange={(layout) => {
            const nextLayout = {
              width: Math.ceil(layout.width),
              height: Math.ceil(layout.height),
            };
            playheadSizesRef.current[playheadOrientationRef.current] =
              nextLayout;
            if (!playheadDockTransitioningRef.current) {
              void resizeWindowTo(nextLayout.width, nextLayout.height);
            }
          }}
          orientation={playheadOrientation}
          onPointerDown={handlePillPointerDown}
          onPointerMove={handlePillPointerMove}
          onPointerUp={handlePillPointerEnd}
          onPointerCancel={handlePillPointerEnd}
          className={`${enabled ? "" : "opacity-80"} ${playheadDockTransitioning ? "opacity-0" : "transition-opacity duration-100"}`}
        />
      )}
    </div>
  );
}
