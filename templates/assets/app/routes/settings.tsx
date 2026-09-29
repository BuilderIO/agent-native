import { useT } from "@agent-native/core/client/i18n";
import {
  SettingsTabsPage,
  useAgentSettingsTabs,
  type SettingsSearchEntry,
} from "@agent-native/core/client/settings";
import { CREATIVE_CONTEXT_LIBRARY_LAB } from "@agent-native/creative-context";
import {
  createCreativeContextAgentTab,
  useCreativeContextLab,
} from "@agent-native/creative-context/client";
import { useMemo } from "react";

import { AssetsGeneralGroups } from "@/components/settings/AssetsGeneralGroups";
import { AssetsNotificationSettings } from "@/components/settings/AssetsNotificationSettings";
import { messagesByLocale } from "@/i18n-data";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: messagesByLocale["en-US"].settings.title }];
}

function useAssetsSettingsTabs() {
  const t = useT();
  const creativeContextEnabled = useCreativeContextLab();
  const agentAdditionalTabFactories = useMemo(
    () => (creativeContextEnabled ? [createCreativeContextAgentTab] : []),
    [creativeContextEnabled],
  );
  const agentSettingsTabs = useAgentSettingsTabs({
    agentAdditionalTabFactories,
  });
  const labs = useMemo(
    () => [
      {
        ...CREATIVE_CONTEXT_LIBRARY_LAB,
        displayName: t("creativeContext.share.title"),
        description: t("creativeContext.description"),
      },
    ],
    [t],
  );
  return { agentSettingsTabs, labs };
}

/**
 * Generation and storage on Assets › General, the email switch on Assets ›
 * Notifications. Language lives on core's Account › Preferences, so this page
 * has no language row.
 */
export default function SettingsPage() {
  const t = useT();
  const { agentSettingsTabs, labs } = useAssetsSettingsTabs();
  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "assets-generation-setup",
        label: t("settings.generation"),
        keywords:
          "builder generation image video setup connect gemini openai api key",
        hash: "asset-generation-setup",
      },
      {
        id: "assets-generation-keys",
        label: t("settings.manualKeys"),
        keywords: "manual api key gemini openai provider generation fallback",
        hash: "generation-keys",
      },
      {
        id: "assets-storage",
        label: t("settings.objectStorage"),
        keywords: "storage object storage s3 r2 bucket spaces minio tigris",
        hash: "object-storage",
      },
    ],
    [t],
  );
  const notificationsSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "assets-notifications",
        label: t("settings.emailNotifications"),
        keywords: "email notification generation finished failed alert",
        hash: "notifications",
      },
    ],
    [t],
  );

  return (
    <SettingsTabsPage
      className="h-full"
      extraTabs={agentSettingsTabs}
      labs={labs}
      generalGroups={<AssetsGeneralGroups />}
      generalSearchEntries={generalSearchEntries}
      notifications={<AssetsNotificationSettings />}
      notificationsSearchEntries={notificationsSearchEntries}
      whatsNewMarkdown={changelog}
    />
  );
}
