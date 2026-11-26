import { getThemeFamilyInitScript } from "../appearance/theme-family.js";
import { THEME_VAR_NAMES } from "../extensions/theme.js";
import {
  injectedAgentNativeAppId,
  injectedAgentNativeConfig,
} from "./app-config.js";
import {
  getViteDevRecoveryScript,
  shouldInlineViteDevRecoveryScript,
} from "./vite-dev-recovery-script.js";

export type ThemePreference = "light" | "dark" | "system";

/**
 * Apps served from one browser origin share localStorage, so each app keeps
 * its preference under its own key.
 */
export function themeStorageKeyForApp(appId?: string | null): string {
  const normalizedAppId = appId?.trim().toLowerCase();
  return normalizedAppId ? `${normalizedAppId}:theme` : "theme";
}
export type ResolvedTheme = "light" | "dark";

/**
 * The early head script names, on the root element, the storage key it read
 * the preference from. The server renders that script without the compiled app
 * id, so the key can differ from the one the browser bundle would derive.
 */
export const THEME_STORAGE_KEY_ATTRIBUTE = "data-theme-storage-key";

export const EMBEDDED_THEME_UPDATE_MESSAGE = "agent-native-theme-update";
export const EMBEDDED_THEME_CHANGE_EVENT = "agent-native:theme-change";

export interface EmbeddedThemeUpdate {
  type: typeof EMBEDDED_THEME_UPDATE_MESSAGE;
  theme?: ResolvedTheme;
  isDark?: boolean;
  vars?: Record<string, string>;
}

export interface NormalizedEmbeddedThemeUpdate {
  theme: ResolvedTheme;
  vars?: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readThemeVars(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;

  const vars: Record<string, string> = {};
  for (const [name, rawValue] of Object.entries(value)) {
    if (!THEME_VAR_NAMES.some((candidate) => candidate === name)) continue;
    if (typeof rawValue === "string") vars[name] = rawValue;
  }
  return Object.keys(vars).length > 0 ? vars : undefined;
}

export function parseEmbeddedThemeUpdate(
  value: unknown,
): NormalizedEmbeddedThemeUpdate | null {
  if (!isRecord(value)) return null;
  if (
    value.type !== EMBEDDED_THEME_UPDATE_MESSAGE &&
    value.type !== EMBEDDED_THEME_CHANGE_EVENT
  ) {
    return null;
  }

  const theme =
    value.theme === "light" || value.theme === "dark"
      ? value.theme
      : typeof value.isDark === "boolean"
        ? value.isDark
          ? "dark"
          : "light"
        : null;
  if (!theme) return null;

  const vars = readThemeVars(value.vars);
  return vars ? { theme, vars } : { theme };
}

export function buildEmbeddedThemeUpdate(
  theme: ResolvedTheme,
  vars?: Record<string, string>,
): EmbeddedThemeUpdate {
  return {
    type: EMBEDDED_THEME_UPDATE_MESSAGE,
    theme,
    isDark: theme === "dark",
    ...(vars ? { vars } : {}),
  };
}

export function applyEmbeddedThemeUpdate(
  root: HTMLElement,
  update: NormalizedEmbeddedThemeUpdate,
): void {
  const isDark = update.theme === "dark";
  root.classList.toggle("dark", isDark);
  root.classList.toggle("light", !isDark);
  root.setAttribute("data-theme", update.theme);
  root.style.colorScheme = update.theme;

  for (const [name, value] of Object.entries(update.vars ?? {})) {
    root.style.setProperty(name, value);
  }
}

function normalizeDefaultTheme(theme: ThemePreference): ThemePreference {
  if (theme === "light" || theme === "dark" || theme === "system") {
    return theme;
  }
  return "system";
}

export function getThemeInitScript(
  defaultTheme: ThemePreference = "system",
  enableSystem = true,
  appId?: string,
  storage: { storageKey?: string; legacyStorageKey?: string } = {},
) {
  const safeDefaultTheme = normalizeDefaultTheme(defaultTheme);
  const systemEnabled = enableSystem ? "true" : "false";
  const themeFamilyAppId = appId ?? injectedAgentNativeAppId() ?? undefined;
  const themeFamilyConfig = injectedAgentNativeConfig().themeFamily;
  const resolvedStorageKey =
    storage.storageKey ?? themeStorageKeyForApp(themeFamilyAppId);
  const resolvedLegacyStorageKey =
    storage.legacyStorageKey ??
    (resolvedStorageKey === "theme" ? null : "theme");
  const storageKey = JSON.stringify(resolvedStorageKey);
  const legacyStorageKey = JSON.stringify(resolvedLegacyStorageKey);

  const themeScript = `${getThemeFamilyInitScript(themeFamilyAppId, themeFamilyConfig)}\n(function(){function m(){var d={};return{get length(){return Object.keys(d).length},key:function(i){return Object.keys(d)[i]||null},getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[String(k)]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}}}}function s(n){try{var x=window[n],p='__an_storage_probe__';x.setItem(p,'1');x.removeItem(p)}catch(e){try{Object.defineProperty(window,n,{configurable:true,value:m()})}catch(_){}}}s('localStorage');s('sessionStorage');try{var defaultTheme=${JSON.stringify(safeDefaultTheme)};var enableSystem=${systemEnabled};var key=${storageKey},legacyKey=${legacyStorageKey};var stored=window.localStorage.getItem(key);var validStored=stored==='light'||stored==='dark'||stored==='system'||stored==='auto';if(legacyKey&&legacyKey!==key){var legacy=window.localStorage.getItem(legacyKey);if(legacy==='light'||legacy==='dark'||legacy==='system'||legacy==='auto'){stored=legacy;validStored=true}}var mode=validStored?stored:defaultTheme;if(mode==='auto')mode='system';if(!enableSystem&&mode==='system')mode=defaultTheme==='system'?'light':defaultTheme;if(!validStored){window.localStorage.removeItem(key)}else if(window.localStorage.getItem(key)!==mode){window.localStorage.setItem(key,mode)}if(legacyKey&&legacyKey!==key){window.localStorage.removeItem(legacyKey)}var prefersDark=enableSystem&&mode==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='system'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.setAttribute('data-theme-storage-key',key);root.classList.remove('light','dark');root.classList.add(resolved);root.setAttribute('data-theme',resolved);root.style.colorScheme=resolved;var appearance=window.localStorage.getItem('appearance');var appearanceValid=appearance==='warm'||appearance==='ocean'||appearance==='forest'||appearance==='rose'||appearance==='slate';if(appearanceValid){root.setAttribute('data-appearance',appearance)}else{root.removeAttribute('data-appearance');if(appearance!==null)window.localStorage.removeItem('appearance')}}catch(e){document.documentElement.setAttribute('data-theme-status','unreadable')}})();`;
  // Keep this a direct `import.meta.env?.DEV` read (no alias): only then can the
  // bundler fold it and drop the dev recovery script from production client
  // bundles. `env` is optional because the production SSR build loads core
  // unbundled, where `import.meta.env` is undefined and `.DEV` would throw.
  if (
    !(import.meta as { env?: { DEV?: boolean } }).env?.DEV ||
    !shouldInlineViteDevRecoveryScript()
  )
    return themeScript;
  return `${themeScript}\n${getViteDevRecoveryScript()}`;
}

export const themeInitScript = getThemeInitScript();
