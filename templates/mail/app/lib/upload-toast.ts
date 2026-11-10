import { appPath } from "@agent-native/core/client/api-path";
import { buildSettingsRoute } from "@agent-native/core/client/navigation";
import { toast } from "sonner";

import { UploadError } from "./upload";

export interface StorageSetupLabels {
  /** Opens Settings › Infrastructure › File uploads and storage. */
  openStorageSettings: string;
  /** Opens Settings › Model, where Builder.io connects. */
  reconnectBuilder: string;
  /** Opens File uploads and storage to set up the workspace's own bucket. */
  useOwnStorage: string;
}

/** Where any workspace storage gets set up: Builder.io or an S3-compatible bucket. */
function storageSettingsHref(): string {
  return appPath(buildSettingsRoute("infra", null, { anchor: "uploads" }));
}

function builderSettingsHref(): string {
  return appPath(buildSettingsRoute("model"));
}

// A new tab keeps the message being written where it is.
function openInNewTab(href: string): void {
  window.open(href, "_blank", "noopener");
}

/**
 * Shows a storage setup failure with the way to fix it, and returns false for
 * any other failure. A refused Builder.io connection offers reconnecting and,
 * as the alternative, the workspace's own storage.
 */
export function toastStorageSetupFailure(
  error: unknown,
  labels: StorageSetupLabels,
): boolean {
  if (!(error instanceof UploadError) || !error.storageSetup) return false;
  if (error.storageSetup === "builder-refused") {
    toast.error(error.message, {
      action: {
        label: labels.reconnectBuilder,
        onClick: () => openInNewTab(builderSettingsHref()),
      },
      cancel: {
        label: labels.useOwnStorage,
        onClick: () => openInNewTab(storageSettingsHref()),
      },
    });
    return true;
  }
  toast.error(error.message, {
    action: {
      label: labels.openStorageSettings,
      onClick: () => openInNewTab(storageSettingsHref()),
    },
  });
  return true;
}

/** Shows why an attachment upload failed. */
export function toastUploadFailure(
  error: unknown,
  fallback: string,
  labels: StorageSetupLabels,
): void {
  if (toastStorageSetupFailure(error, labels)) return;
  toast.error(error instanceof Error ? error.message : fallback);
}
