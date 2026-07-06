import { IconX } from "@tabler/icons-react";
import { emit, listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

import { onAudioLevel } from "../lib/transcription-engine";

type FlowState = "idle" | "recording" | "processing" | "complete" | "error";

/**
 * Dictation overlay — a slim dark floating panel,
 * horizontally centered. The bar only ever appears once the user has
 * triggered a voice shortcut, so it mounts in "recording" state and
 * shows the waveform immediately. State transitions arrive via Tauri
 * events as the recorder progresses through processing → complete/error.
 *
 * Events:
 *   - `voice:state-change` { state: "idle"|"recording"|"processing"|"complete"|"error" }
 *   - `voice:audio-level` { level: number } (0-1) for waveform visualization
 */
export function FlowBar() {
  // Default to "recording" not "idle" — there's a race between the Rust
  // window opening and the React listener registering, so a default of
  // "idle" caused the bar to flash an "EN" language pill that never went
  // away if the start event was missed.
  const [state, setState] = useState<FlowState>("recording");
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
        setState(ev.payload.state);
      }),
    );

    trackListen(
      onAudioLevel(({ level }) => {
        levelRef.current = Math.max(0, Math.min(1, level));
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

    const BAR_COUNT = 14;
    const BAR_WIDTH = 2;
    const BAR_GAP = 3;

    function draw() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const logicalW = BAR_COUNT * (BAR_WIDTH + BAR_GAP) - BAR_GAP;
      const logicalH = 18;
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
        const phase = Math.sin(now / 200 + i * 0.6) * 0.5 + 0.5;
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

  const handleCancel = () => {
    // Broadcast to the popover webview where voice-dictation.ts lives —
    // it will abort any in-flight transcribe, stop recording, hide the
    // bar without pasting text, and own the delayed defensive re-hide
    // (gated on no new session having started since) so a fast re-press
    // right after cancel doesn't hide a brand-new session's bar (R21).
    emit("voice:cancel").catch(() => {});
  };

  return (
    <div className="flow-bar-root">
      {/* Pill is ALWAYS mounted — when state goes idle we fade the
          opacity to 0 (see CSS) instead of removing it from the DOM.
          Inner content keeps its last frame rendered during the fade
          so the canvas doesn't pop. */}
      <div className={`flow-bar flow-bar-${state}`}>
        {(state === "recording" || state === "idle") && (
          <div className="flow-bar-recording">
            <canvas ref={canvasRef} className="flow-bar-canvas" />
          </div>
        )}

        {state === "processing" ? (
          <div className="flow-bar-processing">
            <span className="flow-bar-shimmer">Cleaning up...</span>
          </div>
        ) : null}

        {state === "error" ? (
          <div className="flow-bar-processing">
            <span className="flow-bar-error">Could not transcribe</span>
          </div>
        ) : null}

        {(state === "recording" || state === "processing") && (
          <button
            type="button"
            className="flow-bar-cancel"
            onClick={handleCancel}
            aria-label="Cancel dictation"
            title="Cancel"
          >
            <IconX size={12} stroke={2.5} />
          </button>
        )}
      </div>
    </div>
  );
}
