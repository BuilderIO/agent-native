import { useEffect, useMemo, useRef, useState } from "react";
import { CameraIcon, CheckIcon, ChevronDown, MicIcon } from "./Icons";
import { Switch } from "./Switch";

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

function MicWave() {
  return (
    <span className="mic-wave" aria-hidden>
      <span className="bar b1" />
      <span className="bar b2" />
      <span className="bar b3" />
      <span className="bar b4" />
    </span>
  );
}

export function MediaDeviceRow({
  kind,
  devices,
  selectedId,
  onSelect,
  onRefresh,
  on,
  onToggle,
  systemAudio,
  onSystemAudioToggle,
}: {
  kind: "camera" | "mic";
  devices: MediaDeviceInfo[];
  selectedId: string;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  on: boolean;
  onToggle: (v: boolean) => void;
  systemAudio?: boolean;
  onSystemAudioToggle?: (v: boolean) => void;
}) {
  const current = useMemo(
    () =>
      selectedId
        ? (devices.find((d) => d.deviceId === selectedId) ?? null)
        : null,
    [devices, selectedId],
  );
  const label =
    current?.label ||
    (selectedId
      ? kind === "camera"
        ? "Selected camera unavailable"
        : "Selected mic unavailable"
      : kind === "camera"
        ? "Default camera"
        : "Default mic");
  const Icon = kind === "camera" ? CameraIcon : MicIcon;

  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click — native-feeling popover behavior.
  useEffect(() => {
    if (!open) return;
    function onDoc(ev: MouseEvent) {
      const el = rowRef.current;
      if (!el) return;
      if (!el.contains(ev.target as Node)) setOpen(false);
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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
        <span className="row-chev" aria-hidden>
          <ChevronDown />
        </span>
      </button>
      <Toggle
        on={on}
        onChange={onToggle}
        label={kind === "camera" ? "Camera" : "Microphone"}
      />
      {kind === "mic" && on ? <MicWave /> : null}
      {open ? (
        <div className="row-menu" role="menu">
          <button
            type="button"
            className={`row-menu-item ${!selectedId ? "selected" : ""}`}
            role="menuitemradio"
            aria-checked={!selectedId}
            onClick={() => {
              onSelect("");
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
                      onSelect(d.deviceId);
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
