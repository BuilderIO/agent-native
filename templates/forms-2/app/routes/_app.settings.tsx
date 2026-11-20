import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import {
  AccountSettingsCard,
  SettingsTabsPage,
  useAgentSettingsTabs,
} from "@agent-native/toolkit/app/settings";
import { IconWorld } from "@tabler/icons-react";

import { DomainsSettings } from "@/components/domains/DomainsSettings";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { APP_TITLE } from "@/lib/app-config";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: `Settings - ${APP_TITLE}` }];
}

// Chat has no app rows here: core Preferences owns the interface language.
export default function SettingsRoute() {
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs();
  useSetPageTitle(t("settings.title"));

  return (
    <SettingsTabsPage
      account={
        <div className="flex flex-col gap-8">
          <AccountSettingsCard />
          <AppearanceSettings />
        </div>
      }
      extraTabs={[
        ...agentSettingsTabs,
        {
          id: "domains",
          label: t("forms.domains.title"),
          icon: IconWorld,
          group: "app",
          keywords: "domains custom domain dns cname",
          content: <DomainsSettings />,
        },
      ]}
      whatsNewMarkdown={changelog}
    />
  );
}
