import {
  IconCamera,
  IconChevronDown,
  IconMicrophone,
  IconRefresh,
} from "@tabler/icons-react";
import { useMemo } from "react";

import { useMicMeter } from "../hooks/useMicMeter";
import { Switch } from "./Switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "./Tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { useRowMenu } from "./useRowMenu";

// Live mic level meter — the analyser owns the path so silence stays flat and
// the meter disappears with the microphone rather than implying input exists.
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

const DEFAULT_VALUE = "__default__";

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
  const activeLabel =
    current?.label ||
    (selectedId
      ? devices.length > 0
        ? kind === "camera"
          ? "Selected camera unavailable"
          : "Selected mic unavailable"
        : selectedLabel || (kind === "camera" ? "Camera" : "Microphone")
      : kind === "camera"
        ? "Default camera"
        : "Default mic");
  const label = on ? activeLabel : kind === "camera" ? "Camera" : "Microphone";
  const Icon = kind === "camera" ? IconCamera : IconMicrophone;
  const { open, onOpenChange } = useRowMenu();
  const defaultLabel = kind === "camera" ? "Default camera" : "Default mic";
  const accessLabel =
    kind === "camera" ? "Allow camera access" : "Allow microphone access";
  const refreshLabel =
    kind === "camera" ? "Refresh cameras" : "Refresh microphones";
  const selectedValue = selectedId || DEFAULT_VALUE;
  const mediaKindLabel = kind === "camera" ? "camera" : "microphone";

  return (
    <div className={`media-device-row ${!on ? "media-device-row-off" : ""}`}>
      <div className={`row ${on ? "row-on" : "row-off"}`}>
        <span className="row-icon" aria-hidden>
          <Icon size={20} stroke={1.75} />
        </span>
        <div className="row-main">
          <DropdownMenu open={open} onOpenChange={onOpenChange}>
            {on ? (
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="row-button"
                  aria-label={`Choose ${kind}: ${activeLabel}`}
                >
                  <span className="row-label">{activeLabel}</span>
                  {kind === "mic" ? (
                    <MicWave deviceId={selectedId} active={meterActive} />
                  ) : (
                    <span className="row-flex" aria-hidden />
                  )}
                  <IconChevronDown
                    className="row-chev"
                    size={16}
                    stroke={1.75}
                    aria-hidden
                  />
                </button>
              </DropdownMenuTrigger>
            ) : (
              <span
                className="row-button row-button-placeholder row-label-muted"
                aria-disabled="true"
              >
                {label}
              </span>
            )}
            {on ? (
              <DropdownMenuContent
                align="start"
                sideOffset={6}
                data-popover-resize-overlay="true"
                className="recorder-menu w-[216px] rounded-[10px]"
              >
                <DropdownMenuRadioGroup
                  value={selectedValue}
                  onValueChange={(value) => {
                    if (value === DEFAULT_VALUE) onSelect("", "");
                    else {
                      const device = devices.find((d) => d.deviceId === value);
                      if (device) onSelect(device.deviceId, device.label);
                    }
                  }}
                >
                  <DropdownMenuRadioItem value={DEFAULT_VALUE}>
                    {defaultLabel}
                  </DropdownMenuRadioItem>
                  {devices.map((device) => (
                    <DropdownMenuRadioItem
                      key={device.deviceId}
                      value={device.deviceId}
                    >
                      {device.label || label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onRefresh}>
                  <IconRefresh size={16} stroke={1.75} aria-hidden />
                  {devices.length === 0 ? accessLabel : refreshLabel}
                </DropdownMenuItem>
                {kind === "mic" && onSystemAudioToggle ? (
                  <>
                    <DropdownMenuSeparator />
                    <div className="row-menu-setting" role="none">
                      <span className="row-menu-setting-label">
                        Record system audio
                      </span>
                      <Switch
                        on={!!systemAudio}
                        onChange={onSystemAudioToggle}
                        label="Record system audio"
                      />
                    </div>
                  </>
                ) : null}
              </DropdownMenuContent>
            ) : null}
          </DropdownMenu>
        </div>
        <div className="row-trailing-control">
          <Tooltip>
            <TooltipTrigger asChild>
              <Switch
                on={on}
                onChange={onToggle}
                label={kind === "camera" ? "Camera" : "Microphone"}
              />
            </TooltipTrigger>
            <TooltipContent side="left">
              {`${on ? "Turn off" : "Turn on"} ${mediaKindLabel}`}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
