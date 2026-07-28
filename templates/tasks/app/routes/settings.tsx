import { useT } from "@agent-native/core/client/i18n";
import {
  SettingsTabsPage,
  useAgentSettingsTabs,
} from "@agent-native/core/client/settings";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";

import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `Settings - ${APP_TITLE}` }];
}

export default function SettingsRoute() {
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs();
  useSetPageTitle(t("header.pageSettings"));

  return (
    <SettingsTabsPage
      extraTabs={agentSettingsTabs}
      general={
        <div className="mx-auto w-full max-w-2xl">
          <p className="text-sm leading-6 text-muted-foreground">
            {t("header.pageSettings")}
          </p>
        </div>
      }
    />
  );
}
