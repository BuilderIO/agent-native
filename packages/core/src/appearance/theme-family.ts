export const THEME_FAMILIES = ["agent-native", "original"] as const;

export type ThemeFamily = (typeof THEME_FAMILIES)[number];

export interface ThemeFamilyConfig {
  families?: readonly ThemeFamily[];
  defaultFamily?: ThemeFamily;
}

export interface ResolvedThemeFamilyConfig {
  families: ThemeFamily[];
  defaultFamily: ThemeFamily;
}

export const DEFAULT_THEME_FAMILY: ThemeFamily = "original";
export const THEME_FAMILY_STORAGE_KEY = "theme-family";
export const THEME_FAMILY_ATTRIBUTE = "data-theme-family";
export const THEME_FAMILY_STATUS_ATTRIBUTE = "data-theme-family-status";
export const THEME_FAMILY_APP_STATE_KEY = "theme-family";
export const THEME_FAMILY_SETTING_PREFIX = "theme-family";

export function isThemeFamily(value: unknown): value is ThemeFamily {
  return value === "agent-native" || value === "original";
}

export function resolveThemeFamilyConfig(
  config?: ThemeFamilyConfig | null,
): ResolvedThemeFamilyConfig {
  const configuredFamilies = config?.families ?? [DEFAULT_THEME_FAMILY];
  const families = [...new Set(configuredFamilies.filter(isThemeFamily))];
  if (families.length === 0) families.push(DEFAULT_THEME_FAMILY);

  const defaultFamily =
    isThemeFamily(config?.defaultFamily) &&
    families.includes(config.defaultFamily)
      ? config.defaultFamily
      : (families.find((family) => family === DEFAULT_THEME_FAMILY) ??
        families.at(0) ??
        DEFAULT_THEME_FAMILY);

  return { families, defaultFamily };
}

export function getThemeFamilyUrlOverride(
  search: string,
  families: readonly ThemeFamily[] = THEME_FAMILIES,
): ThemeFamily | null {
  const family = new URLSearchParams(search).get("theme-family");
  return isThemeFamily(family) && families.includes(family) ? family : null;
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

export function getThemeFamilyInitScript(
  appId?: string | null,
  familyConfig?: ThemeFamilyConfig | null,
): string {
  const storageKey = themeFamilyStorageKey(appId ?? undefined);
  const { families: allowedFamilies, defaultFamily } =
    resolveThemeFamilyConfig(familyConfig);
  const families = JSON.stringify(allowedFamilies);

  return `(function(){var root=document.documentElement;var fallback=${JSON.stringify(defaultFamily)};try{var requested=new URLSearchParams(window.location.search).get('theme-family');if(${families}.includes(requested)){root.setAttribute(${JSON.stringify(THEME_FAMILY_ATTRIBUTE)},requested);root.removeAttribute(${JSON.stringify(THEME_FAMILY_STATUS_ATTRIBUTE)});return}var value=window.localStorage.getItem(${JSON.stringify(storageKey)});if(value===null){root.setAttribute(${JSON.stringify(THEME_FAMILY_ATTRIBUTE)},fallback);root.setAttribute(${JSON.stringify(THEME_FAMILY_STATUS_ATTRIBUTE)},'awaiting-app-setting');return}if(${families}.includes(value)){root.setAttribute(${JSON.stringify(THEME_FAMILY_ATTRIBUTE)},value);root.removeAttribute(${JSON.stringify(THEME_FAMILY_STATUS_ATTRIBUTE)});return}root.setAttribute(${JSON.stringify(THEME_FAMILY_ATTRIBUTE)},fallback);root.setAttribute(${JSON.stringify(THEME_FAMILY_STATUS_ATTRIBUTE)},'invalid')}catch(e){root.setAttribute(${JSON.stringify(THEME_FAMILY_ATTRIBUTE)},fallback);root.setAttribute(${JSON.stringify(THEME_FAMILY_STATUS_ATTRIBUTE)},'unreadable')}})();`;
}
