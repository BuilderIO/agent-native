export const DESKTOP_SETTINGS_TABS = [
  "general",
  "recording",
  "rewind",
  "meetings",
  "dictation",
  "advanced",
] as const;

export type DesktopSettingsTab = (typeof DESKTOP_SETTINGS_TABS)[number];

export function initialDesktopSettingsTab(
  tab?: DesktopSettingsTab,
): DesktopSettingsTab {
  return tab ?? "general";
}

export function asDesktopSettingsTab(
  value: string | undefined,
): DesktopSettingsTab | undefined {
  return DESKTOP_SETTINGS_TABS.find((tab) => tab === value);
}
