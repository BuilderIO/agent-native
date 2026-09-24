/**
 * Per-app maturity shown as a badge next to the app name in the app sidebar,
 * the docs app catalog, and the homepage carousel. Flipping one entry here
 * changes every surface at once.
 */

export type AppStatus = "alpha" | "beta";

export const DEFAULT_APP_STATUS: AppStatus = "alpha";

/** Apps whose status differs from `DEFAULT_APP_STATUS`, keyed by app id. */
export const APP_STATUS: Record<string, AppStatus> = {
  // Clips, Design, and Slides move to "beta" at the October launch.
  clips: "alpha",
  design: "alpha",
  slides: "alpha",
};

export function getAppStatus(appId: string | null | undefined): AppStatus {
  if (!appId) return DEFAULT_APP_STATUS;
  return APP_STATUS[appId.trim().toLowerCase()] ?? DEFAULT_APP_STATUS;
}
