import { TeamPage } from "@agent-native/core/client/org";
import {
  AccountSettingsCard,
  SettingsTabsPage,
  useAgentSettingsTabs,
} from "@agent-native/core/client/settings";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";

import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `Settings - ${APP_TITLE}` }];
}

export default function SettingsRoute() {
  const agentSettingsTabs = useAgentSettingsTabs();
  useSetPageTitle("Settings");

  return (
    <SettingsTabsPage
      account={<AccountSettingsCard />}
      teamLabel="Team"
      extraTabs={agentSettingsTabs}
      general={
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <p className="text-sm leading-6 text-muted-foreground">
            Workspace preferences for this app.
          </p>
        </div>
      }
      team={
        <div className="mx-auto w-full max-w-3xl">
          <TeamPage
            showTitle={false}
            createOrgDescription="Create an organization to invite teammates and share this app."
          />
        </div>
      }
    />
  );
}
