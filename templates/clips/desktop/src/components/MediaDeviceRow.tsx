import { useMemo } from "react";

import { useMicMeter } from "../hooks/useMicMeter";
import { CameraIcon, CheckIcon, ChevronDown, MicIcon } from "./Icons";
import { Switch } from "./Switch";
import { useRowMenu } from "./useRowMenu";

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      className={`toggle ${on ? "toggle-on" : "toggle-off"}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    >
      {on ? "On" : "Off"}
    </button>
  );
}

// Live mic level meter — a single wave line driven by real audio. The hook
// owns the analyser and writes the path's `d`; the line oscillates around the
// center and flattens when silent.
function MicWave({ deviceId, active }: { deviceId: string; active: boolean }) {
  const pathRef = useMicMeter({ deviceId, active });

  return (
    <span className="mic-wave" aria-hidden>
      <svg
        className="mic-wave-svg"
        viewBox="0 0 100 24"
        preserveAspectRatio="none"
      >
        <path
          ref={pathRef}
          className="mic-wave-path"
          d="M 0 12 L 100 12"
          fill="none"
        />
      </svg>
    </span>
  );
}

export function MediaDeviceRow({
  kind,
  devices,
  selectedId,
  selectedLabel,
  onSelect,
  onRefresh,
  on,
  onToggle,
  systemAudio,
  onSystemAudioToggle,
  meterActive = true,
}: {
  kind: "camera" | "mic";
  devices: MediaDeviceInfo[];
  selectedId: string;
  selectedLabel?: string;
  onSelect: (id: string, label: string) => void;
  onRefresh: () => void;
  on: boolean;
  onToggle: (v: boolean) => void;
  systemAudio?: boolean;
  onSystemAudioToggle?: (v: boolean) => void;
  meterActive?: boolean;
}) {
  const current = useMemo(
    () =>
      selectedId
        ? (devices.find((d) => d.deviceId === selectedId) ?? null)
        : null,
    [devices, selectedId],
  );
  const label =
    // Prefer the live label from the enumerated device.
    current?.label ||
    (selectedId
      ? devices.length > 0
        ? // List is loaded but the saved device isn't in it — genuinely gone.
          kind === "camera"
          ? "Selected camera unavailable"
          : "Selected mic unavailable"
        : // List is still locked (no getUserMedia grant yet this session,
          // e.g. a cold launch). Fall back to the label we persisted with
          // the id last time so the user still sees their device by name.
          selectedLabel || (kind === "camera" ? "Camera" : "Microphone")
      : kind === "camera"
        ? "Default camera"
        : "Default mic");
  const Icon = kind === "camera" ? CameraIcon : MicIcon;

  const { open, setOpen, rowRef } = useRowMenu();

  const disabled = !on;
  const defaultLabel = kind === "camera" ? "Default camera" : "Default mic";
  const accessLabel =
    kind === "camera" ? "Allow camera access" : "Allow microphone access";
  const refreshLabel =
    kind === "camera" ? "Refresh cameras" : "Refresh microphones";

  return (
    <div className={`row ${on ? "row-on" : "row-off"}`} ref={rowRef}>
      <span className="row-icon">
        <Icon />
      </span>
      <button
        type="button"
        className="row-button"
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
        disabled={disabled}
        title={label}
      >
        <span className="row-label">{label}</span>
        {kind === "mic" && on ? (
          <MicWave deviceId={selectedId} active={on && meterActive} />
        ) : (
          <span className="row-flex" aria-hidden />
        )}
        <span className="row-chev" aria-hidden>
          <ChevronDown />
        </span>
      </button>
      <Toggle
        on={on}
        onChange={(v) => {
          if (!v) setOpen(false);
          onToggle(v);
        }}
        label={kind === "camera" ? "Camera" : "Microphone"}
      />
      {open ? (
        <div className="row-menu" role="menu">
          <button
            type="button"
            className={`row-menu-item ${!selectedId ? "selected" : ""}`}
            role="menuitemradio"
            aria-checked={!selectedId}
            onClick={() => {
              onSelect("", "");
              setOpen(false);
            }}
          >
            <span className="row-menu-check" aria-hidden>
              {!selectedId ? <CheckIcon /> : null}
            </span>
            <span className="row-menu-label">{defaultLabel}</span>
          </button>
          {devices.length === 0 ? (
            <button
              type="button"
              className="row-menu-item row-menu-action"
              role="menuitem"
              onClick={() => {
                onRefresh();
                setOpen(false);
              }}
            >
              <span className="row-menu-check" aria-hidden />
              <span className="row-menu-label">{accessLabel}</span>
            </button>
          ) : (
            <>
              {devices.map((d) => {
                const isSelected = !!selectedId && d.deviceId === selectedId;
                return (
                  <button
                    key={d.deviceId}
                    type="button"
                    className={`row-menu-item ${isSelected ? "selected" : ""}`}
                    role="menuitemradio"
                    aria-checked={isSelected}
                    onClick={() => {
                      onSelect(d.deviceId, d.label);
                      setOpen(false);
                    }}
                  >
                    <span className="row-menu-check" aria-hidden>
                      {isSelected ? <CheckIcon /> : null}
                    </span>
                    <span className="row-menu-label">
                      {d.label || (kind === "camera" ? "Camera" : "Microphone")}
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                className="row-menu-item row-menu-action"
                role="menuitem"
                onClick={() => {
                  onRefresh();
                  setOpen(false);
                }}
              >
                <span className="row-menu-check" aria-hidden />
                <span className="row-menu-label">{refreshLabel}</span>
              </button>
            </>
          )}
          {kind === "mic" && onSystemAudioToggle ? (
            <div className="row-menu-toggle">
              <span className="row-menu-toggle-label">Record System audio</span>
              <Switch
                on={!!systemAudio}
                onChange={onSystemAudioToggle}
                label="Record system audio"
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
