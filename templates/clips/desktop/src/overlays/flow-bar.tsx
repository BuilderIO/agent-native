import { IconCheck, IconX } from "@tabler/icons-react";
import { emit, listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

import { LiveWaveform } from "../components/live-waveform";

type FlowState =
  | "idle"
  | "recording"
  | "processing"
  | "complete"
  | "copied"
  | "error";
type FlowProcessingStage = "finalizing" | "cleaning" | "pasting";
type FlowStateChangePayload = {
  state: FlowState;
  stage?: FlowProcessingStage;
  startedAtMs?: number;
};

export function FlowBar() {
  // Default to "recording" not "idle" — there's a race between the Rust
  // window opening and the React listener registering, so a default of
  // "idle" caused the bar to flash an "EN" language pill that never went
  // away if the start event was missed.
  const [state, setState] = useState<FlowState>("recording");
  const [processingStage, setProcessingStage] =
    useState<FlowProcessingStage>("finalizing");
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

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
      listen<FlowStateChangePayload>("voice:state-change", (ev) => {
        setState(ev.payload.state);
        if (ev.payload.stage) setProcessingStage(ev.payload.stage);
        if (ev.payload.state === "recording") {
          setStartedAtMs(ev.payload.startedAtMs ?? Date.now());
        }
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
    if (
      startedAtMs === null ||
      (state !== "recording" && state !== "processing")
    ) {
      return;
    }
    const updateElapsed = () => {
      setElapsedMs(Math.max(0, Date.now() - startedAtMs));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 100);
    return () => window.clearInterval(timer);
  }, [startedAtMs, state]);

  const handleCancel = () => {
    emit("voice:cancel").catch(() => {});
  };

  const handleAccept = () => {
    emit("voice:accept").catch(() => {});
  };

  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const formattedElapsed = `${Math.floor(totalSeconds / 60)}:${String(
    totalSeconds % 60,
  ).padStart(2, "0")}`;

  const processingLabel =
    processingStage === "cleaning"
      ? "Cleaning up..."
      : processingStage === "pasting"
        ? "Pasting..."
        : "Finalizing...";
  const stateLabel =
    state === "recording"
      ? "Listening"
      : state === "processing"
        ? processingLabel
        : state === "complete"
          ? "Pasted"
          : state === "copied"
            ? "No text field focused. Saved to history and copied to clipboard."
            : state === "error"
              ? "Could not transcribe"
              : "";

  return (
    <div
      className="flow-bar-root record-pill-scope"
      role="status"
      aria-live="polite"
    >
      {/* Pill is ALWAYS mounted — when state goes idle we fade the
          opacity to 0 (see CSS) instead of removing it from the DOM.
          Inner content keeps its last frame rendered during the fade
          so the canvas doesn't pop. */}
      <div
        className={`flow-bar flow-bar-${state}${state === "recording" ? " flow-bar-listening" : ""}`}
        aria-label={stateLabel || undefined}
      >
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
            <span className="flow-bar-shimmer">{processingLabel}</span>
          </div>
        ) : null}

        {state === "complete" ? (
          <div className="flow-bar-complete">
            <IconCheck size={14} stroke={2.25} aria-hidden="true" />
            <span>Pasted</span>
          </div>
        ) : null}

        {state === "copied" ? (
          <div className="flow-bar-notice">
            <span className="flow-bar-notice-dot" aria-hidden="true" />
            <div className="flow-bar-notice-copy">
              <strong>No text field focused</strong>
              <span>Saved to history · copied to clipboard</span>
            </div>
          </div>
        ) : null}

        {state === "error" ? (
          <div className="flow-bar-processing">
            <span className="flow-bar-error">Could not transcribe</span>
          </div>
        ) : null}

        {state === "recording" ? (
          <div className="flow-bar-controls" aria-label="Dictation controls">
            <button
              type="button"
              className="flow-bar-control flow-bar-cancel"
              onClick={handleCancel}
              aria-label="Cancel dictation"
              title="Cancel dictation"
            >
              <IconX size={16} stroke={2.25} />
            </button>
            <time className="flow-bar-time" dateTime={`PT${elapsedMs / 1000}S`}>
              {formattedElapsed}
            </time>
            <button
              type="button"
              className="flow-bar-control flow-bar-accept"
              onClick={handleAccept}
              aria-label="Accept dictation"
              title="Accept dictation"
            >
              <IconCheck size={16} stroke={2.25} />
            </button>
          </div>
        ) : state === "processing" ? (
          <button
            type="button"
            className="flow-bar-cancel"
            onClick={handleCancel}
            aria-label="Cancel dictation"
            title="Cancel"
          >
            <IconX size={12} stroke={2.5} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
