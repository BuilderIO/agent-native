import { useCallback, useEffect, useState } from "react";

import {
  permissionStatusForPane,
  readPermissionStatuses,
  requestOrOpenPermission,
  type MacosPrivacyPane,
  type PermissionStatuses,
} from "../lib/permission-status";
import { isMacPlatform } from "../lib/platform";

export type SystemAccessRow = {
  key: string;
  label: string;
  description: string;
  /** `null` means the grant could not be read — never render it as denied. */
  granted: boolean | null;
  onGrant: () => void;
};

type SystemAccessDefinition = {
  key: string;
  label: string;
  description: string;
  panes: MacosPrivacyPane[];
};

/**
 * Collapses the per-pane permission list into the few lines a user acts on:
 * capture as one grant, then only the extras their configuration needs.
 */
export function useSystemAccessRows({
  includeVoicePaste,
  includeFnMonitoring,
  onOpenSettings,
}: {
  includeVoicePaste: boolean;
  includeFnMonitoring: boolean;
  onOpenSettings: (pane: MacosPrivacyPane) => void;
}): SystemAccessRow[] {
  const mac = isMacPlatform();
  const [statuses, setStatuses] = useState<PermissionStatuses | null>(null);

  const recheck = useCallback(() => {
    void readPermissionStatuses().then(setStatuses);
  }, []);

  // Grants are changed in System Settings, outside this window. Re-reading on
  // focus is what stops a row from still demanding "Grant" after the user did.
  useEffect(() => {
    recheck();
    window.addEventListener("focus", recheck);
    return () => window.removeEventListener("focus", recheck);
  }, [recheck]);

  // One row per OS grant, worded exactly like the recorder's readiness panel —
  // the same grant must read as the same thing on both surfaces, and each
  // Grant button must open exactly the pane its row names. The earlier
  // combined capture row walked three panes one click at a time, which read
  // as one grant that mysteriously kept not taking.
  const definitions: SystemAccessDefinition[] = [
    {
      key: "screen",
      label: "Screen Recording",
      description: "Allows Clips to record your screen",
      panes: ["screen"],
    },
    {
      key: "microphone",
      label: "Microphone",
      description: "Allows Clips to access your microphone",
      panes: ["microphone"],
    },
    {
      key: "camera",
      label: "Camera",
      description: "Allows Clips to access your camera",
      panes: ["camera"],
    },
  ];
  if (mac) {
    definitions.push({
      key: "speech",
      label: "Speech Recognition",
      description: "Allows Clips to use speech recognition",
      panes: ["speech"],
    });
  }
  if (mac && includeVoicePaste) {
    definitions.push({
      key: "accessibility",
      label: "Accessibility",
      description: "Allows Clips to control this device to paste dictated text",
      panes: ["accessibility"],
    });
  }
  if (mac && includeFnMonitoring) {
    definitions.push({
      key: "input-monitoring",
      label: "Input Monitoring",
      description: "Allows Clips to detect the Fn key",
      panes: ["input-monitoring"],
    });
  }

  return definitions.map(({ panes, ...definition }) => {
    const results = panes.map((pane) =>
      permissionStatusForPane(pane, statuses),
    );
    const granted = results.some((result) => result === null)
      ? null
      : results.every(Boolean);
    return {
      ...definition,
      granted,
      onGrant: () => {
        const target =
          panes.find(
            (pane) => permissionStatusForPane(pane, statuses) === false,
          ) ?? panes[0];
        void requestOrOpenPermission(target, {
          onOpenSettings,
          onRecheck: recheck,
        });
      },
    };
  });
}
