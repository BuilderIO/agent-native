import { ActionButton } from "@agent-native/toolkit/design-system";

import { useT } from "./i18n.js";
import {
  BuilderConnectCard,
  DefaultBuilderConnectCardView,
} from "./setup-connections/BuilderConnectCard.js";

export function FileStorageSetupCard() {
  const t = useT();
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
        render={({ viewModel, className }) => (
          <div className="space-y-2">
            <DefaultBuilderConnectCardView
              viewModel={viewModel}
              className={className}
            />
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
