import { lazy } from "react";

// Lazy so importing `@agent-native/core/client/settings` (every template's
// settings route does) doesn't ship the shell to viewers who don't have the
// `settings-redesign` flag. Render it inside `<Suspense>`.
export const SettingsShell = lazy(() =>
  import("./SettingsShell.js").then((module) => ({
    default: module.SettingsShell,
  })),
);
export type { SettingsShellProps } from "./SettingsShell.js";
export { SettingsShellSkeleton } from "./SettingsShellSkeleton.js";
export {
  canManageOrganizationPages,
  DEFAULT_SETTINGS_PAGE_ID,
  defineSettingsPage,
  getSettingsPages,
  isSettingsPageVisible,
  registerSettingsPages,
  SETTINGS_PAGE_GROUPS,
  SETTINGS_PAGE_IDS,
  sortSettingsPages,
  subscribeSettingsPages,
  unregisterSettingsPage,
  type CoreSettingsPageId,
  type SettingsPageContext,
  type SettingsPageDefinition,
  type SettingsPageGroup,
  type SettingsPageIcon,
  type SettingsPageProps,
  type SettingsPageSearchEntry,
  type SettingsSubpageDefinition,
} from "./registry.js";
export { CORE_SETTINGS_PAGES } from "./core-pages.js";
export {
  createSettingsBridge,
  type SettingsBridge,
  type SettingsBridgeInput,
} from "./bridge.js";
export {
  useSettingsPageHeader,
  useSettingsShell,
  type SettingsPageHeader,
  type SettingsShellContextValue,
} from "./context.js";
export {
  isSettingsPathname,
  resolveSettingsRoute,
  resolveSettingsTabValue,
  SETTINGS_SECTION_STATE_KEY,
  settingsPageHref,
  settingsPagePath,
  type ResolvedSettingsRoute,
  type ResolveSettingsRouteOptions,
  type SettingsLocation,
  type SettingsRoute,
} from "./routing.js";
export {
  buildSettingsSearchIndex,
  searchSettings,
  type SettingsSearchResult,
} from "./search.js";
export {
  getChannelSettingsExtensions,
  registerChannelSettingsExtensions,
  useChannelSettingsExtensions,
  type ChannelSettingsExtension,
  type ChannelSettingsExtensionProps,
} from "../../integrations/channel-extensions.js";
export {
  readSettingsReturnPath,
  rememberSettingsReturnPath,
} from "./return-path.js";
