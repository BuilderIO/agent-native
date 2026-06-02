import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  IconChevronDown,
  IconChevronUp,
  IconLoader2,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
} from "@tabler/icons-react";

import { LiveTranscript } from "./live-transcript";

type PillMode = "meeting" | "clip";

interface PillContext {
  meetingId?: string | null;
  mode?: PillMode;
}

/**
 * Granola-style recording indicator. A floating pill anchored by Rust:
 * center-right for meetings, bottom-center for ordinary recordings.
 *
 *   - Collapsed (default): red dot + elapsed timer + tiny waveform + chevron.
 *   - Expanded: same header + scrolling live transcript + Pause / Stop.
 *
 * The hosting Tauri window is always-on-top, transparent, no decorations,
 * and capture-excluded — see `recording_indicator.rs`. We only deal with
 * sizing the window when the user toggles the chevron.
 */
export function RecordingPill() {
  const [expanded, setExpanded] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [ctx, setCtx] = useState<PillContext>({ mode: "clip" });
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Detached / "floating" mode — Wispr-style pill that auto-moves to the
  // top-right when the main app loses focus, with a drag handle. Driven by
  // the `clips:pill-detached` event from Rust (toggled by JS via
  // `recording_pill_set_detached`).
  const [detached, setDetached] = useState(false);
  const startedAtRef = useRef<number>(Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Per-source levels. The mic recognizer (native_speech.rs) emits with
  // `source: "mic"`; the parallel ScreenCaptureKit tap (system_audio.rs)
  // emits `source: "system"`. We render two stacked bar groups so the user
  // can see each side is being captured.
  const micLevelRef = useRef(0);
  const sysLevelRef = useRef(0);
  // Track whether we've ever seen a system-audio level event in this
  // session — when present, we render the dual-stream waveform; otherwise
  // we collapse back to a single bar group so dictation-only recordings
  // don't get a dead second row.
  const [hasSystemAudio, setHasSystemAudio] = useState(false);
  const micCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sysCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const stopFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      listen<PillContext>("clips:pill-context", (ev) => {
        setCtx({
          meetingId: ev.payload?.meetingId ?? null,
          mode: ev.payload?.mode ?? "clip",
        });
        // Reset timer on new context.
        startedAtRef.current = Date.now();
        setElapsed(0);
        // The Rust side reuses the pill window across recordings, so the
        // component never unmounts. Reset stop state explicitly when a
        // new recording session begins, otherwise the Stop button stays
        // disabled and a stale fallback timer can fire mid-session.
        setStopping(false);
        setError(null);
        if (stopFallbackRef.current) {
          clearTimeout(stopFallbackRef.current);
          stopFallbackRef.current = null;
        }
      }),
    );
    trackListen(
      listen<{ error: string }>("pill:error", (ev) => {
        setError(ev.payload?.error ?? "An error occurred.");
      }),
    );
    trackListen(
      listen<{ detached: boolean }>("clips:pill-detached", (ev) => {
        setDetached(!!ev.payload?.detached);
        // Detached pill auto-collapses — there's not enough room for the
        // expanded transcript view in the small floating footprint.
        if (ev.payload?.detached) setExpanded(false);
      }),
    );
    trackListen(
      listen<{ level: number; source?: "mic" | "system" }>(
        "voice:audio-level",
        (ev) => {
          const lvl = Math.max(0, Math.min(1, ev.payload.level));
          const source = ev.payload.source ?? "mic";
          if (source === "system") {
            sysLevelRef.current = lvl;
            setHasSystemAudio(true);
          } else {
            micLevelRef.current = lvl;
          }
        },
      ),
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
      if (stopFallbackRef.current) {
        clearTimeout(stopFallbackRef.current);
        stopFallbackRef.current = null;
      }
    };
  }, []);

  // Elapsed timer.
  useEffect(() => {
    if (paused) return;
    tickRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 500);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [paused]);

  // Dual-stream waveform — one bar group per source. When system-audio
  // hasn't emitted any levels yet (e.g. dictation-only flow), the system
  // canvas is hidden by the JSX below, but the rAF loop still runs over
  // whichever canvas refs are mounted.
  useEffect(() => {
    const setups: Array<{
      canvas: HTMLCanvasElement;
      W: number;
      H: number;
      ctx2d: CanvasRenderingContext2D;
      rng: number[];
      levelRef: React.MutableRefObject<number>;
      color: string;
    }> = [];
    const mount = (
      canvas: HTMLCanvasElement | null,
      levelRef: React.MutableRefObject<number>,
      color: string,
    ) => {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      const ctx2d = canvas.getContext("2d");
      if (!ctx2d) return;
      ctx2d.scale(dpr, dpr);
      setups.push({
        canvas,
        W,
        H,
        ctx2d,
        rng: Array.from({ length: 6 }, () => 0.2),
        levelRef,
        color,
      });
    };
    // Mic = warm amber-ish white, system = cool sky tint. Subtle so the pill
    // stays calm.
    mount(micCanvasRef.current, micLevelRef, "rgba(252, 211, 77, 0.9)");
    mount(sysCanvasRef.current, sysLevelRef, "rgba(125, 211, 252, 0.9)");
    const tick = () => {
      for (const s of setups) {
        const target = s.levelRef.current;
        s.rng = s.rng.map(
          (v) => v * 0.7 + (target * 0.6 + Math.random() * 0.4) * 0.3,
        );
        s.ctx2d.clearRect(0, 0, s.W, s.H);
        s.ctx2d.fillStyle = s.color;
        const bw = 2;
        const gap = 2;
        const total = 6 * bw + 5 * gap;
        const startX = (s.W - total) / 2;
        for (let i = 0; i < 6; i += 1) {
          const h = Math.max(2, s.rng[i] * (s.H - 4));
          const x = startX + i * (bw + gap);
          const y = (s.H - h) / 2;
          s.ctx2d.fillRect(x, y, bw, h);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [hasSystemAudio]);

  async function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    try {
      await invoke("recording_pill_expand", { expanded: next });
    } catch {
      // ignore — best effort
    }
  }

  async function onPauseClick() {
    const nextPaused = !paused;
    setPaused(nextPaused);
    emit(nextPaused ? "clips:recorder-pause" : "clips:recorder-resume").catch(
      () => {},
    );
    emit("clips:pill-pause", { paused: nextPaused }).catch(() => {});
  }

  async function onStopClick() {
    if (stopping) return;
    setStopping(true);
    emit("clips:pill-stop", { meetingId: ctx.meetingId ?? null }).catch(
      () => {},
    );
    stopFallbackRef.current = setTimeout(() => {
      invoke("recording_pill_hide").catch(() => {});
    }, 3_000);
  }

  // Click on the drag handle (detached mode) un-detaches the pill and
  // re-anchors it bottom-center on the meeting / main app. Re-focuses the
  // main app so the pill mode flips back through the focus listener too.
  async function onHandleClick() {
    try {
      await invoke("recording_pill_set_detached", { detached: false });
    } catch {
      // ignore — best effort
    }
  }

  const handlePillMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-no-drag]")) return;
    getCurrentWindow()
      .startDragging()
      .catch((err) => {
        console.warn("[clips-pill] startDragging failed", err);
      });
  };

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const stopLabel =
    ctx.mode === "meeting" ? "Stop transcription" : "Stop recording";

  return (
    <div className="pill-outer">
      <div className="pill-inner" onMouseDown={handlePillMouseDown}>
        <div
          className={`pill-header${detached ? " pill-header-detached" : ""}`}
        >
          <span
            className={`pill-dot ${paused ? "pill-dot-paused" : "pill-dot-active"}`}
          />
          <span className="pill-timer">
            {mm}:{ss}
          </span>
          {hasSystemAudio ? (
            <div
              className="pill-wave-dual"
              aria-hidden
              title="Top: you. Bottom: speaker."
            >
              <canvas
                ref={micCanvasRef}
                className="pill-wave-canvas-half"
                aria-label="Microphone level"
              />
              <canvas
                ref={sysCanvasRef}
                className="pill-wave-canvas-half"
                aria-label="System audio level"
              />
            </div>
          ) : (
            <canvas
              ref={micCanvasRef}
              className="pill-wave-canvas"
              aria-hidden
            />
          )}
          <span className="pill-mode">
            {ctx.mode === "meeting" ? "Meeting notes" : "Recording"}
          </span>
          <button
            type="button"
            onClick={onStopClick}
            disabled={stopping}
            data-no-drag
            className="pill-stop-btn"
            aria-label={stopping ? "Stopping" : stopLabel}
            title={stopping ? "Stopping..." : stopLabel}
          >
            {stopping ? (
              <IconLoader2 className="pill-spinner" size={14} />
            ) : (
              <IconPlayerStopFilled size={14} />
            )}
          </button>
          <button
            type="button"
            onClick={toggleExpanded}
            data-no-drag
            className="pill-expand-btn"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? (
              <IconChevronUp size={16} />
            ) : (
              <IconChevronDown size={16} />
            )}
          </button>
        </div>

        {detached ? (
          <button
            type="button"
            onClick={onHandleClick}
            data-no-drag
            aria-label="Re-attach pill to main window"
            className="pill-drag-handle"
          />
        ) : null}

        {error ? (
          <div className="pill-error" role="alert">
            {error}
          </div>
        ) : null}

        <div
          style={
            expanded
              ? {
                  display: "flex",
                  flexDirection: "column",
                  flex: 1,
                  minHeight: 0,
                }
              : { display: "none" }
          }
        >
          <div className="pill-divider" />
          <div className="pill-transcript-area">
            <LiveTranscript />
          </div>
          <div className="pill-footer">
            <button
              type="button"
              onClick={onPauseClick}
              data-no-drag
              className="pill-pause-btn"
            >
              {paused ? (
                <IconPlayerPlayFilled size={14} />
              ) : (
                <IconPlayerPauseFilled size={14} />
              )}
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              onClick={onStopClick}
              disabled={stopping}
              data-no-drag
              className="pill-stop-footer-btn"
              aria-label={stopping ? "Stopping" : stopLabel}
              title={stopping ? "Stopping..." : stopLabel}
            >
              {stopping ? (
                <IconLoader2 className="pill-spinner" size={14} />
              ) : (
                <IconPlayerStopFilled size={14} />
              )}
              {stopping ? "Stopping" : "Stop"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
