import {
  getAgentSettingsSearchTabs,
  type SettingsSearchEntry,
} from "@agent-native/core/client/settings";
import {
  buildSettingsEntryRoute,
  buildSettingsRoute,
} from "@agent-native/core/navigation";

interface SettingsCommandItem {
  id: string;
  label: string;
  keywords: string;
  href: string;
}

type Translate = (key: string) => string;

/** Analytics' own areas on its General page in the redesigned Settings. */
export const ANALYTICS_SETTINGS_AREAS = {
  alerts: "alerts",
  dataSources: "data-sources",
} as const;

export const ALERTS_KEYWORDS =
  "alerts rules notifications thresholds triggers monitoring";

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

/** Rows on the Data sources area (`/settings/app/data-sources`). */
export function buildAnalyticsDataSourcesSearchEntries(
  t: Translate,
): SettingsSearchEntry[] {
  return [
    {
      id: "analytics-credentials",
      label: t("settings.credentials"),
      keywords: "data sources api keys manage credentials",
      hash: "credentials",
    },
  ];
}

/** Rows on the redesigned Notifications page. */
export function buildAnalyticsNotificationsSearchEntries(
  t: Translate,
): SettingsSearchEntry[] {
  return [
    {
      id: "analytics-error-email-notifications",
      label: t("settings.errorEmailNotifications"),
      keywords: "email notifications errors alerts javascript monitoring",
      hash: "error-email-notifications",
    },
    {
      id: "analytics-bell-sound",
      label: t("settings.bellSound"),
      keywords: "bell sound chime audio agent run finished notifications",
      hash: "bell-sound",
    },
  ];
}

function normalizeLabel(label: string): string {
  return label.trim().toLocaleLowerCase();
}

interface CommandTab {
  id: string;
  label: string;
  keywords: string;
  href?: string;
  searchEntries?: readonly SettingsSearchEntry[];
  entryHref?: (entry: SettingsSearchEntry) => string;
}

export interface AnalyticsSettingsCommandOptions {
  /** The `settings-redesign` flag: link to the redesigned pages. */
  redesign?: boolean;
}

export function buildAnalyticsSettingsCommandItems(
  t: Translate,
  generalEntries: SettingsSearchEntry[],
  options: AnalyticsSettingsCommandOptions = {},
): SettingsCommandItem[] {
  const tabs = options.redesign
    ? redesignedCommandTabs(t)
    : legacyCommandTabs(t, generalEntries);
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
    add({
      id: `tab:${tab.id}`,
      label: tab.label,
      keywords: `${tab.keywords} settings`,
      href: tab.href ?? buildSettingsRoute(tab.id),
    });
    for (const entry of tab.searchEntries ?? []) {
      const tabId = entry.tabId ?? tab.id;
      add({
        id: entry.id,
        label: entry.label,
        keywords: `${entry.keywords ?? ""} ${entry.description ?? ""} ${tab.label} settings`,
        href:
          tab.entryHref?.(entry) ??
          buildSettingsEntryRoute(tabId, entry.hash?.replace(/^#/, "")),
      });
    }
  }

  return commands;
}

function legacyCommandTabs(
  t: Translate,
  generalEntries: SettingsSearchEntry[],
): CommandTab[] {
  return [
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
      keywords: ALERTS_KEYWORDS,
    },
    ...getAgentSettingsSearchTabs(),
  ];
}

function redesignedCommandTabs(t: Translate): CommandTab[] {
  const anchored =
    (page: string, sub?: string) => (entry: SettingsSearchEntry) =>
      buildSettingsRoute(page, sub ?? null, {
        anchor: entry.hash?.replace(/^#/, ""),
      });
  return [
    {
      id: "profile",
      label: t("settings.account"),
      keywords: "profile photo avatar email signed in identity",
    },
    {
      id: "app",
      label: "General",
      keywords: "settings preferences configuration",
    },
    {
      id: `app:${ANALYTICS_SETTINGS_AREAS.alerts}`,
      label: t("settings.alertsTitle"),
      keywords: ALERTS_KEYWORDS,
      href: buildSettingsRoute("app", ANALYTICS_SETTINGS_AREAS.alerts),
    },
    {
      id: `app:${ANALYTICS_SETTINGS_AREAS.dataSources}`,
      label: t("navigation.dataSources"),
      keywords: "data sources credentials api keys",
      href: buildSettingsRoute("app", ANALYTICS_SETTINGS_AREAS.dataSources),
      searchEntries: buildAnalyticsDataSourcesSearchEntries(t),
      entryHref: anchored("app", ANALYTICS_SETTINGS_AREAS.dataSources),
    },
    {
      id: "notifications",
      label: t("settings.notificationsTitle"),
      keywords: "notifications email sound bell",
      searchEntries: buildAnalyticsNotificationsSearchEntries(t),
      entryHref: anchored("notifications"),
    },
    // Today's agent tab ids; the shell's redirect table maps them onto
    // the redesigned pages.
    ...getAgentSettingsSearchTabs(),
  ];
}
