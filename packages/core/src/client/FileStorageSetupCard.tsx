import { ActionButton } from "@agent-native/toolkit/design-system";
import { Button } from "@agent-native/toolkit/ui/button";
import { IconCloudUpload } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import {
  fetchFileUploadStatus,
  invalidateClientStatusRequest,
} from "./client-status-requests.js";
import { Dialog, DialogContent, DialogTitle } from "./components/ui/dialog.js";
import { useT } from "./i18n.js";
import { DeferredBuilderConnectPopover as BuilderConnectPopover } from "./settings/deferred-builder-connect-popover.js";
import {
  BuilderConnectCard,
  DefaultBuilderConnectCardView,
} from "./setup-connections/BuilderConnectCard.js";

export interface FileStorageSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected?: () => void;
}

/** Only mount the storage choices after the user asks to upload a file. */
export function FileStorageSetupDialog({
  open,
  onOpenChange,
  onConnected,
}: FileStorageSetupDialogProps) {
  const t = useT();
  const openCustomStorage = () => {
    onOpenChange(false);
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("agent-panel:open-settings", {
        detail: { section: "uploads" },
      }),
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xs gap-3 p-4"
        closeLabel={t("agentChat.common.dismiss")}
      >
        <DialogTitle className="flex items-center gap-2 text-sm font-medium leading-5">
          <IconCloudUpload
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
          {t("onboarding.fileStorage.title")}
        </DialogTitle>
        <BuilderConnectCard
          title={t("onboarding.fileStorage.title")}
          description=""
          trackingSource="file_upload_chat_dialog"
          onConnected={onConnected}
          render={({ viewModel }) => {
            const flow = viewModel.connectFlow;
            const connectButton = (
              <Button
                type="button"
                className="w-full"
                disabled={!flow || viewModel.pending}
                aria-busy={viewModel.pending}
              >
                {viewModel.pending
                  ? t("onboarding.builderConnecting")
                  : t("composer.connectBuilder")}
              </Button>
            );

            return (
              <div className="space-y-2">
                {flow ? (
                  <BuilderConnectPopover
                    flow={flow}
                    defaultProvisionAccount
                    onConnect={(provisionAccount) =>
                      flow.start({ provisionAccount })
                    }
                  >
                    {connectButton}
                  </BuilderConnectPopover>
                ) : (
                  connectButton
                )}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={openCustomStorage}
                >
                  {t("onboarding.fileStorage.custom")}
                </Button>
                {viewModel.error ? (
                  <p className="text-xs text-destructive">{viewModel.error}</p>
                ) : null}
              </div>
            );
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Inline storage setup shown when an attachment cannot be made durable.
 * Builder connect and the custom-key path intentionally share the same
 * surface so the user does not have to understand provider internals first.
 */
export function FileStorageSetupCard() {
  const t = useT();
  const [builderReauthorizationRequired, setBuilderReauthorizationRequired] =
    useState(false);
  const refreshStorageStatus = useCallback(async () => {
    invalidateClientStatusRequest("/_agent-native/file-upload/status");
    const result = await fetchFileUploadStatus<{
      builderReauthorizationRequired?: unknown;
    }>();
    if (result.state === "available") {
      setBuilderReauthorizationRequired(
        result.value?.builderReauthorizationRequired === true,
      );
    }
  }, []);
  useEffect(() => {
    void refreshStorageStatus();
    const refresh = () => void refreshStorageStatus();
    window.addEventListener("agent-engine:configured-changed", refresh);
    return () => {
      window.removeEventListener("agent-engine:configured-changed", refresh);
    };
  }, [refreshStorageStatus]);

  const openCustomStorage = () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("agent-panel:open-settings", {
        detail: { section: "uploads" },
      }),
    );
  };

  return (
    <div className="space-y-2" data-testid="file-storage-setup-card">
      <BuilderConnectCard
        title={t("onboarding.fileStorage.title")}
        description={t("onboarding.fileStorage.description")}
        trackingSource="file_upload_chat_card"
        onConnected={refreshStorageStatus}
        showManage
        render={({ viewModel }) => (
          <div className="space-y-2 rounded-lg border border-border bg-background p-4 shadow-sm">
            <DefaultBuilderConnectCardView
              viewModel={viewModel}
              className="border-0 bg-transparent p-0 shadow-none"
              showManage={!builderReauthorizationRequired}
            />
            {builderReauthorizationRequired && viewModel.connectFlow ? (
              <BuilderConnectPopover
                flow={viewModel.connectFlow}
                onConnect={(provisionAccount) =>
                  viewModel.connectFlow?.start({ provisionAccount })
                }
              >
                <Button type="button" variant="outline" className="w-full">
                  {t("onboarding.fileStorage.reconnectBuilder")}
                </Button>
              </BuilderConnectPopover>
            ) : null}
            <ActionButton
              type="button"
              intent="neutral"
              emphasis="outline"
              size="compact"
              onPress={openCustomStorage}
              className="h-auto w-full justify-start rounded-md px-3 py-2 text-left text-xs font-medium text-foreground"
            >
              {t("onboarding.fileStorage.custom")}
              <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                {t("onboarding.fileStorage.customDescription")}
              </span>
            </ActionButton>
          </div>
        )}
      />
    </div>
  );
}
