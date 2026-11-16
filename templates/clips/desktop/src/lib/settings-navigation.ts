export const DESKTOP_SETTINGS_TABS = [
  "general",
  "recording",
  "rewind",
  "meetings",
  "dictation",
  "labs",
  "advanced",
] as const;

export type DesktopSettingsTab = (typeof DESKTOP_SETTINGS_TABS)[number];

export function initialDesktopSettingsTab(
  tab?: DesktopSettingsTab,
): DesktopSettingsTab {
  return tab ?? "general";
}

export function visibleDesktopSettingsTabs(labs: {
  meetings: boolean;
  dictation: boolean;
}): DesktopSettingsTab[] {
  return DESKTOP_SETTINGS_TABS.filter(
    (tab) =>
      (tab !== "meetings" || labs.meetings) &&
      (tab !== "dictation" || labs.dictation),
  );
}

export function asDesktopSettingsTab(
  value: string | undefined,
): DesktopSettingsTab | undefined {
  return DESKTOP_SETTINGS_TABS.find((tab) => tab === value);
}
