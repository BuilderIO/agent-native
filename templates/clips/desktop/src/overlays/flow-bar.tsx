import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

type FlowState = "idle" | "recording" | "processing" | "complete";

/**
 * Wispr Flow-style dictation overlay — a slim dark floating panel,
 * horizontally centered. Four states driven by Tauri events:
 *
 *   1. Idle (320x40): dark glass pill, "EN" language indicator circle
 *   2. Recording (380x48): white waveform bars driven by audio levels
 *   3. Processing (380x48): "Polishing..." text with shimmer animation
 *   4. Complete: snaps back to idle
 *
 * Events:
 *   - `voice:state-change` { state: "idle"|"recording"|"processing"|"complete" }
 *   - `voice:audio-level` { level: number } (0-1) for waveform visualization
 */
export function FlowBar() {
  const [state, setState] = useState<FlowState>("idle");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const levelRef = useRef(0);
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
      listen<{ state: FlowState }>("voice:state-change", (ev) => {
        const next = ev.payload.state;
        if (next === "complete") {
          setState("idle");
        } else {
          setState(next);
        }
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
      unlistens.length = 0;
    };
  }, []);

  // Waveform canvas rendering loop — only runs during the "recording" state.
  useEffect(() => {
    if (state !== "recording") {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const BAR_COUNT = 24;
    const BAR_WIDTH = 2;
    const BAR_GAP = 4;

    function draw() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const logicalW = BAR_COUNT * (BAR_WIDTH + BAR_GAP) - BAR_GAP;
      const logicalH = 32;
      if (canvas.width !== logicalW * dpr || canvas.height !== logicalH * dpr) {
        canvas.width = logicalW * dpr;
        canvas.height = logicalH * dpr;
        canvas.style.width = `${logicalW}px`;
        canvas.style.height = `${logicalH}px`;
        ctx.scale(dpr, dpr);
      }

      ctx.clearRect(0, 0, logicalW, logicalH);
      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";

      const level = levelRef.current;
      const now = Date.now();

      for (let i = 0; i < BAR_COUNT; i++) {
        // Each bar gets a slightly different phase so the waveform looks
        // organic rather than uniform. The level controls overall amplitude.
        const phase = Math.sin((now / 200) + (i * 0.6)) * 0.5 + 0.5;
        const barLevel = Math.max(0.08, level * phase);
        const h = barLevel * logicalH;
        const x = i * (BAR_WIDTH + BAR_GAP);
        const y = (logicalH - h) / 2;
        ctx.beginPath();
        ctx.roundRect(x, y, BAR_WIDTH, h, 1);
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [state]);

  return (
    <div className="flow-bar-root">
      <div className={`flow-bar flow-bar-${state}`}>
        {state === "idle" ? (
          <div className="flow-bar-idle">
            <div className="flow-bar-lang">EN</div>
          </div>
        ) : null}

        {state === "recording" ? (
          <div className="flow-bar-recording">
            <canvas ref={canvasRef} className="flow-bar-canvas" />
          </div>
        ) : null}

        {state === "processing" ? (
          <div className="flow-bar-processing">
            <span className="flow-bar-shimmer">Polishing...</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
