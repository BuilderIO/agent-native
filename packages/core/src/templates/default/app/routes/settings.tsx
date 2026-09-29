import {
  SettingsTabsPage,
  useAgentSettingsTabs,
} from "@agent-native/core/client/settings";

export function meta() {
  return [{ title: "Settings - {{APP_TITLE}}" }];
}

export default function SettingsPage() {
  const agentSettingsTabs = useAgentSettingsTabs();

  // Settings brings its own Back link, title, and navigation, and core
  // Preferences owns the interface language.
  return (
    <div className="h-dvh">
      <SettingsTabsPage extraTabs={agentSettingsTabs} />
    </div>
  );
}
