import { IconBell } from "@tabler/icons-react";
import type { ReactNode } from "react";

import type {
  SettingsAppArea,
  SettingsSearchEntry,
  SettingsTabItem,
} from "./SettingsTabsPage.js";

export interface AppSettingsTabsInput {
  appAreas?: readonly SettingsAppArea[];
  notifications?: ReactNode;
  notificationsLabel?: string;
  notificationsSearchEntries?: readonly SettingsSearchEntry[];
}

export const NOTIFICATIONS_SETTINGS_TAB_ID = "notifications";

/**
 * `extraTabs` plus the tabs the app-group props stand for, so today's tabs and
 * the redesigned shell read one list: `notifications` becomes the tab the
 * Notifications page claims, and each visible app area a tab placed on the
 * app's General page. A template tab with the same id wins, so a template
 * mid-migration never shows one twice.
 */
export function withAppSettingsTabs(
  extraTabs: readonly SettingsTabItem[] | undefined,
  input: AppSettingsTabsInput,
  notificationsFallbackLabel: string,
): SettingsTabItem[] {
  const tabs = [...(extraTabs ?? [])];
  const taken = new Set(tabs.map((tab) => tab.id));
  if (
    input.notifications != null &&
    !taken.has(NOTIFICATIONS_SETTINGS_TAB_ID)
  ) {
    taken.add(NOTIFICATIONS_SETTINGS_TAB_ID);
    tabs.unshift({
      id: NOTIFICATIONS_SETTINGS_TAB_ID,
      label: input.notificationsLabel ?? notificationsFallbackLabel,
      icon: IconBell,
      group: "app",
      keywords: "notifications email alerts",
      searchEntries: input.notificationsSearchEntries
        ? [...input.notificationsSearchEntries]
        : undefined,
      content: input.notifications,
    });
  }
  for (const area of input.appAreas ?? []) {
    if (area.visible === false || taken.has(area.id)) continue;
    taken.add(area.id);
    tabs.push({
      id: area.id,
      label: area.label,
      icon: area.icon,
      group: "app",
      keywords: area.keywords,
      searchEntries: area.searchEntries,
      settingsPlacement: "app-area",
      content: area.content,
    });
  }
  return tabs;
}
