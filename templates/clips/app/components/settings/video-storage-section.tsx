import { useT } from "@agent-native/core/client/i18n";
import {
  BuilderConnectPopover,
  SettingsGroup,
  SettingsRow,
  StorageSettingsForm,
} from "@agent-native/core/client/settings";
import { IconCheck, IconLoader2 } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { SecretStatus } from "@/hooks/use-secret-status";
import type { useVideoStorageStatus } from "@/hooks/use-video-storage-status";

import type { BuilderConnection } from "./types";

export interface VideoStorageSectionProps {
  builder: BuilderConnection;
  secrets: SecretStatus;
  storageStatus: ReturnType<typeof useVideoStorageStatus>;
}

export function VideoStorageSection({
  builder,
  secrets,
  storageStatus,
}: VideoStorageSectionProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  const storageConfigured = !!storageStatus.data?.configured;
  const activeProviderName = storageStatus.data?.activeProvider?.name ?? null;
  const s3Configured = storageStatus.data?.activeProvider?.id === "s3";

  const refresh = () =>
    void Promise.all([storageStatus.refetch(), secrets.refresh()]);

  return (
    <SettingsGroup id="video-storage" title={t("settings.videoStorage")}>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <SettingsRow
          label="Builder.io"
          description={
            builder.loading
              ? t("settings.checkingBuilder")
              : s3Configured && storageConfigured && activeProviderName
                ? t("settings.s3CurrentProvider", {
                    providerName: activeProviderName,
                  })
                : builder.connected
                  ? builder.orgName
                    ? t("settings.builderConnectedFor", {
                        orgName: builder.orgName,
                      })
                    : t("settings.builderConnectedGeneric")
                  : t("settings.builderIncludes")
          }
          control={
            <div className="flex flex-wrap items-center justify-end gap-2">
              {builder.connected ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                  <IconCheck className="h-4 w-4" />
                  {t("common.connected")}
                </span>
              ) : (
                <BuilderConnectPopover
                  flow={builder.connectFlow}
                  onConnect={(provisionAccount) =>
                    builder.start({
                      provisionAccount,
                      trackingSource: "clips_settings_video_storage",
                      trackingFlow: "video_storage",
                    })
                  }
                >
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    disabled={builder.connecting || builder.loading}
                  >
                    {builder.connecting ? (
                      <IconLoader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    {t("settings.connectBuilder")}
                  </Button>
                </BuilderConnectPopover>
              )}
              <CollapsibleTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  {expanded
                    ? t("settings.hideS3")
                    : s3Configured
                      ? t("settings.providerManage")
                      : t("settings.configureS3")}
                </Button>
              </CollapsibleTrigger>
            </div>
          }
        />

        <CollapsibleContent>
          <div className="border-t border-border px-5 py-4">
            <StorageSettingsForm onSaved={refresh} onCleared={refresh} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </SettingsGroup>
  );
}
