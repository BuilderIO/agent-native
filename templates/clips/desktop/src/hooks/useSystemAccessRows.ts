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

  const definitions: SystemAccessDefinition[] = [
    {
      key: "capture",
      label: "Screen recording, microphone, camera",
      description: "Clips cannot capture anything without these",
      panes: ["screen", "microphone", "camera"],
    },
  ];
  if (mac) {
    definitions.push({
      key: "speech",
      label: "Speech recognition",
      description: "On-device transcripts — no audio leaves your Mac",
      panes: ["speech"],
    });
  }
  if (mac && includeVoicePaste) {
    definitions.push({
      key: "accessibility",
      label: "Accessibility",
      description: "Lets dictated text land in the app you were typing in",
      panes: ["accessibility"],
    });
  }
  if (mac && includeFnMonitoring) {
    definitions.push({
      key: "input-monitoring",
      label: "Input Monitoring",
      description: "Only the Fn shortcut needs this",
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
