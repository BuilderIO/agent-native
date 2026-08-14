export type DesktopSettingsTab =
  | "general"
  | "recording"
  | "meetings"
  | "dictation";

export function initialDesktopSettingsTab(
  tab?: DesktopSettingsTab,
): DesktopSettingsTab {
  return tab ?? "general";
}
