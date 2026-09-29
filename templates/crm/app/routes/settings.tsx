import { ChangelogSettingsCard } from "@agent-native/core/client/changelog";
import { useT } from "@agent-native/core/client/i18n";
import {
  SettingsTabsPage,
  useAgentSettingsTabs,
  type SettingsAppArea,
} from "@agent-native/core/client/settings";
import {
  IconAdjustments,
  IconColumns3,
  IconListDetails,
  IconPlugConnected,
  IconWaveSine,
  type Icon,
} from "@tabler/icons-react";
import { useMemo, type ReactNode } from "react";

import { IntelligenceSettings } from "@/components/crm/IntelligenceSettings";
import { AdvancedSettings } from "@/components/crm/settings/AdvancedSettings";
import { ConnectionSettings } from "@/components/crm/settings/ConnectionSettings";
import { FieldsSettings } from "@/components/crm/settings/FieldsSettings";
import { ListsSettings } from "@/components/crm/settings/ListsSettings";

import changelog from "../../CHANGELOG.md?raw";
import {
  CRM_SETTINGS_AREA_IDS,
  type CrmSettingsAreaId,
} from "../../shared/crm-navigation";

export function meta() {
  return [{ title: "CRM settings" }];
}

interface CrmSettingsArea {
  labelKey: string;
  icon: Icon;
  keywords: string;
  render: () => ReactNode;
}

/**
 * CRM's own settings, in order, shown as tabs on CRM › General, where the tab
 * already names the panel.
 */
const CRM_SETTINGS_AREAS: Record<CrmSettingsAreaId, CrmSettingsArea> = {
  connection: {
    labelKey: "connection.tab",
    icon: IconPlugConnected,
    keywords: "provider hubspot salesforce native mode mirror sync",
    render: () => <ConnectionSettings />,
  },
  fields: {
    labelKey: "fields.tab",
    icon: IconColumns3,
    keywords:
      "attributes schema columns slug type authority options status select stage",
    render: () => <FieldsSettings />,
  },
  lists: {
    labelKey: "lists.tab",
    icon: IconListDetails,
    keywords: "lists entries pipeline workflow stage board",
    render: () => <ListsSettings />,
  },
  intelligence: {
    labelKey: "intelligence.tab",
    icon: IconWaveSine,
    keywords: "signals trackers keywords smart detectors call evidence",
    render: () => <IntelligenceSettings />,
  },
  advanced: {
    labelKey: "advanced.tab",
    icon: IconAdjustments,
    keywords: "danger reset reconfigure retention archive delete",
    render: () => <AdvancedSettings />,
  },
};

export default function SettingsRoute() {
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs();

  const appAreas = useMemo<SettingsAppArea[]>(
    () =>
      CRM_SETTINGS_AREA_IDS.map((id) => {
        const area = CRM_SETTINGS_AREAS[id];
        return {
          id,
          label: t(area.labelKey),
          icon: area.icon,
          keywords: area.keywords,
          content: area.render(),
        };
      }),
    [t],
  );

  // Language is on Account › Preferences, and CRM › General holds only core's
  // rows plus CRM's own areas as tabs.
  return (
    <SettingsTabsPage
      extraTabs={agentSettingsTabs}
      appAreas={appAreas}
      mcpAbout={t("settings.mcpAbout")}
      whatsNew={
        <div className="mx-auto w-full max-w-2xl">
          <ChangelogSettingsCard markdown={changelog} />
        </div>
      }
    />
  );
}
