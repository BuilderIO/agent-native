import {
  IconCamera,
  IconCameraOff,
  IconChevronDown,
  IconMicrophone,
  IconMicrophoneOff,
  IconPlayerRecordFilled,
  IconPointerFilled,
  IconVolume,
  IconVolumeOff,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  READY_TO_RECORD_EVENTS,
  cursorEffectsAvailability,
  DEFAULT_CURSOR_EFFECTS,
  onOffLabel,
  sourceLabel,
  type CursorEffectsConfig,
  type ReadyToRecordState,
  type ReadyToRecordToggle,
} from "../lib/ready-to-record";
import { PillLogo } from "./pill-logo";

function StatusValue({ on, dot = false }: { on: boolean; dot?: boolean }) {
  return (
    <span className={on ? "rtr-value rtr-value-on" : "rtr-value"}>
      {dot && on ? <span className="rtr-dot" aria-hidden /> : null}
      {onOffLabel(on)}
    </span>
  );
}

function ColorField({
  label,
  tooltip,
  value,
  disabled,
  onChange,
}: {
  label: string;
  tooltip: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="rtr-color" title={`${tooltip}: ${value}`}>
      <input
        type="color"
        value={value.toLowerCase()}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
      />
      <span>{label}</span>
    </label>
  );
}

