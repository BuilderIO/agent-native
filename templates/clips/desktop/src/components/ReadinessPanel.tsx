import {
  IconChevronRight,
  IconChevronDown,
  IconCircleCheck,
  IconCircleOff,
  IconRefresh,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { useState, useCallback, useEffect } from "react";

import { isMacPlatform } from "../lib/platform";

type CaptureMode = "screen" | "screen-camera" | "camera";
type MacosPrivacyPane =
  | "camera"
  | "microphone"
  | "screen"
  | "speech"
  | "accessibility"
  | "input-monitoring";

type PermissionStatuses = {
  screen: boolean;
  camera: boolean;
  microphone: boolean;
  speech: boolean;
  accessibility: boolean;
  inputMonitoring: boolean;
};

type ReadinessItem = {
  label: string;
  detail: string;
  pane: MacosPrivacyPane;
  active: boolean;
  macosOnly?: boolean;
};

function readinessItems({
  mode,
  cameraOn,
  micOn,
  includeFnMonitoring,
  includeVoicePaste,
}: {
  mode: CaptureMode;
  cameraOn: boolean;
  micOn: boolean;
  includeFnMonitoring: boolean;
  includeVoicePaste: boolean;
}): ReadinessItem[] {
  const mac = isMacPlatform();
  const items: ReadinessItem[] = [
    {
      label: "Screen Recording",
      detail: "Needed for screen or window capture.",
      pane: "screen",
      active: mode !== "camera",
      macosOnly: true,
    },
    {
      label: "Microphone",
      detail: "Needed when the mic is on.",
      pane: "microphone",
      active: micOn,
    },
    {
      label: "Speech Recognition",
      detail: "Used for native transcripts.",
      pane: "speech",
      active: micOn,
      macosOnly: true,
    },
    {
      label: "Camera",
      detail: "Needed when camera is on.",
      pane: "camera",
      active: mode !== "screen" && cameraOn,
    },
    {
      label: "Accessibility",
      detail: "Needed to paste dictated text into other apps.",
      pane: "accessibility",
      active: includeVoicePaste,
      macosOnly: true,
    },
    {
      label: "Input Monitoring",
      detail: "Only needed for the Fn dictation shortcut.",
      pane: "input-monitoring",
      active: includeFnMonitoring,
      macosOnly: true,
    },
  ];

  return items.filter((item) => item.active && (!item.macosOnly || mac));
}

function statusForPane(
  pane: MacosPrivacyPane,
  statuses: PermissionStatuses | null,
): boolean | null {
  if (!statuses) return null;
  const map: Record<MacosPrivacyPane, boolean> = {
    screen: statuses.screen,
    camera: statuses.camera,
    microphone: statuses.microphone,
    speech: statuses.speech,
    accessibility: statuses.accessibility,
    "input-monitoring": statuses.inputMonitoring,
  };
  return map[pane];
}

export function ReadinessPanel({
  mode,
  cameraOn,
  micOn,
  includeFnMonitoring,
  includeVoicePaste,
  open,
  onOpenChange,
  onOpenPermission,
}: {
  mode: CaptureMode;
  cameraOn: boolean;
  micOn: boolean;
  includeFnMonitoring: boolean;
  includeVoicePaste: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenPermission: (pane: MacosPrivacyPane) => void;
}) {
  const mac = isMacPlatform();
  const items = readinessItems({
    mode,
    cameraOn,
    micOn,
    includeFnMonitoring,
    includeVoicePaste,
  });

  const [statuses, setStatuses] = useState<PermissionStatuses | null>(null);
  const [checking, setChecking] = useState(false);

  const checkStatuses = useCallback(async () => {
    setChecking(true);
    try {
      const result = await invoke<PermissionStatuses>(
        "check_permission_statuses",
      );
      setStatuses(result);
    } catch {
      // Non-macOS or command not available — leave statuses null
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (open && !statuses && mac) checkStatuses();
  }, [open, statuses, mac, checkStatuses]);

  return (
    <div className={`readiness ${open ? "readiness-open" : ""}`}>
      <button
        type="button"
        className="readiness-summary"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <span className="readiness-title">Permissions</span>
        <span className="readiness-action">
          {open ? "Hide" : "Review"}
          {open ? (
            <IconChevronDown size={11} stroke={2.5} />
          ) : (
            <IconChevronRight size={11} stroke={2.5} />
          )}
        </span>
      </button>
      {open ? (
        <div className="readiness-list">
          {items.length ? (
            items.map((item) => {
              const granted = statusForPane(item.pane, statuses);
              return (
                <div className="readiness-item" key={item.pane}>
                  <div className="readiness-item-copy">
                    <span className="readiness-item-title">{item.label}</span>
                    <span className="readiness-item-detail">{item.detail}</span>
                  </div>
                  <div className="readiness-item-actions">
                    {mac ? (
                      <button
                        type="button"
                        className={`readiness-refresh ${checking ? "readiness-refresh-spinning" : ""}`}
                        onClick={checkStatuses}
                        disabled={checking}
                        aria-label="Recheck permissions"
                        title="Recheck"
                      >
                        <IconRefresh size={13} stroke={2} />
                      </button>
                    ) : null}
                    {mac && granted !== null ? (
                      <span
                        className={`readiness-status ${granted ? "readiness-status-ok" : "readiness-status-warn"}`}
                        aria-label={granted ? "Granted" : "Not granted"}
                      >
                        {granted ? (
                          <IconCircleCheck size={16} stroke={2} />
                        ) : (
                          <IconCircleOff size={16} stroke={2} />
                        )}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="readiness-open-button"
                      onClick={() => onOpenPermission(item.pane)}
                    >
                      Open
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="readiness-empty">
              Turn on camera or mic when you need them.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
