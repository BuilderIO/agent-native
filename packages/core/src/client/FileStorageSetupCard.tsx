import { ActionButton } from "@agent-native/toolkit/design-system";
import { Button } from "@agent-native/toolkit/ui/button";
import { useCallback, useEffect, useState } from "react";

import {
  fetchFileUploadStatus,
  invalidateClientStatusRequest,
} from "./client-status-requests.js";
import { useT } from "./i18n.js";
import { DeferredBuilderConnectPopover as BuilderConnectPopover } from "./settings/deferred-builder-connect-popover.js";
import {
  BuilderConnectCard,
  DefaultBuilderConnectCardView,
} from "./setup-connections/BuilderConnectCard.js";

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
