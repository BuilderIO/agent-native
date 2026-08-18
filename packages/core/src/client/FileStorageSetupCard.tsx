import { ActionButton } from "@agent-native/toolkit/design-system";

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
        title="Connect Builder for file storage"
        description="Builder keeps uploaded images and files on durable object storage so the agent can reuse them throughout this thread."
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
              Use custom storage keys
              <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                Configure an S3-compatible bucket with a stable public URL.
              </span>
            </ActionButton>
          </div>
        )}
      />
    </div>
  );
}
