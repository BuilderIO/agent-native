import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconLink,
  IconLoader2,
  IconX,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { emit, listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useEffect, useRef, useState } from "react";

import { RecordingPlayhead } from "../../../shared/recording-playhead";
import type {
  RecordingPlayheadConfirmChange,
  RecordingPlayheadIntent,
} from "../../../shared/recording-playhead";
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
const USER_DRAG_ARM_TIMEOUT_MS = 1_000;
const FINALIZING_RESULT_STORAGE_KEY = "clips-finalizing-result";

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
  const userDragActiveRef = useRef(false);
  const userDragArmedRef = useRef(false);
  const userDragGenerationRef = useRef(0);
  const userDragChangeRef = useRef(0);
  const userDragMarkerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
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

  // Native window ops run strictly one at a time. Concurrent
  // setSize/setPosition sequences read stale rects out from under each other
  // and strand the window clipped and offset (a half-cut pill with content
  // painting past the window edge). Every op re-reads geometry at execution
  // time inside the chain.
  const windowOpChainRef = useRef<Promise<void>>(Promise.resolve());
  function queueWindowOp(op: () => Promise<void>) {
    windowOpChainRef.current = windowOpChainRef.current
      .then(op)
      .catch((err) => {
        console.warn("[record-pill] window op failed", err);
      });
  }

  /**
   * Resize the native window around the content, keeping the pill's anchor
   * edge fixed. The left edge is the anchor unless the pill sits within
   * RIGHT_EDGE_ANCHOR_PX of the screen's right edge — then the right edge
   * holds and growth extends left. Height keeps the bottom edge fixed so the
   * taller completion card rises from where the pill sat.
   */
  function resizeWindowTo(contentW: number, contentH: number) {
    if (!hasTauri) return;
    queueWindowOp(async () => {
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
      const w = Math.ceil(contentW * scale);
      const h = Math.ceil(contentH * scale);
      let x = pos.x;
      if (monitor) {
        const monRight = monitor.position.x + monitor.size.width;
        const nearRightEdge =
          pos.x + size.width >=
          monRight - Math.round(RIGHT_EDGE_ANCHOR_PX * scale);
        if (nearRightEdge) x = pos.x + size.width - w;
        // Never let growth push past the screen edge — macOS shoves the
        // window back and the correction fights the next resize.
        x = Math.min(x, monRight - w);
        x = Math.max(x, monitor.position.x);
      }
      const y = pos.y + size.height - h;
      // Order the ops so the window never transiently overhangs: when the
      // origin moves left/up (right-anchored growth), move first, then
      // grow; otherwise grow first, then move.
      if (x < pos.x || y < pos.y) {
        await win.setPosition(new PhysicalPosition(x, y));
        await win.setSize(new PhysicalSize(w, h));
      } else {
        await win.setSize(new PhysicalSize(w, h));
        await win.setPosition(new PhysicalPosition(x, y));
      }
    });
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
        toolbarDismissedRef.current = false;
        setToolbarVisible(true);
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

  // Persist the dragged position, debounced, only while at rest so a grown
  // pill never becomes the stored anchor.
  useEffect(() => {
    if (!hasTauri) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unlisten: (() => void) | null = null;

    function saveDraggedPosition() {
      if (!userDragActiveRef.current) return;
      if (modeRef.current !== "recording") {
        userDragActiveRef.current = false;
        return;
      }
      const saveGeneration = userDragGenerationRef.current;
      const saveChange = userDragChangeRef.current;
      const remainingGuardMs = animatingUntilRef.current - Date.now();
      if (remainingGuardMs > 0) {
        timer = setTimeout(saveDraggedPosition, remainingGuardMs + 1);
        return;
      }
      void getCurrentWindow()
        .outerPosition()
        .then((pos) =>
          safeInvoke("toolbar_save_position", { x: pos.x, y: pos.y }),
        )
        .finally(() => {
          if (
            userDragGenerationRef.current === saveGeneration &&
            userDragChangeRef.current === saveChange
          ) {
            userDragActiveRef.current = false;
          }
        });
    }

    void getCurrentWindow()
      .onMoved(() => {
        if (!userDragArmedRef.current && !userDragActiveRef.current) return;
        if (userDragArmedRef.current) {
          userDragArmedRef.current = false;
          userDragActiveRef.current = true;
          if (userDragMarkerTimerRef.current) {
            clearTimeout(userDragMarkerTimerRef.current);
            userDragMarkerTimerRef.current = null;
          }
        }
        if (!userDragActiveRef.current) return;
        userDragChangeRef.current += 1;
        if (timer) clearTimeout(timer);
        timer = setTimeout(saveDraggedPosition, 600);
      })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});
    return () => {
      if (timer) clearTimeout(timer);
      if (userDragMarkerTimerRef.current) {
        clearTimeout(userDragMarkerTimerRef.current);
        userDragMarkerTimerRef.current = null;
      }
      unlisten?.();
    };
  }, []);

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

  function handlePillMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;
    if (hasTauri) {
      const generation = userDragGenerationRef.current + 1;
      userDragGenerationRef.current = generation;
      userDragArmedRef.current = true;
      userDragActiveRef.current = false;
      if (userDragMarkerTimerRef.current) {
        clearTimeout(userDragMarkerTimerRef.current);
      }
      userDragMarkerTimerRef.current = setTimeout(() => {
        if (userDragGenerationRef.current !== generation) return;
        userDragArmedRef.current = false;
        userDragActiveRef.current = false;
        userDragMarkerTimerRef.current = null;
      }, USER_DRAG_ARM_TIMEOUT_MS);
      getCurrentWindow()
        .startDragging()
        .catch(() => {
          if (userDragGenerationRef.current !== generation) return;
          userDragArmedRef.current = false;
          userDragActiveRef.current = false;
          if (userDragMarkerTimerRef.current) {
            clearTimeout(userDragMarkerTimerRef.current);
            userDragMarkerTimerRef.current = null;
          }
        });
    }
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
      className="record-pill-scope flex h-screen w-screen select-none items-end"
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
                  onClick={() => {
                    if (hasTauri) void openExternal(viewUrl).catch(() => {});
                    else window.open(viewUrl, "_blank");
                    dismissCard();
                  }}
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
          onLayoutChange={(layout) =>
            resizeWindowTo(layout.width, layout.height)
          }
          onMouseDown={handlePillMouseDown}
          className={enabled ? undefined : "opacity-80"}
        />
      )}
    </div>
  );
}
