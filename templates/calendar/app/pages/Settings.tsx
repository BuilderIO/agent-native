import { ChangelogSettingsCard } from "@agent-native/toolkit/app/changelog";
import {
  AccountSettingsCard,
  SettingsTabsPage,
  useAgentSettingsTabs,
} from "@agent-native/toolkit/app/settings";

import changelog from "../../CHANGELOG.md?raw";
import {
  useCalendarSettingsRedesign,
  useDesktopNotificationPermission,
} from "./settings/CalendarSettingsRedesign";

export default function Settings() {
  const agentSettingsTabs = useAgentSettingsTabs();
  const notificationPermission = useDesktopNotificationPermission();
  const redesigned = useCalendarSettingsRedesign(notificationPermission);

  return (
    <SettingsTabsPage
      account={<AccountSettingsCard />}
      extraTabs={agentSettingsTabs}
      generalSearchEntries={redesigned.generalSearchEntries}
      generalGroups={redesigned.generalGroups}
      appAreas={redesigned.appAreas}
      notifications={redesigned.notifications}
      notificationsSearchEntries={redesigned.notificationsSearchEntries}
      whatsNewMarkdown={changelog}
      whatsNew={
        <div className="mx-auto w-full max-w-2xl">
          <ChangelogSettingsCard markdown={changelog} />
        </div>
      }
    />
  );
}
