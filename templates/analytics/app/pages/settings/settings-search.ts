import {
  getAgentSettingsSearchTabs,
  type SettingsSearchEntry,
} from "@agent-native/core/client";

interface SettingsCommandItem {
  id: string;
  label: string;
  keywords: string;
  href: string;
}

type Translate = (key: string) => string;

export function buildAnalyticsGeneralSettingsSearchEntries(
  t: Translate,
  replayStorageConfigured: boolean,
): SettingsSearchEntry[] {
  return [
    {
      id: "analytics-account",
      label: t("settings.account"),
      keywords: "profile email signed in identity",
      hash: "account",
    },
    {
      id: "analytics-credentials",
      label: t("settings.credentials"),
      keywords: "data sources api keys manage credentials",
      hash: "credentials",
    },
    {
      id: "analytics-dashboard-templates",
      label: t("settings.dashboardTemplates"),
      keywords: "templates catalog dashboards",
      hash: "dashboard-templates",
    },
    ...(replayStorageConfigured
      ? [
          {
            id: "analytics-replay-storage",
            label: t("sessions.storageSetupTitle"),
            keywords: "session replay recording storage s3 bucket builder",
            hash: "replay-storage",
          },
        ]
      : []),
    {
      id: "analytics-language",
      label: t("settings.languageTitle"),
      keywords: "language locale translation i18n",
      hash: "language",
    },
    {
      id: "analytics-about",
      label: t("settings.about"),
      keywords: "about version info usage",
      hash: "about",
    },
  ];
}

function normalizeLabel(label: string): string {
  return label.trim().toLocaleLowerCase();
}

export function buildAnalyticsSettingsCommandItems(
  t: Translate,
  generalEntries: SettingsSearchEntry[],
): SettingsCommandItem[] {
  const tabs = [
    {
      id: "general",
      label: "General",
      keywords: "settings preferences configuration",
      searchEntries: generalEntries.filter(
        (entry) => entry.id !== "analytics-language",
      ),
    },
    {
      id: "alerts",
      label: t("settings.alertsTitle"),
      keywords: "alerts rules notifications thresholds triggers monitoring",
    },
    ...getAgentSettingsSearchTabs(),
  ];
  const seenLabels = new Set<string>();
  const commands: SettingsCommandItem[] = [];

  const add = (command: SettingsCommandItem) => {
    const label = normalizeLabel(command.label);
    if (seenLabels.has(label)) return;
    seenLabels.add(label);
    commands.push(command);
  };

  for (const tab of tabs) {
    add({
      id: `tab:${tab.id}`,
      label: tab.label,
      keywords: `${tab.keywords} settings`,
      href: `/settings#${tab.id}`,
    });
    for (const entry of tab.searchEntries ?? []) {
      add({
        id: entry.id,
        label: entry.label,
        keywords: `${entry.keywords ?? ""} ${entry.description ?? ""} ${tab.label} settings`,
        href: `/settings#${entry.hash ?? entry.tabId ?? tab.id}`,
      });
    }
  }

  return commands;
}
