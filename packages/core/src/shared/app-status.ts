export type AppStatus = "alpha" | "beta";

export const DEFAULT_APP_STATUS: AppStatus = "alpha";

export const APP_STATUS: Record<string, AppStatus> = {
  clips: "alpha",
  design: "alpha",
  slides: "alpha",
};

export function getAppStatus(appId: string | null | undefined): AppStatus {
  if (!appId) return DEFAULT_APP_STATUS;
  return APP_STATUS[appId.trim().toLowerCase()] ?? DEFAULT_APP_STATUS;
}
