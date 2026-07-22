import { ChangelogSettingsCard } from "@agent-native/core/client/changelog";
import {
  SettingsTabsPage,
  useAgentSettingsTabs,
  type SettingsTabItem,
} from "@agent-native/core/client/settings";
import { IconWaveSine } from "@tabler/icons-react";
import { useMemo } from "react";
import { useLocation } from "react-router";

import { IntelligenceSettings } from "@/components/crm/IntelligenceSettings";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: "CRM settings" }];
}

export default function SettingsRoute() {
  const location = useLocation();
  const agentSettingsTabs = useAgentSettingsTabs();
  const tabs = useMemo<SettingsTabItem[]>(
    () => [
      {
        id: "intelligence",
        label: "Intelligence",
        icon: IconWaveSine,
        keywords: "signals trackers keywords smart detectors call evidence",
        content: <IntelligenceSettings />,
      },
      ...agentSettingsTabs,
    ],
    [agentSettingsTabs],
  );
  const defaultTab = location.pathname.includes("connections")
    ? "connections"
    : location.pathname.includes("intelligence")
      ? "intelligence"
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
