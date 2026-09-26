import { ChangelogSettingsCard } from "@agent-native/core/client/changelog";
import { LanguagePicker, useT } from "@agent-native/core/client/i18n";
import {
  SettingsGroup,
  SettingsRow,
  SettingsTabsPage,
  useAgentSettingsTabs,
  type SettingsAppArea,
  type SettingsTabItem,
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
import { useLocation } from "react-router";

import { IntelligenceSettings } from "@/components/crm/IntelligenceSettings";
import { AdvancedSettings } from "@/components/crm/settings/AdvancedSettings";
import { ConnectionSettings } from "@/components/crm/settings/ConnectionSettings";
import { FieldsSettings } from "@/components/crm/settings/FieldsSettings";
import { ListsSettings } from "@/components/crm/settings/ListsSettings";
import { useSettingsRedesign } from "@/hooks/use-settings-redesign";

import changelog from "../../CHANGELOG.md?raw";
import {
  CRM_SETTINGS_AREA_IDS,
  type CrmSettingsAreaId,
} from "../../shared/crm-navigation";

export function meta() {
  return [{ title: "CRM settings" }];
}

/**
 * `/settings/<section>` deep links. `integrations` is the shared workspace tab
 * and `connection` is the CRM one, so the segment is matched exactly rather
 * than by substring.
 */
const SETTINGS_SECTIONS: readonly string[] = [
  "fields",
  "lists",
  "intelligence",
  "connection",
  "connections",
  "mcp",
  "advanced",
];

function sectionFromPath(pathname: string): string {
  const section = pathname.split("/settings/")[1]?.split("/")[0] ?? "";
  return SETTINGS_SECTIONS.includes(section) ? section : "integrations";
}

interface CrmSettingsArea {
  labelKey: string;
  icon: Icon;
  keywords: string;
  render: (embedded: boolean) => ReactNode;
}

/**
 * CRM's own settings, in order. Today's Settings shows each as a tab; the
 * redesigned Settings shows them as tabs on CRM › General, where the tab
 * already names the panel.
 */
const CRM_SETTINGS_AREAS: Record<CrmSettingsAreaId, CrmSettingsArea> = {
  connection: {
    labelKey: "connection.tab",
    icon: IconPlugConnected,
    keywords: "provider hubspot salesforce native mode mirror sync",
    render: (embedded) => <ConnectionSettings embedded={embedded} />,
  },
  fields: {
    labelKey: "fields.tab",
    icon: IconColumns3,
    keywords:
      "attributes schema columns slug type authority options status select stage",
    render: (embedded) => <FieldsSettings embedded={embedded} />,
  },
  lists: {
    labelKey: "lists.tab",
    icon: IconListDetails,
    keywords: "lists entries pipeline workflow stage board",
    render: (embedded) => <ListsSettings embedded={embedded} />,
  },
  intelligence: {
    labelKey: "intelligence.tab",
    icon: IconWaveSine,
    keywords: "signals trackers keywords smart detectors call evidence",
    render: (embedded) => <IntelligenceSettings embedded={embedded} />,
  },
  advanced: {
    labelKey: "advanced.tab",
    icon: IconAdjustments,
    keywords: "danger reset reconfigure retention archive delete",
    render: (embedded) => <AdvancedSettings embedded={embedded} />,
  },
};

export default function SettingsRoute() {
  const t = useT();
  const location = useLocation();
  const redesign = useSettingsRedesign().enabled;
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
          content: area.render(true),
        };
      }),
    [t],
  );

  const legacyTabs = useMemo<SettingsTabItem[]>(
    () => [
      ...CRM_SETTINGS_AREA_IDS.map((id): SettingsTabItem => {
        const area = CRM_SETTINGS_AREAS[id];
        return {
          id,
          label: t(area.labelKey),
          icon: area.icon,
          keywords: area.keywords,
          ...(id === "advanced" ? { group: "workspace" } : {}),
          content: area.render(false),
        };
      }),
      ...agentSettingsTabs,
    ],
    [agentSettingsTabs, t],
  );

  const whatsNew = (
    <div className="mx-auto w-full max-w-2xl">
      <ChangelogSettingsCard markdown={changelog} />
    </div>
  );

  if (redesign) {
    // Language is on Account › Preferences, and CRM › General holds only
    // core's rows plus CRM's own areas as tabs.
    return (
      <SettingsTabsPage
        extraTabs={agentSettingsTabs}
        appAreas={appAreas}
        mcpAbout={t("settings.mcpAbout")}
        whatsNew={whatsNew}
      />
    );
  }

  return (
    <SettingsTabsPage
      defaultTab={sectionFromPath(location.pathname)}
      extraTabs={legacyTabs}
      general={
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <div className="space-y-3">
            <h1 className="text-xl font-semibold tracking-tight">
              {t("settings.title")}
            </h1>
            <p className="text-sm leading-6 text-muted-foreground">
              {t("settings.description")}
            </p>
          </div>

          <SettingsGroup>
            <SettingsRow
              id="language"
              label={t("settings.languageTitle")}
              description={t("settings.languageDescription")}
              control={
                <div className="w-56">
                  <LanguagePicker label={t("settings.languageLabel")} />
                </div>
              }
            />
          </SettingsGroup>
        </div>
      }
      whatsNew={whatsNew}
    />
  );
}
