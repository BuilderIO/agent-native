import { useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { IconX } from "@tabler/icons-react";

type FlowState = "idle" | "recording" | "processing" | "complete" | "error";

/**
 * Wispr Flow-style dictation overlay — a slim dark floating panel,
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
  const [partialTranscript, setPartialTranscript] = useState("");
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
      listen<{ level: number }>("voice:audio-level", (ev) => {
        levelRef.current = Math.max(0, Math.min(1, ev.payload.level));
      }),
    );

    trackListen(
      listen<{ text: string }>("voice:partial-transcript", (ev) => {
        // Live transcript as the user speaks — rendered above the pill.
        // Empty payload clears the display (sent at session start/end).
        setPartialTranscript(ev.payload.text || "");
      }),
    );

    trackListen(
      listen<{ text: string }>("voice:final-transcript", (ev) => {
        // Final result from the recognizer (only fires after stop is
        // requested). Show it on the bar — the last word lingers there
        // for ~1s before voice-dictation.ts dismisses everything.
        const text = ev.payload.text || "";
        if (text) setPartialTranscript(text);
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
    // it will abort any in-flight transcribe, stop recording, and hide
    // the bar without pasting text.
    emit("voice:cancel").catch(() => {});
  };

  // Show live transcript above the pill while recording / processing,
  // so the user can see the words being recognized in real time. Empties
  // out as soon as the bar closes.
  const showTranscript =
    (state === "recording" || state === "processing") &&
    partialTranscript.length > 0;

  return (
    <div className="flow-bar-root">
      {showTranscript && (
        <div className="flow-bar-transcript">{partialTranscript}</div>
      )}
      <div className={`flow-bar flow-bar-${state}`}>
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
