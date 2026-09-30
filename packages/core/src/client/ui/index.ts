export {
  buildErrorReportTemplate,
  buildGitHubIssueUrl,
  type ErrorReportDebugItem,
  type ErrorReportTemplateOptions,
} from "../error-reporting.js";
export { getClientSurface, type ClientSurface } from "../client-surface.js";
export {
  applyEmbeddedThemeUpdate,
  buildEmbeddedThemeUpdate,
  EMBEDDED_THEME_CHANGE_EVENT,
  EMBEDDED_THEME_UPDATE_MESSAGE,
  getThemeInitScript,
  parseEmbeddedThemeUpdate,
  themeInitScript,
  type EmbeddedThemeUpdate,
  type NormalizedEmbeddedThemeUpdate,
  type ResolvedTheme,
  type ThemePreference,
} from "../theme.js";
export {
  APPEARANCE_PRESETS,
  applyAppearance,
  getStoredAppearance,
  useAppearance,
  useAppearanceSync,
  type AppearancePresetId,
} from "../appearance.js";
