import {
  buildSettingsEntryRoute,
  buildSettingsRoute,
} from "@agent-native/core/navigation";
import {
  CORE_SETTINGS_PAGES,
  createSettingsBridge,
  isSettingsPageVisible,
  type SettingsPageContext,
  type SettingsSearchEntry,
} from "@agent-native/toolkit/app/settings";

interface SettingsCommandItem {
  id: string;
  label: string;
  keywords: string;
  href: string;
}

type Translate = (key: string) => string;

/** Analytics' own areas on its General page in Settings. */
export const ANALYTICS_SETTINGS_AREAS = {
  alerts: "alerts",
  dataSources: "data-sources",
} as const;

export const ALERTS_KEYWORDS =
  "alerts rules notifications thresholds triggers monitoring";

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

/** Rows on the Notifications page. */
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

/** A viewer with no organization role: organization admin pages stay hidden. */
const MEMBER_PAGE_CONTEXT: SettingsPageContext = {
  role: null,
  isOwner: false,
  isAdmin: false,
  hasOrganization: null,
  soloDeploymentAdmin: false,
  appId: null,
  labs: {},
  flags: {},
};

/**
 * What `pages/Settings.tsx` hands the Settings shell, as far as page
 * visibility reads it. What's new stays out: the palette opens it itself.
 */
function analyticsSettingsBridge() {
  return createSettingsBridge({ notifications: true });
}

/** `pageContext` is who is viewing, for which Settings pages they see. */
export function buildAnalyticsSettingsCommandItems(
  t: Translate,
  pageContext: SettingsPageContext = MEMBER_PAGE_CONTEXT,
): SettingsCommandItem[] {
  const rows = settingsCommandRows(t, pageContext);
  const commandIndexByDestination = new Map<string, number>();
  const commands: SettingsCommandItem[] = [];

  for (const command of rows) {
    const destinationKey = `${normalizeLabel(command.label)}\0${command.href}`;
    const existingIndex = commandIndexByDestination.get(destinationKey);
    if (existingIndex !== undefined) {
      const existing = commands[existingIndex];
      commands[existingIndex] = {
        ...existing,
        keywords: `${existing.keywords} ${command.keywords}`,
      };
      continue;
    }

    commandIndexByDestination.set(destinationKey, commands.length);
    commands.push(command);
  }

  return commands;
}

function tabCommandRows(tab: CommandTab): SettingsCommandItem[] {
  return [
    {
      id: `tab:${tab.id}`,
      label: tab.label,
      keywords: `${tab.keywords} settings`,
      href: tab.href ?? buildSettingsRoute(tab.id),
    },
    ...(tab.searchEntries ?? []).map((entry) => ({
      id: entry.id,
      label: entry.label,
      keywords: `${entry.keywords ?? ""} ${entry.description ?? ""} ${tab.label} settings`,
      href:
        tab.entryHref?.(entry) ??
        buildSettingsEntryRoute(
          entry.tabId ?? tab.id,
          entry.hash?.replace(/^#/, ""),
        ),
    })),
  ];
}

/** Analytics' own rows, right after the core page they live on. */
function analyticsPageRows(
  t: Translate,
  pageId: string,
): SettingsCommandItem[] {
  const anchored =
    (page: string, sub?: string) => (entry: SettingsSearchEntry) =>
      buildSettingsRoute(page, sub ?? null, {
        anchor: entry.hash?.replace(/^#/, ""),
      });
  if (pageId === "app") {
    const areas: CommandTab[] = [
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
    ];
    return areas.flatMap(tabCommandRows);
  }
  if (pageId === "notifications") {
    return buildAnalyticsNotificationsSearchEntries(t).map((entry) => ({
      id: entry.id,
      label: entry.label,
      keywords: `${entry.keywords ?? ""} notifications settings`,
      href: anchored("notifications")(entry),
    }));
  }
  return [];
}

/**
 * Settings' own pages and search rows, under the labels its nav shows, so the
 * palette never names a page Settings no longer has.
 */
function settingsCommandRows(
  t: Translate,
  context: SettingsPageContext,
): SettingsCommandItem[] {
  const bridge = analyticsSettingsBridge();
  const rows: SettingsCommandItem[] = [];
  for (const page of CORE_SETTINGS_PAGES) {
    if (page.href || !isSettingsPageVisible(page, context, bridge)) {
      continue;
    }
    const label = page.labelKey ? t(page.labelKey) : (page.label ?? page.id);
    rows.push({
      id: `tab:${page.id}`,
      label,
      keywords: `${page.keywords ?? ""} settings`,
      href: buildSettingsRoute(page.id),
    });
    for (const entry of page.searchEntries ?? []) {
      const entryLabel = entry.labelKey ? t(entry.labelKey) : entry.label;
      if (!entryLabel) continue;
      rows.push({
        id: `${page.id}:${entry.id}`,
        label: entryLabel,
        keywords: `${entry.keywords ?? ""} ${label} settings`,
        href: buildSettingsRoute(page.id, entry.sub ?? null, {
          anchor: entry.anchor,
        }),
      });
    }
    rows.push(...analyticsPageRows(t, page.id));
  }
  return rows;
}
