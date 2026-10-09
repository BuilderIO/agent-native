import { useT } from "@agent-native/core/client/i18n";
import { DispatchSettingsPage } from "@agent-native/dispatch/routes/pages/settings-page";
import type { SettingsTabItem } from "@agent-native/toolkit/app/settings";
import { Link } from "react-router";

import { messagesByLocale } from "@/i18n-data";

import changelog from "../../CHANGELOG.md?raw";
import { WorkspaceConnectionsContent } from "../settings/workspace-connections-settings.js";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.settings }];
}

export default function SettingsRoute() {
  const t = useT();
  const workspaceConnectionsTab: SettingsTabItem = {
    id: "integrations:workspace-connections",
    label: t("integrations.connectedAccounts"),
    group: "integrations",
    content: <WorkspaceConnectionsContent />,
  };
  return (
    <DispatchSettingsPage
      changelog={changelog}
      additionalSettingsTabs={[workspaceConnectionsTab]}
    />
  );
}
