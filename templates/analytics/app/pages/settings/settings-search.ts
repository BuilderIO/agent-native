import {
  getAgentSettingsSearchTabs,
  type SettingsSearchEntry,
} from "@agent-native/core/client/settings";
import { buildSettingsRoute } from "@agent-native/core/navigation";

interface SettingsCommandItem {
  id: string;
  label: string;
  keywords: string;
  href: string;
}

type Translate = (key: string) => string;

function buildSettingsEntryRoute(tabId: string, section?: string): string {
  const normalizedSection = section?.replace(/^#/, "").trim();
  if (!normalizedSection || normalizedSection === tabId) {
    return buildSettingsRoute(tabId);
  }
  if (normalizedSection.startsWith("agent:")) {
    return buildSettingsRoute(normalizedSection);
  }
  if (normalizedSection.startsWith(`${tabId}:`)) {
    return buildSettingsRoute(normalizedSection);
  }
  return buildSettingsRoute(`${tabId}:${normalizedSection}`);
}

export function buildAnalyticsGeneralSettingsSearchEntries(
  t: Translate,
  replayStorageConfigured: boolean,
): SettingsSearchEntry[] {
  return [
    {
      id: "analytics-account",
      label: t("settings.account"),
      keywords: "profile photo avatar email signed in identity",
      tabId: "account",
      hash: "account",
    },
    {
      id: "analytics-credentials",
      label: t("settings.credentials"),
      keywords: "data sources api keys manage credentials",
      hash: "credentials",
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
      id: "analytics-error-email-notifications",
      label: t("settings.errorEmailNotifications"),
      keywords: "email notifications errors alerts javascript monitoring",
      hash: "error-email-notifications",
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
  const commandIndexByDestination = new Map<string, number>();
  const commands: SettingsCommandItem[] = [];

  const add = (command: SettingsCommandItem) => {
    const destinationKey = `${normalizeLabel(command.label)}\0${command.href}`;
    const existingIndex = commandIndexByDestination.get(destinationKey);
    if (existingIndex !== undefined) {
      const existing = commands[existingIndex];
      commands[existingIndex] = {
        ...existing,
        // Duplicate destinations can come from the app and shared settings
        // catalogs. Preserve both sources' search phrases and tab context.
        keywords: `${existing.keywords} ${command.keywords}`,
      };
      return;
    }

    commandIndexByDestination.set(destinationKey, commands.length);
    commands.push(command);
  };

  for (const tab of tabs) {
    const entryHref = (entry: SettingsSearchEntry, tabId: string) => {
      const hash = entry.hash?.replace(/^#/, "");
      return buildSettingsEntryRoute(tabId, hash);
    };
    add({
      id: `tab:${tab.id}`,
      label: tab.label,
      keywords: `${tab.keywords} settings`,
      href: buildSettingsRoute(tab.id),
    });
    for (const entry of tab.searchEntries ?? []) {
      const tabId = entry.tabId ?? tab.id;
      add({
        id: entry.id,
        label: entry.label,
        keywords: `${entry.keywords ?? ""} ${entry.description ?? ""} ${tab.label} settings`,
        href: entryHref(entry, tabId),
      });
    }
  }

  return commands;
}
