import { useT } from "@agent-native/core/client/i18n";
import { useCallback, useMemo } from "react";

import { useCanManageStorage } from "@/hooks/use-can-manage-storage";
import {
  reportImageUploadFailure,
  type StorageSetupLabels,
} from "@/lib/upload-toast";

/** Mail's storage setup messages and buttons, in the viewer's language. */
export function useStorageSetupLabels(): StorageSetupLabels {
  const t = useT();
  return useMemo(
    () => ({
      builderRefused: t("mail.toasts.storageBuilderRefused"),
      storageRefused: t("mail.toasts.storageRefused"),
      storageNotConfigured: t("mail.toasts.storageNotConfigured"),
      openStorageSettings: t("mail.toasts.openStorageSettings"),
      reconnectBuilder: t("mail.toasts.reconnectBuilderStorage"),
      useOwnStorage: t("mail.toasts.useOwnStorage"),
      builderRefusedAskAdmin: t("mail.toasts.storageBuilderRefusedAskAdmin"),
      storageRefusedAskAdmin: t("mail.toasts.storageRefusedAskAdmin"),
      storageNotConfiguredAskAdmin: t(
        "mail.toasts.storageNotConfiguredAskAdmin",
      ),
      connectBuilder: t("mail.toasts.connectBuilderStorage"),
    }),
    [t],
  );
}

/**
 * `reportImageUploadFailure` for this viewer, for image uploads outside the
 * composers, such as an image block or a signature.
 */
export function useReportImageUploadFailure(): (
  error: unknown,
  label: string,
) => void {
  const labels = useStorageSetupLabels();
  const canManageStorage = useCanManageStorage();
  return useCallback(
    (error: unknown, label: string) =>
      reportImageUploadFailure(error, label, labels, canManageStorage),
    [labels, canManageStorage],
  );
}
