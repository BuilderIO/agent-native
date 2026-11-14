import { appPath } from "@agent-native/core/client/api-path";
import { buildSettingsRoute } from "@agent-native/core/client/navigation";
import { reportWriteFailure } from "@agent-native/core/client/write-failure";
import { toast } from "sonner";

import { UploadError } from "./upload";

export interface StorageSetupLabels {
  /** Builder.io refused Mail's storage connection. */
  builderRefused: string;
  /** The workspace's own bucket refused the upload. */
  storageRefused: string;
  /** No storage is set up. */
  storageNotConfigured: string;
  /** Builder.io refused, for someone who can't change workspace storage. */
  builderRefusedAskAdmin: string;
  /** The bucket refused, for someone who can't change workspace storage. */
  storageRefusedAskAdmin: string;
  /** Nothing is set up, for someone who can't change workspace storage. */
  storageNotConfiguredAskAdmin: string;
  /** Opens Settings › Infrastructure › File uploads and storage. */
  openStorageSettings: string;
  /** Opens Settings › Model, where Builder.io connects. */
  reconnectBuilder: string;
  /** Opens Settings › Model to connect a personal Builder.io account. */
  connectBuilder: string;
  /** Opens File uploads and storage to set up the workspace's own bucket. */
  useOwnStorage: string;
}

/**
 * Where workspace storage gets set up: Builder.io or an S3-compatible bucket.
 * Only owners and admins can open it.
 */
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
 * any other failure. Only organization owners and admins can open File uploads
 * and storage; everyone else is told to ask one, and offered the Builder.io
 * connection they can make for themselves in Settings › Model.
 */
export function toastStorageSetupFailure(
  error: unknown,
  labels: StorageSetupLabels,
  canManageStorage: boolean,
): boolean {
  if (!(error instanceof UploadError) || !error.storageSetup) return false;
  // The server's message is English: it is written for agents.
  const openStorageSettings = () => openInNewTab(storageSettingsHref());
  const openBuilderSettings = () => openInNewTab(builderSettingsHref());
  if (error.storageSetup === "builder-refused") {
    const reconnect = {
      label: labels.reconnectBuilder,
      onClick: openBuilderSettings,
    };
    if (!canManageStorage) {
      toast.error(labels.builderRefusedAskAdmin, { action: reconnect });
      return true;
    }
    toast.error(labels.builderRefused, {
      action: reconnect,
      cancel: { label: labels.useOwnStorage, onClick: openStorageSettings },
    });
    return true;
  }
  if (error.storageSetup === "storage-refused") {
    if (!canManageStorage) {
      toast.error(labels.storageRefusedAskAdmin);
      return true;
    }
    toast.error(labels.storageRefused, {
      action: {
        label: labels.openStorageSettings,
        onClick: openStorageSettings,
      },
    });
    return true;
  }
  if (!canManageStorage) {
    toast.error(labels.storageNotConfiguredAskAdmin, {
      action: { label: labels.connectBuilder, onClick: openBuilderSettings },
    });
    return true;
  }
  toast.error(labels.storageNotConfigured, {
    action: { label: labels.openStorageSettings, onClick: openStorageSettings },
  });
  return true;
}

/** Shows why an attachment upload failed. */
export function toastUploadFailure(
  error: unknown,
  fallback: string,
  labels: StorageSetupLabels,
  canManageStorage: boolean,
): void {
  if (toastStorageSetupFailure(error, labels, canManageStorage)) return;
  toast.error(error instanceof Error ? error.message : fallback);
}

/**
 * Shows why an image upload failed, in the composer or a signature: a storage
 * setup failure gets the fix the viewer can make, and anything else is
 * reported under `label`.
 */
export function reportImageUploadFailure(
  error: unknown,
  label: string,
  labels: StorageSetupLabels,
  canManageStorage: boolean,
): void {
  if (toastStorageSetupFailure(error, labels, canManageStorage)) return;
  reportWriteFailure(error, { label });
}
