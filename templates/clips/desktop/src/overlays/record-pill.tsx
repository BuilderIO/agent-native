import {
  IconCheck,
  IconCopy,
  IconLink,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconRefresh,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { emit, listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useEffect, useRef, useState } from "react";
import type { FocusEvent } from "react";
import { flushSync } from "react-dom";

// Transparent apron around the pill, sized to ITS shadow rather than the
// 18px shared overlay default: `0 12px 34px` extends ~46px below and ~34px
// to the sides, and anything past the window edge clips into a hard
// rectangle that shows on light backgrounds. 40px keeps the visible falloff
// inside the window (the last few px of blur tail are imperceptible). Must
// match the gutter in Rust `show_toolbar` and the wrapper padding below.
const OVERLAY_SHADOW_GUTTER = 40;
const SEG_MS = 180;
const HOVER_INTENT_MS = 150;
const BLINK_MS = 700;
// Within this distance of the right screen edge the pill anchors its RIGHT
// edge and grows left instead, so growth never runs off-screen.
const RIGHT_EDGE_ANCHOR_PX = 200;
const FINALIZING_RESULT_STORAGE_KEY = "clips-finalizing-result";

type PillMode = "recording" | "confirm" | "done";
type Seg = "stop" | "q" | "del" | "res" | "extras";
type DoneStage = "finishing" | "uploading" | "uploaded" | "failed";

type RecorderSession = {
  viewUrl?: string | null;
  localOnly?: boolean;
};

type NativeUploadFinished = {
  recordingId?: string;
  ok?: boolean;
  viewUrl?: string;
  error?: string | null;
  localFilePath?: string | null;
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
 * confirm, done. Left edge anchored: hover extras and the inline delete
 * confirm grow rightward while the dot, timer, pause button, and Stop hold
 * position (near the right screen edge the anchor mirrors). Stop swaps the
 * pill for the completion card in place; the link is copied only when the
 * user clicks Copy (an automatic copy would clear their clipboard
 * unannounced). While paused the pause circle swaps to a play glyph — the
 * amber dot carries the paused state; the button carries the way back.
 * Pure command emitter — the recorder in the popover window owns
 * capture, and drives us through the same IPC contract the old toolbar used:
 *
 *   receives → `clips:recorder-state` { paused, elapsedMs },
 *              `clips:toolbar-enabled`, `clips:toolbar-preparing`,
 *              `clips:recorder-session` { viewUrl, localOnly },
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
  const [blinkDim, setBlinkDim] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const [confirmQuestion, setConfirmQuestion] = useState("");
  // Whether the delete confirm was entered from an already-paused recording:
  // its safe exit then KEEPS the pause, so the button says Cancel, not Resume.
  const [confirmFromPaused, setConfirmFromPaused] = useState(false);
  const confirmFromPausedRef = useRef(false);
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
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealedRef = useRef(false);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shrinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const levelDecayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animatingUntilRef = useRef(0);
  const pauseTransitionRef = useRef<"pause" | "resume" | null>(null);
  const pauseTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const settleBatchRef = useRef(0);
  const pendingSegsRef = useRef<Set<Seg>>(new Set());
  const finishSettleRef = useRef<(() => void) | null>(null);
  const pillRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const segRefs = useRef<Record<Seg, HTMLSpanElement | null>>({
    stop: null,
    q: null,
    del: null,
    res: null,
    extras: null,
  });

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

  // ---- segment motion: measure natural width, animate exact pixels ----

  function segInnerWidth(k: Seg): number {
    const el = segRefs.current[k];
    const inner = el?.firstElementChild as HTMLElement | null;
    if (!inner) return 0;
    return Math.ceil(inner.getBoundingClientRect().width);
  }

  function segCurrentWidth(k: Seg): number {
    const el = segRefs.current[k];
    if (!el) return 0;
    return el.getBoundingClientRect().width;
  }

  function setSeg(k: Seg, open: boolean, delayMs = 0) {
    const el = segRefs.current[k];
    if (!el) return;
    // A segment that still sits at `auto` (the Stop capsule before its first
    // collapse) cannot animate FROM auto — snap it to its measured pixels
    // and force a reflow so the width transition has a number to leave from.
    if (!open && (!el.style.width || el.style.width === "auto")) {
      el.style.transition = "none";
      el.style.width = `${segCurrentWidth(k)}px`;
      void el.offsetWidth;
    }
    const reduced = reducedRef.current;
    el.style.transition = reduced
      ? "none"
      : `width ${SEG_MS}ms var(--pill-ease), opacity ${SEG_MS}ms ease`;
    el.style.transitionDelay = reduced ? "0ms" : `${delayMs}ms`;
    el.style.width = open ? `${segInnerWidth(k)}px` : "0px";
    el.style.opacity = open ? "1" : "0";
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
      const win = getCurrentWindow();
      const [pos, size, scale, monitor] = await Promise.all([
        win.outerPosition(),
        win.outerSize(),
        win.scaleFactor(),
        currentMonitor(),
      ]);
      const gutter = Math.round(OVERLAY_SHADOW_GUTTER * scale);
      const w = Math.ceil(contentW * scale) + gutter * 2;
      const h = Math.ceil(contentH * scale) + gutter * 2;
      let x = pos.x;
      if (monitor) {
        const monRight = monitor.position.x + monitor.size.width;
        const nearRightEdge =
          pos.x + size.width >=
          monRight - Math.round(RIGHT_EDGE_ANCHOR_PX * scale);
        if (nearRightEdge) x = pos.x + size.width - w;
      }
      const y = pos.y + size.height - h;
      await win.setSize(new PhysicalSize(w, h));
      await win.setPosition(new PhysicalPosition(x, y));
    });
  }

  function syncWindowToContent() {
    const el =
      (mode === "done" ? cardRef.current : pillRef.current) ?? pillRef.current;
    if (!el) return;
    // offsetWidth/Height are layout metrics, immune to the card's scale-in
    // entrance — a rect measured mid-animation locks the window too narrow.
    resizeWindowTo(el.offsetWidth, el.offsetHeight);
  }

  // Which segments are (or are animating toward) open. Live rects mid-flight
  // under-measure a transition target, so the window budget is computed from
  // this intent instead of from the DOM.
  const openSegsRef = useRef<Record<Seg, boolean>>({
    stop: true,
    q: false,
    del: false,
    res: false,
    extras: false,
  });

  /**
   * Run one choreographed set of segment transitions: pre-grow the window to
   * the post-transition budget (plus slack) so nothing clips, start every
   * segment's width+opacity bar, then shrink to the exact measured rect once
   * the last bar lands.
   */
  function transitionSegs(changes: Array<[Seg, boolean, number]>) {
    const pill = pillRef.current;
    if (!pill) return;
    for (const [k, open] of changes) openSegsRef.current[k] = open;
    const pillW = pill.getBoundingClientRect().width;
    const segsW = (Object.keys(openSegsRef.current) as Seg[]).reduce(
      (sum, k) => sum + segCurrentWidth(k),
      0,
    );
    const staticW = pillW - segsW;
    const targetW = (Object.keys(openSegsRef.current) as Seg[]).reduce(
      (sum, k) => sum + (openSegsRef.current[k] ? segInnerWidth(k) : 0),
      staticW,
    );
    const maxDelay = changes.reduce((m, [, , d]) => Math.max(m, d), 0);
    const settleMs = reducedRef.current ? 16 : SEG_MS + maxDelay + 40;
    animatingUntilRef.current = Date.now() + settleMs;
    if (shrinkTimerRef.current) clearTimeout(shrinkTimerRef.current);
    // Budget the window for whichever is wider, plus slack for measurement
    // rounding — the settle pass snaps to the exact rect.
    resizeWindowTo(
      Math.ceil(Math.max(pillW, targetW)) + 12,
      Math.ceil(pill.getBoundingClientRect().height),
    );
    // The settle is driven by the transitions actually ending, not by a
    // timer — a throttled clock runs them late, and snapping on a fixed
    // schedule cuts the choreography off mid-motion.
    const batch = ++settleBatchRef.current;
    pendingSegsRef.current.clear();
    for (const [k, open, delay] of changes) {
      const before = segCurrentWidth(k);
      setSeg(k, open, delay);
      const el = segRefs.current[k];
      const after = el ? Number.parseFloat(el.style.width) : before;
      if (!reducedRef.current && Math.abs(after - before) > 0.5) {
        pendingSegsRef.current.add(k);
      }
    }
    const finishSettle = () => {
      if (settleBatchRef.current !== batch) return;
      if (shrinkTimerRef.current) clearTimeout(shrinkTimerRef.current);
      pendingSegsRef.current.clear();
      animatingUntilRef.current = Date.now();
      syncWindowToContent();
    };
    finishSettleRef.current = finishSettle;
    if (pendingSegsRef.current.size === 0) {
      finishSettle();
      return;
    }
    // Dead-clock fallback: if the ends never fire, force every segment to
    // its intended state so the pill can never strand half-open. Sized well
    // past any late-running transition so it never clips a live one.
    shrinkTimerRef.current = setTimeout(
      () => {
        if (settleBatchRef.current !== batch) return;
        for (const k of Object.keys(openSegsRef.current) as Seg[]) {
          const el = segRefs.current[k];
          if (!el) continue;
          el.style.transition = "none";
          el.style.width = openSegsRef.current[k]
            ? `${segInnerWidth(k)}px`
            : "0px";
          el.style.opacity = openSegsRef.current[k] ? "1" : "0";
        }
        finishSettle();
      },
      Math.max(1_000, settleMs * 3),
    );
  }

  /** Snap every segment to its resting state (Stop visible, all confirm and
   * hover segments collapsed) with no animation — used when the recorder
   * disables the pill (restart teardown, session reset). */
  function resetToRest() {
    revealedRef.current = false;
    for (const k of ["q", "del", "res", "extras"] as Seg[]) {
      const el = segRefs.current[k];
      if (!el) continue;
      el.style.transition = "none";
      el.style.width = "0px";
      el.style.opacity = "0";
      openSegsRef.current[k] = false;
    }
    const stopEl = segRefs.current.stop;
    if (stopEl) {
      stopEl.style.transition = "none";
      stopEl.style.width = "auto";
      stopEl.style.opacity = "1";
      openSegsRef.current.stop = true;
    }
    setMode("recording");
    clearPauseTransition();
    setPaused(false);
  }

  // ---- reveal / confirm / done choreography ----

  function reveal(open: boolean) {
    if (open === revealedRef.current) return;
    if (open && modeRef.current !== "recording") return;
    revealedRef.current = open;
    transitionSegs([["extras", open, 0]]);
  }

  const pausedRef = useRef(false);
  pausedRef.current = paused;

  function enterConfirm() {
    if (modeRef.current !== "recording") return;
    const wasPaused = pausedRef.current;
    confirmFromPausedRef.current = wasPaused;
    setMode("confirm");
    // The question's segment width is measured synchronously below, so the
    // new text (and the exit button's label) must be committed to the DOM
    // before transitionSegs runs — without flushSync it would measure the
    // previous (empty) question.
    flushSync(() => {
      setConfirmQuestion(`Delete ${formatDurationCopy(elapsedRef.current)}?`);
      setConfirmFromPaused(wasPaused);
    });
    // Pause at the instant of the click — the deliberation must not end up
    // in the clip. A recording already paused by hand stays exactly as the
    // user left it, and exiting the confirm restores that state instead of
    // resuming behind their back.
    if (!wasPaused) applyPauseIntent("pause");
    revealedRef.current = false;
    transitionSegs([
      ["extras", false, 0],
      ["stop", false, 0],
      ["q", true, 0],
      ["del", true, 20],
      ["res", true, 40],
    ]);
    setAnnouncement("Paused");
  }

  function exitConfirm() {
    if (modeRef.current !== "confirm") return;
    setMode("recording");
    if (!confirmFromPausedRef.current) applyPauseIntent("resume");
    transitionSegs([
      ["res", false, 0],
      ["del", false, 20],
      ["q", false, 40],
      ["stop", true, 40],
    ]);
    setAnnouncement(confirmFromPausedRef.current ? "Paused" : "Recording");
  }

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
    if (!enabled || modeRef.current === "done") return;
    setDoneDurationMs(elapsedRef.current);
    if (sessionRef.current.localOnly) {
      setSavedLocally(true);
      setDoneStage("uploaded");
    } else {
      setDoneStage("finishing");
    }
    // Hold the window open BEFORE the stop event so the recorder's teardown
    // can't close us out from under the card.
    void safeInvoke("set_toolbar_finishing", { hold: true }).then(() => {
      void safeEmit("clips:recorder-stop");
    });
    // Pre-grow the window for the card so its entrance never renders clipped;
    // the done-mode effect refits to the exact card rect one frame later.
    resizeWindowTo(340, 180);
    setMode("done");
    setAnnouncement("Recording saved");
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

  function restart() {
    if (!enabled || pendingAction || modeRef.current !== "recording") return;
    setPendingAction("restart");
    setElapsed(0);
    // Hide immediately — the restart teardown and fresh countdown follow, and
    // recording controls must not sit on screen while no capture is live. The
    // replacement session's `clips:toolbar-enabled` re-shows the pill at 0:00.
    setEnabled(false);
    // Hold the window through the restart teardown so the replacement
    // session reuses it instead of paying a webview respawn; the pill hides
    // itself while disabled and the next `clips:toolbar-enabled` re-shows it.
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
  }

  function confirmDelete() {
    if (pendingAction) return;
    setPendingAction("cancel");
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
    });
  }

  function handleUploadFinished(payload: NativeUploadFinished) {
    if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
    if (payload.ok && payload.viewUrl) {
      setViewUrl(payload.viewUrl);
      setDoneStage("uploaded");
      return;
    }
    setSavedLocally(Boolean(payload.localFilePath));
    if (payload.viewUrl) setViewUrl(payload.viewUrl);
    setDoneStage("failed");
  }

  // ---- listeners ----

  useEffect(() => {
    const unlistens: Array<() => void> = [];
    let stopped = false;
    const track = (p: Promise<() => void>) => {
      p.then((u) => {
        if (stopped) u();
        else unlistens.push(u);
      }).catch(() => {});
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
          setElapsed(payload.elapsedMs ?? 0);
        },
      ),
    );
    track(
      safeListen<boolean>("clips:toolbar-enabled", (payload) => {
        setEnabled(!!payload);
        setPendingAction(null);
        if (fallbackTimerRef.current) {
          clearTimeout(fallbackTimerRef.current);
          fallbackTimerRef.current = null;
        }
        if (payload) {
          // A live session owns the pill now: release any restart hold, and
          // if a completion card from the previous session is still up, this
          // reused window becomes the new session's pill.
          void safeInvoke("set_toolbar_finishing", { hold: false });
          if (modeRef.current === "done") {
            setViewUrl(null);
            setCopied(false);
            setSavedLocally(false);
            setDoneStage("finishing");
            sessionRef.current = {};
            resetToRest();
          }
        } else if (modeRef.current !== "done") {
          setElapsed(0);
          resetToRest();
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
        if (payload?.localOnly) setSavedLocally(true);
      }),
    );
    track(
      safeListen<{ stage?: string; progress?: number | null }>(
        "clips:native-upload-progress",
        (payload) => {
          if (modeRef.current !== "done") return;
          if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
          stallTimerRef.current = setTimeout(() => {
            setDoneStage((s) => (s === "uploaded" ? s : "failed"));
          }, 120_000);
          if (payload?.stage && payload.stage !== "opening") {
            setDoneStage((s) =>
              s === "uploaded" || s === "failed" ? s : "uploading",
            );
          }
        },
      ),
    );
    track(
      safeListen<NativeUploadFinished>(
        "clips:native-upload-finished",
        (payload) => handleUploadFinished(payload ?? {}),
      ),
    );
    track(
      safeListen<{ level?: number; source?: string }>(
        "voice:audio-level",
        (payload) => {
          if ((payload?.source ?? "mic") !== "mic") return;
          const level = Math.max(0, Math.min(1, Number(payload?.level) || 0));
          setMicLevel(level);
          if (levelDecayRef.current) clearTimeout(levelDecayRef.current);
          levelDecayRef.current = setTimeout(() => setMicLevel(0), 400);
        },
      ),
    );
    void safeEmit("clips:toolbar-ready", {});
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
        hoverTimerRef,
        fallbackTimerRef,
        shrinkTimerRef,
        stallTimerRef,
        levelDecayRef,
        pauseTransitionTimerRef,
      ]) {
        if (t.current) clearTimeout(t.current);
      }
    };
  }, []);

  function handleSegTransitionEnd(e: React.TransitionEvent) {
    if (e.propertyName !== "width") return;
    const el = e.target as HTMLElement;
    const entry = (Object.keys(segRefs.current) as Seg[]).find(
      (k) => segRefs.current[k] === el,
    );
    if (!entry) return;
    pendingSegsRef.current.delete(entry);
    if (pendingSegsRef.current.size === 0) finishSettleRef.current?.();
  }

  // Escape resumes during confirm — window-level, per the spec.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && modeRef.current === "confirm") {
        e.preventDefault();
        exitConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Paused/confirm dot blink: opacity 1 ↔ 0.3 on a 700ms interval. Reduced
  // motion keeps a static amber dot.
  const blinking = paused && !reducedRef.current;
  useEffect(() => {
    if (!blinking) {
      setBlinkDim(false);
      return;
    }
    const t = setInterval(() => setBlinkDim((d) => !d), BLINK_MS);
    return () => clearInterval(t);
  }, [blinking]);

  // Fit the native window to the measured pill once fonts have settled, and
  // pin the Stop segment to an explicit pixel width so its later collapse
  // animates from a number instead of `auto`.
  useEffect(() => {
    let cancelled = false;
    const fit = () => {
      if (cancelled) return;
      const el = segRefs.current.stop;
      if (el) {
        el.style.width = `${segInnerWidth("stop")}px`;
        el.style.opacity = "1";
      }
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
    void getCurrentWindow()
      .onMoved(() => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          if (
            modeRef.current !== "recording" ||
            revealedRef.current ||
            Date.now() < animatingUntilRef.current
          ) {
            return;
          }
          void getCurrentWindow()
            .outerPosition()
            .then((pos) =>
              safeInvoke("toolbar_save_position", { x: pos.x, y: pos.y }),
            );
        }, 600);
      })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});
    return () => {
      if (timer) clearTimeout(timer);
      unlisten?.();
    };
  }, []);

  // Demo drive for browser previews (no Tauri): tick the timer and meter.
  useEffect(() => {
    if (!demoMode) return;
    const t = setInterval(() => {
      if (modeRef.current !== "done" && !pausedRef.current) {
        setElapsed((e) => e + 500);
        setMicLevel(Math.random());
      }
    }, 500);
    return () => clearInterval(t);
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
    const el = mode === "done" ? cardRef.current : pillRef.current;
    if (el) observer.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    };
  }, [mode]);

  // The pill owns its window's visibility: hidden through pre-record and the
  // countdown, shown the moment capture is live, and kept up while the
  // completion card is open. Rust never shows this window itself.
  const visibleRef = useRef(false);
  useEffect(() => {
    if (!hasTauri) return;
    const visible = enabled || mode === "done";
    if (visibleRef.current === visible) return;
    visibleRef.current = visible;
    if (visible) syncWindowToContent();
    queueWindowOp(async () => {
      await invoke("toolbar_set_visible", { visible });
    });
  }, [enabled, mode]);

  // ---- interactions ----

  function handleMouseEnter() {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => reveal(true), HOVER_INTENT_MS);
  }
  function handleMouseLeave() {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    reveal(false);
  }
  function handleFocusCapture() {
    reveal(true);
  }
  function handleBlurCapture(e: FocusEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    reveal(false);
  }

  function handlePillMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;
    // During confirm only Delete, Resume, or Esc answer the question — a
    // stray tap must never resume the recording.
    if (hasTauri) {
      getCurrentWindow()
        .startDragging()
        .catch(() => {});
    }
  }

  const inConfirm = mode === "confirm";
  const showPaused = paused;
  const meterFlat = showPaused || !enabled;
  const timerText = formatTimer(elapsed);
  const barHeights = meterFlat
    ? [4, 4, 4]
    : [
        4 + Math.round(micLevel * 10 * 0.55),
        4 + Math.round(micLevel * 10),
        4 + Math.round(micLevel * 10 * 0.75),
      ];

  const doneCaption =
    doneStage === "uploaded"
      ? viewUrl
        ? "uploaded"
        : "saved on this device"
      : doneStage === "failed"
        ? savedLocally
          ? "upload paused, saved on this device"
          : "upload paused"
        : doneStage === "uploading"
          ? "uploading"
          : "finishing up";

  return (
    <div
      data-tw-surface
      className="record-pill-scope flex h-screen w-screen select-none items-end p-[40px]"
    >
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {mode === "done" ? (
        <div
          ref={cardRef}
          className={`w-[340px] flex-none rounded-[14px] border-[0.5px] border-[var(--pill-card-border)] bg-[var(--pill-card-surface)] p-4 record-pill-card-shadow ${reducedRef.current ? "" : "record-pill-card-in"}`}
        >
          <div className="mb-3 flex items-center gap-2.5">
            <span className="flex size-8 flex-none items-center justify-center rounded-full bg-[var(--pill-card-badge-bg)] text-[var(--pill-card-badge)]">
              <IconCheck size={16} stroke={2.4} aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--pill-card-ink)]">
                Recording saved
              </div>
              <div className="text-xs text-[var(--pill-card-ink-2)]">
                {formatDurationCopy(doneDurationMs)} · {doneCaption}
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
        <div
          ref={pillRef}
          onMouseDown={handlePillMouseDown}
          onTransitionEnd={handleSegTransitionEnd}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onFocusCapture={handleFocusCapture}
          onBlurCapture={handleBlurCapture}
          className={`flex h-[42px] flex-none items-center rounded-full bg-[var(--pill-chrome)] pt-1.5 pr-2 pb-1.5 pl-4 text-[var(--pill-on-chrome)] record-pill-shadow ${enabled ? "" : "opacity-80"}`}
        >
          <span
            aria-hidden
            className="size-2 flex-none rounded-full transition-colors duration-150"
            style={{
              background: showPaused ? "var(--pill-paused)" : "var(--pill-rec)",
              opacity: blinking && blinkDim ? 0.3 : 1,
            }}
          />
          <span
            aria-live="off"
            className="record-pill-mono ml-2.5 min-w-11 flex-none text-sm font-medium"
          >
            {timerText}
          </span>
          <span
            aria-hidden
            className="ml-2.5 flex h-3.5 flex-none items-end gap-0.5 transition-opacity duration-150"
            style={{ opacity: meterFlat ? 0.3 : 1 }}
          >
            {barHeights.map((h, i) => (
              <i
                key={i}
                className="block w-[3px] rounded-[1px] bg-[var(--pill-meter)] transition-[height] duration-200"
                style={{ height: `${h}px` }}
              />
            ))}
          </span>
          <button
            type="button"
            onClick={togglePause}
            disabled={!enabled || inConfirm}
            aria-label={showPaused ? "Resume" : "Pause"}
            className="ml-2.5 flex size-[30px] flex-none items-center justify-center rounded-full bg-[var(--pill-control)] disabled:cursor-default disabled:opacity-50"
          >
            {showPaused ? (
              <IconPlayerPlayFilled size={14} aria-hidden />
            ) : (
              <IconPlayerPauseFilled size={14} aria-hidden />
            )}
          </button>
          <span
            ref={(el) => {
              segRefs.current.stop = el;
            }}
            className="record-pill-seg"
            style={{ width: "auto", opacity: 1 }}
          >
            <span className="inline-flex flex-none items-center">
              <button
                type="button"
                onClick={stop}
                disabled={!enabled}
                aria-label="Stop and save"
                className="ml-2.5 flex h-[30px] flex-none items-center gap-1.5 rounded-full bg-[var(--pill-on-chrome)] px-3.5 text-[13px] font-semibold text-[var(--pill-chrome)]"
              >
                <IconPlayerStopFilled size={13} aria-hidden />
                Stop
              </button>
            </span>
          </span>
          <span
            ref={(el) => {
              segRefs.current.q = el;
            }}
            className="record-pill-seg"
          >
            <span className="inline-flex flex-none items-center">
              <span className="pl-2.5 text-xs whitespace-nowrap text-[var(--pill-q-ink)]">
                {confirmQuestion}
              </span>
            </span>
          </span>
          <span
            ref={(el) => {
              segRefs.current.del = el;
            }}
            className="record-pill-seg"
          >
            <span className="inline-flex flex-none items-center">
              <button
                type="button"
                onClick={confirmDelete}
                className="ml-2.5 flex h-7 flex-none items-center rounded-full bg-[var(--pill-rec)] px-3.5 text-xs font-semibold text-[var(--pill-on-chrome)]"
              >
                Delete
              </button>
            </span>
          </span>
          <span
            ref={(el) => {
              segRefs.current.res = el;
            }}
            className="record-pill-seg"
          >
            <span className="inline-flex flex-none items-center">
              <button
                type="button"
                onClick={exitConfirm}
                className="ml-2 flex h-7 flex-none items-center rounded-full bg-[var(--pill-soft)] px-3.5 text-xs font-semibold text-[var(--pill-on-chrome)]"
              >
                {confirmFromPaused ? "Cancel" : "Resume"}
              </button>
            </span>
          </span>
          <span
            ref={(el) => {
              segRefs.current.extras = el;
            }}
            className="record-pill-seg"
          >
            <span className="inline-flex flex-none items-center">
              <span
                aria-hidden
                className="ml-2.5 h-[18px] w-px flex-none bg-[var(--pill-soft)]"
              />
              <button
                type="button"
                onClick={restart}
                disabled={!enabled || !!pendingAction}
                aria-label="Restart recording"
                className="ml-2 flex size-[30px] flex-none items-center justify-center rounded-full text-[var(--pill-ghost-ink)] hover:text-[var(--pill-on-chrome)]"
              >
                <IconRefresh size={14} stroke={2} aria-hidden />
              </button>
              <button
                type="button"
                onClick={enterConfirm}
                disabled={!enabled || !!pendingAction}
                aria-label="Delete recording"
                className="ml-2 flex size-[30px] flex-none items-center justify-center rounded-full text-[var(--pill-ghost-ink)] hover:text-[var(--pill-on-chrome)]"
              >
                <IconTrash size={14} stroke={2} aria-hidden />
              </button>
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