export function ReadyToRecord() {
  const [state, setState] = useState<ReadyToRecordState | null>(null);
  const [cursor, setCursor] = useState<CursorEffectsConfig>(
    DEFAULT_CURSOR_EFFECTS,
  );
  const [cursorOptionsOpen, setCursorOptionsOpen] = useState(false);
  const [cursorError, setCursorError] = useState<string | null>(null);
  const closingRef = useRef(false);
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<ReadyToRecordState>(READY_TO_RECORD_EVENTS.state, (event) => {
      setState(event.payload);
    }).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
      emit(READY_TO_RECORD_EVENTS.requestState).catch(() => {});
    });
    invoke<CursorEffectsConfig>("get_cursor_effects")
      .then((config) => {
        if (!cancelled) setCursor(config);
      })
      .catch((error) => {
        console.error("[clips-ready] cursor effects load failed:", error);
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const finish = useCallback((outcome: "start" | "cancel") => {
    if (closingRef.current) return;
    closingRef.current = true;
    emit(READY_TO_RECORD_EVENTS[outcome]).catch(() => {});
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish("cancel");
      } else if (
        event.key === "Enter" &&
        !(event.target instanceof HTMLInputElement)
      ) {
        event.preventDefault();
        finish("start");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [finish]);

  function toggle(target: ReadyToRecordToggle) {
    emit(READY_TO_RECORD_EVENTS.toggle, { target }).catch(() => {});
  }

  function updateCursor(patch: Partial<CursorEffectsConfig>) {
    const next = { ...cursorRef.current, ...patch };
    setCursor(next);
    setCursorError(null);
    invoke<CursorEffectsConfig>("set_cursor_effects", { config: next })
      .then(setCursor)
      .catch((error) => {
        setCursorError(String(error));
      });
  }

  const availability = state
    ? cursorEffectsAvailability(state)
    : { available: true as const };
  const effectsDisabled = !availability.available;
  const highlightOn = !effectsDisabled && cursor.highlightEnabled;
  const clickOn = !effectsDisabled && cursor.clickEnabled;

  return (
    <div className="rtr-root">
      <div className="rtr-panel" role="dialog" aria-label="Ready to record">
        <header className="rtr-header" data-tauri-drag-region>
          <span className="rtr-logo" aria-hidden>
            <PillLogo />
          </span>
          <h1 data-tauri-drag-region>Ready to record to Clips</h1>
        </header>

        <div className="rtr-grid">
          <section
            className={
              effectsDisabled ? "rtr-tile rtr-tile-disabled" : "rtr-tile"
            }
            aria-label="Cursor"
          >
            <div className="rtr-tile-head">
              <IconPointerFilled size={22} aria-hidden />
              <span className="rtr-tile-title">Cursor</span>
              <StatusValue on dot />
            </div>
            <button
              type="button"
              className="rtr-sub"
              disabled={effectsDisabled}
              aria-pressed={highlightOn}
              onClick={() =>
                updateCursor({ highlightEnabled: !cursor.highlightEnabled })
              }
            >
              <span>Highlight:</span>
              <StatusValue on={highlightOn} />
            </button>
            <button
              type="button"
              className="rtr-sub"
              disabled={effectsDisabled}
              aria-pressed={clickOn}
              onClick={() =>
                updateCursor({ clickEnabled: !cursor.clickEnabled })
              }
            >
              <span>Click Animation:</span>
              <StatusValue on={clickOn} />
            </button>
            {effectsDisabled ? (
              <p className="rtr-note">{availability.reason}</p>
            ) : (
              <button
                type="button"
                className="rtr-disclosure"
                aria-expanded={cursorOptionsOpen}
                onClick={() => setCursorOptionsOpen((open) => !open)}
              >
                Cursor effect options
                <IconChevronDown
                  size={14}
                  aria-hidden
                  className={cursorOptionsOpen ? "rtr-chevron-open" : ""}
                />
              </button>
            )}
            {cursorOptionsOpen && !effectsDisabled ? (
              <div className="rtr-colors">
                <ColorField
                  label="Highlight"
                  tooltip="Highlight color"
                  value={cursor.highlightColor}
                  disabled={!cursor.highlightEnabled}
                  onChange={(highlightColor) =>
                    updateCursor({ highlightColor })
                  }
                />
                <ColorField
                  label="Left"
                  tooltip="Left-click color"
                  value={cursor.clickColor}
                  disabled={!cursor.clickEnabled}
                  onChange={(clickColor) => updateCursor({ clickColor })}
                />
                <ColorField
                  label="Right"
                  tooltip="Right-click color"
                  value={cursor.secondaryClickColor}
                  disabled={!cursor.clickEnabled}
                  onChange={(secondaryClickColor) =>
                    updateCursor({ secondaryClickColor })
                  }
                />
              </div>
            ) : null}
            {cursorError ? <p className="rtr-note">{cursorError}</p> : null}
          </section>

          <button
            type="button"
            className="rtr-tile rtr-tile-button"
            aria-pressed={state?.systemAudioOn ?? false}
            disabled={!state}
            onClick={() => toggle("systemAudio")}
          >
            <span className="rtr-tile-head">
              {state?.systemAudioOn ? (
                <IconVolume size={22} aria-hidden />
              ) : (
                <IconVolumeOff size={22} aria-hidden />
              )}
              <span className="rtr-tile-title">System Audio</span>
              <StatusValue on={state?.systemAudioOn ?? false} />
            </span>
          </button>

          <button
            type="button"
            className="rtr-tile rtr-tile-button"
            aria-pressed={state?.cameraOn ?? false}
            disabled={!state}
            onClick={() => toggle("camera")}
          >
            <span className="rtr-tile-head">
              {state?.cameraOn ? (
                <IconCamera size={22} aria-hidden />
              ) : (
                <IconCameraOff size={22} aria-hidden />
              )}
              <span className="rtr-tile-title">Camera</span>
              <StatusValue on={state?.cameraOn ?? false} />
            </span>
            {state?.cameraOn && state.cameraLabel ? (
              <span className="rtr-device">{state.cameraLabel}</span>
            ) : null}
          </button>

          <button
            type="button"
            className="rtr-tile rtr-tile-button"
            aria-pressed={state?.micOn ?? false}
            disabled={!state}
            onClick={() => toggle("mic")}
          >
            <span className="rtr-tile-head">
              {state?.micOn ? (
                <IconMicrophone size={22} aria-hidden />
              ) : (
                <IconMicrophoneOff size={22} aria-hidden />
              )}
              <span className="rtr-tile-title">Microphone</span>
              <StatusValue on={state?.micOn ?? false} />
            </span>
            {state?.micOn && state.micLabel ? (
              <span className="rtr-device">{state.micLabel}</span>
            ) : null}
          </button>
        </div>

        <footer className="rtr-footer">
          <span className="rtr-hint">
            {state ? `${sourceLabel(state.source)} · ` : ""}Esc to cancel
          </span>
          <button
            type="button"
            className="rtr-cancel"
            onClick={() => finish("cancel")}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rtr-record"
            disabled={!state}
            autoFocus
            onClick={() => finish("start")}
          >
            <IconPlayerRecordFilled size={16} aria-hidden />
            Record
          </button>
        </footer>
      </div>
    </div>
  );
}
