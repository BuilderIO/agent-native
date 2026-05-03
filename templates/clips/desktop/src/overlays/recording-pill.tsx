import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import {
  IconChevronDown,
  IconChevronUp,
  IconPlayerPauseFilled,
  IconPlayerStopFilled,
} from "@tabler/icons-react";

import { LiveTranscript } from "./live-transcript";

type PillMode = "meeting" | "clip";

interface PillContext {
  meetingId?: string | null;
  mode?: PillMode;
}

/**
 * Granola-style recording indicator. A floating pill anchored to the top-
 * right of the primary display:
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
    setPaused((p) => !p);
    emit("clips:pill-pause", { paused: !paused }).catch(() => {});
  }

  async function onStopClick() {
    emit("clips:pill-stop", { meetingId: ctx.meetingId ?? null }).catch(
      () => {},
    );
    try {
      await invoke("recording_pill_hide");
    } catch {
      // ignore
    }
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

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="flex h-full w-full items-stretch justify-stretch">
      <div
        className="flex h-full w-full flex-col rounded-2xl bg-zinc-900/95 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-md"
        data-tauri-drag-region
      >
        {/* Collapsed header — always visible */}
        <div className="flex h-[56px] shrink-0 items-center gap-2 px-3">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              paused ? "bg-zinc-400" : "bg-red-500 animate-pulse"
            }`}
          />
          <span className="text-[13px] font-medium tabular-nums">
            {mm}:{ss}
          </span>
          {hasSystemAudio ? (
            // Stacked dual-stream layout: mic on top, system on bottom.
            // Each canvas is half-height so the overall pill height stays
            // unchanged.
            <div
              className="flex h-5 w-12 shrink-0 flex-col gap-px"
              aria-hidden
              title="Top: you. Bottom: speaker."
            >
              <canvas
                ref={micCanvasRef}
                className="h-1/2 w-full"
                aria-label="Microphone level"
              />
              <canvas
                ref={sysCanvasRef}
                className="h-1/2 w-full"
                aria-label="System audio level"
              />
            </div>
          ) : (
            <canvas
              ref={micCanvasRef}
              className="h-5 w-12 shrink-0"
              aria-hidden
            />
          )}
          <span className="ml-auto truncate text-[12px] text-zinc-300">
            {ctx.mode === "meeting" ? "Meeting" : "Recording"}
          </span>
          <button
            type="button"
            onClick={toggleExpanded}
            data-no-drag
            className="ml-1 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-zinc-200 hover:bg-white/10"
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
          // 4px drag handle along the bottom edge of the floating pill.
          // Click un-detaches; the `data-tauri-drag-region` on the parent
          // already handles the actual drag.
          <button
            type="button"
            onClick={onHandleClick}
            data-no-drag
            aria-label="Re-attach pill to main window"
            className="mx-auto mb-1 mt-auto h-1 w-10 shrink-0 cursor-pointer rounded-full bg-white/30 hover:bg-white/50"
          />
        ) : null}

        {expanded ? (
          <>
            <div className="mx-3 h-px shrink-0 bg-white/10" />
            <div className="min-h-0 flex-1">
              <LiveTranscript />
            </div>
            <div className="flex shrink-0 items-center gap-2 px-3 pb-3 pt-2">
              <button
                type="button"
                onClick={onPauseClick}
                data-no-drag
                className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-white/10 px-3 text-[12px] font-medium text-white hover:bg-white/20"
              >
                <IconPlayerPauseFilled size={14} />
                {paused ? "Resume" : "Pause"}
              </button>
              <button
                type="button"
                onClick={onStopClick}
                data-no-drag
                className="ml-auto inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-red-500 px-3 text-[12px] font-medium text-white hover:bg-red-400"
              >
                <IconPlayerStopFilled size={14} />
                Stop
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
