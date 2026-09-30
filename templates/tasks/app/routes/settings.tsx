import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import {
  SettingsTabsPage,
  useAgentSettingsTabs,
} from "@agent-native/toolkit/app/settings";

import { APP_TITLE } from "@/lib/app-config";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: `Settings - ${APP_TITLE}` }];
}

export default function SettingsRoute() {
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs({ extensionTools: true });
  useSetPageTitle(t("header.pageSettings"));

  // Settings has no app rows here: core Preferences owns the interface
  // language.
  return (
    <SettingsTabsPage
      extraTabs={agentSettingsTabs}
      whatsNewMarkdown={changelog}
    />
  );
}
