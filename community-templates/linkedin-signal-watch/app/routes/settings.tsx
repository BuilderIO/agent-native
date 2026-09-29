import { useT } from "@agent-native/core/client/i18n";
import { AccountSettingsCard, SettingsTabsPage, useAgentSettingsTabs } from "@agent-native/toolkit/app/settings";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";

import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `Settings - ${APP_TITLE}` }];
}

// Settings has no app rows here: core Preferences owns the interface
// language.
export default function SettingsRoute() {
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs();
  useSetPageTitle(t("settings.title"));

  return (
    <SettingsTabsPage
      account={<AccountSettingsCard />}
      extraTabs={agentSettingsTabs}
    />
  );
}
