import { IconX } from "@tabler/icons-react";
import { emit, listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

import { LiveWaveform } from "../components/live-waveform";

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
 *   - `voice:dictation-preview` { text: string }
 */
export function FlowBar() {
  // Default to "recording" not "idle" — there's a race between the Rust
  // window opening and the React listener registering, so a default of
  // "idle" caused the bar to flash an "EN" language pill that never went
  // away if the start event was missed.
  const [state, setState] = useState<FlowState>("recording");
  const [transcript, setTranscript] = useState("");
  const transcriptRef = useRef<HTMLDivElement | null>(null);

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
        if (ev.payload.state === "recording") setTranscript("");
      }),
    );

    trackListen(
      listen<{ text: string }>("voice:dictation-preview", (ev) => {
        setTranscript(ev.payload.text.trim());
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

  useEffect(() => {
    const preview = transcriptRef.current;
    if (preview) preview.scrollTop = preview.scrollHeight;
  }, [transcript]);

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
      {transcript ? (
        <div
          ref={transcriptRef}
          className="flow-bar-transcript-preview"
          aria-live="polite"
        >
          {transcript}
        </div>
      ) : null}

      {/* Pill is ALWAYS mounted — when state goes idle we fade the
          opacity to 0 (see CSS) instead of removing it from the DOM.
          Inner content keeps its last frame rendered during the fade
          so the canvas doesn't pop. */}
      <div className={`flow-bar flow-bar-${state}`}>
        {(state === "recording" || state === "idle") && (
          <div className="flow-bar-recording">
            <LiveWaveform
              className="flow-bar-meter"
              sources="mic"
              bars={14}
              barGap={3}
            />
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
