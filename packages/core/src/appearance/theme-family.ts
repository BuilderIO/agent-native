export const THEME_FAMILIES = ["agent-native", "original"] as const;

export type ThemeFamily = (typeof THEME_FAMILIES)[number];

export const DEFAULT_THEME_FAMILY: ThemeFamily = "original";
export const THEME_FAMILY_STORAGE_KEY = "theme-family";
export const THEME_FAMILY_ATTRIBUTE = "data-theme-family";
export const THEME_FAMILY_STATUS_ATTRIBUTE = "data-theme-family-status";
export const THEME_FAMILY_APP_STATE_KEY = "theme-family";
export const THEME_FAMILY_SETTING_PREFIX = "theme-family";

export function isThemeFamily(value: unknown): value is ThemeFamily {
  return value === "agent-native" || value === "original";
}

export function themeFamilySettingKey(appId?: string): string {
  // Older or standalone action contexts can genuinely omit appId. Keep their
  // setting isolated under one stable fallback rather than borrowing another app's choice.
  if (appId === undefined)
    return `${THEME_FAMILY_SETTING_PREFIX}:__no_app_id__`;

  const normalizedAppId = appId.trim().toLowerCase();
  if (!normalizedAppId) {
    throw new TypeError("Theme family settings require a non-empty appId.");
  }

  return `${THEME_FAMILY_SETTING_PREFIX}:${encodeURIComponent(normalizedAppId)}`;
}

export function themeFamilyStorageKey(appId?: string): string {
  return themeFamilySettingKey(appId);
}

export function themeFamilyAppStateKey(appId?: string): string {
  if (appId === undefined) return `${THEME_FAMILY_APP_STATE_KEY}:__no_app_id__`;

  const normalizedAppId = appId.trim().toLowerCase();
  if (!normalizedAppId) {
    throw new TypeError(
      "Theme family application state requires a non-empty appId.",
    );
  }

  const encodedAppId = Array.from(normalizedAppId, (character) =>
    character.codePointAt(0)!.toString(16),
  ).join("_");
  return `${THEME_FAMILY_APP_STATE_KEY}:${encodedAppId}`;
}

export function getThemeFamilyInitScript(appId?: string | null): string {
  const storageKey = themeFamilyStorageKey(appId ?? undefined);

  return `(function(){var root=document.documentElement;var fallback=${JSON.stringify(DEFAULT_THEME_FAMILY)};try{var value=window.localStorage.getItem(${JSON.stringify(storageKey)});if(value===null){root.setAttribute(${JSON.stringify(THEME_FAMILY_ATTRIBUTE)},fallback);root.setAttribute(${JSON.stringify(THEME_FAMILY_STATUS_ATTRIBUTE)},'awaiting-app-setting');return}if(value==='agent-native'||value==='original'){root.setAttribute(${JSON.stringify(THEME_FAMILY_ATTRIBUTE)},value);root.removeAttribute(${JSON.stringify(THEME_FAMILY_STATUS_ATTRIBUTE)});return}root.setAttribute(${JSON.stringify(THEME_FAMILY_ATTRIBUTE)},fallback);root.setAttribute(${JSON.stringify(THEME_FAMILY_STATUS_ATTRIBUTE)},'invalid')}catch(e){root.setAttribute(${JSON.stringify(THEME_FAMILY_ATTRIBUTE)},fallback);root.setAttribute(${JSON.stringify(THEME_FAMILY_STATUS_ATTRIBUTE)},'unreadable')}})();`;
}
