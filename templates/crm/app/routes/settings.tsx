import { ChangelogSettingsCard } from "@agent-native/core/client/changelog";
import { LanguagePicker, useT } from "@agent-native/core/client/i18n";
import {
  SettingsGroup,
  SettingsRow,
  SettingsTabsPage,
  useAgentSettingsTabs,
  type SettingsTabItem,
} from "@agent-native/core/client/settings";
import {
  IconAdjustments,
  IconColumns3,
  IconListDetails,
  IconPlugConnected,
  IconWaveSine,
} from "@tabler/icons-react";
import { useMemo } from "react";
import { useLocation } from "react-router";

import { IntelligenceSettings } from "@/components/crm/IntelligenceSettings";
import { AdvancedSettings } from "@/components/crm/settings/AdvancedSettings";
import { ConnectionSettings } from "@/components/crm/settings/ConnectionSettings";
import { FieldsSettings } from "@/components/crm/settings/FieldsSettings";
import { ListsSettings } from "@/components/crm/settings/ListsSettings";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: "CRM settings" }];
}

/**
 * `/settings/<section>` deep links. `connections` is the shared workspace tab
 * and `connection` is the CRM one, so the segment is matched exactly rather
 * than by substring.
 */
const SETTINGS_SECTIONS: readonly string[] = [
  "fields",
  "lists",
  "intelligence",
  "connection",
  "connections",
  "advanced",
];

function sectionFromPath(pathname: string): string {
  const section = pathname.split("/settings/")[1]?.split("/")[0] ?? "";
  return SETTINGS_SECTIONS.includes(section) ? section : "general";
}

export default function SettingsRoute() {
  const t = useT();
  const location = useLocation();
  const agentSettingsTabs = useAgentSettingsTabs();
  const tabs = useMemo<SettingsTabItem[]>(
    () => [
      {
        id: "connection",
        label: t("connection.tab"),
        icon: IconPlugConnected,
        keywords: "provider hubspot salesforce native mode mirror sync",
        content: <ConnectionSettings />,
      },
      {
        id: "fields",
        label: t("fields.tab"),
        icon: IconColumns3,
        keywords:
          "attributes schema columns slug type authority options status select stage",
        content: <FieldsSettings />,
      },
      {
        id: "lists",
        label: t("lists.tab"),
        icon: IconListDetails,
        keywords: "lists entries pipeline workflow stage board",
        content: <ListsSettings />,
      },
      {
        id: "intelligence",
        label: t("intelligence.tab"),
        icon: IconWaveSine,
        keywords: "signals trackers keywords smart detectors call evidence",
        content: <IntelligenceSettings />,
      },
      {
        id: "advanced",
        label: t("advanced.tab"),
        icon: IconAdjustments,
        group: "workspace",
        keywords: "danger reset reconfigure retention archive delete",
        content: <AdvancedSettings />,
      },
      ...agentSettingsTabs,
    ],
    [agentSettingsTabs, t],
  );

  return (
    <SettingsTabsPage
      defaultTab={sectionFromPath(location.pathname)}
      extraTabs={tabs}
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
      whatsNew={
        <div className="mx-auto w-full max-w-2xl">
          <ChangelogSettingsCard markdown={changelog} />
        </div>
      }
    />
  );
}
