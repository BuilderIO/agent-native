import { ChangelogSettingsCard } from "@agent-native/core/client/changelog";
import {
  SettingsTabsPage,
  useAgentSettingsTabs,
} from "@agent-native/core/client/settings";
import { useLocation } from "react-router";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: "CRM settings" }];
}

export default function SettingsRoute() {
  const location = useLocation();
  const tabs = useAgentSettingsTabs();
  const defaultTab = location.pathname.includes("connections")
    ? "connections"
    : "general";

  return (
    <SettingsTabsPage
      defaultTab={defaultTab}
      extraTabs={tabs}
      general={
        <div className="mx-auto w-full max-w-2xl space-y-3">
          <h1 className="text-xl font-semibold tracking-tight">CRM settings</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Native SQL keeps CRM-owned records local and portable. HubSpot and
            Salesforce use workspace Connections; their mirrors store only
            allow-listed fields, scoped metadata, and bounded evidence
            references.
          </p>
        </div>
      }
      whatsNew={
        <div className="mx-auto w-full max-w-2xl">
          <ChangelogSettingsCard markdown={changelog} />
        </div>
      }
    />
  );
}
