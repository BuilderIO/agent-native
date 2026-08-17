import type { AppConfig } from "@agent-native/shared-app-config";

/**
 * Native tab routes are explicit so an app selected in Settings stays inside
 * the tab shell. Custom apps still use the secure full-screen app route from
 * More until they have a native tab route of their own.
 */
export const APP_ID_TO_ROUTE: Record<string, string> = {
  analytics: "/analytics",
  assets: "/assets",
  brain: "/brain",
  calendar: "/calendar",
  chat: "/chat",
  clips: "/clips",
  content: "/content",
  design: "/design",
  dispatch: "/dispatch",
  forms: "/forms",
  mail: "/mail",
  plan: "/plan",
  slides: "/slides",
};

export const MOBILE_BOTTOM_TAB_LIMIT = 4;

export const MOBILE_DEFAULT_APP_IDS = [
  "mail",
  "calendar",
  "content",
  "analytics",
] as const;

export const LEGACY_MOBILE_DEFAULT_APP_IDS = [
  "content",
  "design",
  "mail",
  "calendar",
] as const;

export function getAppRoute(appId: string): string {
  return APP_ID_TO_ROUTE[appId] ?? `/app/${appId}`;
}

export function supportsMobileTab(appId: string): boolean {
  return appId !== "chat" && appId in APP_ID_TO_ROUTE;
}

export function orderMobileApps<T extends Pick<AppConfig, "id">>(
  apps: readonly T[],
): T[] {
  const preferredOrder = new Map<string, number>(
    MOBILE_DEFAULT_APP_IDS.map((id, index) => [id, index]),
  );
  return [...apps].sort((a, b) => {
    const aIndex = preferredOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bIndex = preferredOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return aIndex - bIndex;
  });
}

export function getDefaultMobileTabAppIds(
  apps: readonly (Pick<AppConfig, "id"> &
    Partial<Pick<AppConfig, "enabled">>)[],
): string[] {
  const eligibleApps = orderMobileApps(
    apps.filter((app) => app.enabled !== false && supportsMobileTab(app.id)),
  );
  const preferredIds = new Set<string>(MOBILE_DEFAULT_APP_IDS);
  const preferred = eligibleApps.filter((app) => preferredIds.has(app.id));
  const remaining = eligibleApps.filter((app) => !preferredIds.has(app.id));
  return [...preferred, ...remaining]
    .slice(0, MOBILE_BOTTOM_TAB_LIMIT)
    .map((app) => app.id);
}

export function filterAvailableMobileTabAppIds(
  selectedIds: readonly string[],
  availableIds: ReadonlySet<string>,
): string[] {
  return [...new Set(selectedIds.filter((id) => availableIds.has(id)))].slice(
    0,
    MOBILE_BOTTOM_TAB_LIMIT,
  );
}

export function toggleMobileTabAppId(
  selectedIds: readonly string[],
  appId: string,
): { ids: string[]; changed: boolean; limitReached: boolean } {
  if (selectedIds.includes(appId)) {
    return {
      ids: selectedIds.filter((id) => id !== appId),
      changed: true,
      limitReached: false,
    };
  }
  if (selectedIds.length >= MOBILE_BOTTOM_TAB_LIMIT) {
    return { ids: [...selectedIds], changed: false, limitReached: true };
  }
  return {
    ids: [...selectedIds, appId],
    changed: true,
    limitReached: false,
  };
}
