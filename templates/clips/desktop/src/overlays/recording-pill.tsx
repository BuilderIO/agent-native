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
  const startedAtRef = useRef<number>(Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const levelRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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
      listen<{ level: number }>("voice:audio-level", (ev) => {
        levelRef.current = Math.max(0, Math.min(1, ev.payload.level));
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

  // Mini waveform — 6 bars driven by levelRef, smoothed.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;
    ctx2d.scale(dpr, dpr);
    let rng = Array.from({ length: 6 }, () => 0.2);
    const tick = () => {
      const target = levelRef.current;
      rng = rng.map(
        (v) => v * 0.7 + (target * 0.6 + Math.random() * 0.4) * 0.3,
      );
      ctx2d.clearRect(0, 0, W, H);
      ctx2d.fillStyle = "rgba(255,255,255,0.85)";
      const bw = 2;
      const gap = 2;
      const total = 6 * bw + 5 * gap;
      const startX = (W - total) / 2;
      for (let i = 0; i < 6; i += 1) {
        const h = Math.max(2, rng[i] * (H - 4));
        const x = startX + i * (bw + gap);
        const y = (H - h) / 2;
        ctx2d.fillRect(x, y, bw, h);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

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
          <canvas ref={canvasRef} className="h-5 w-12 shrink-0" aria-hidden />
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
