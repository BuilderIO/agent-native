import { appPath } from "@agent-native/core/client/api-path";
import { buildSettingsRoute } from "@agent-native/core/client/navigation";
import { toast } from "sonner";

import { UploadError } from "./upload";

/**
 * Shows why an upload failed. When storage needs reconnecting, Settings opens
 * in a new tab so the message being written stays where it is.
 */
export function toastUploadFailure(
  error: unknown,
  fallback: string,
  openSettingsLabel: string,
): void {
  const message = error instanceof Error ? error.message : fallback;
  if (error instanceof UploadError && error.storageSetupRequired) {
    toast.error(message, {
      action: {
        label: openSettingsLabel,
        onClick: () =>
          window.open(
            appPath(buildSettingsRoute("model")),
            "_blank",
            "noopener",
          ),
      },
    });
    return;
  }
  toast.error(message);
}
