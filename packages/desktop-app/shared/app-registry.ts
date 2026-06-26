import {
  DEFAULT_APPS as SHARED_DEFAULT_APPS,
  TEMPLATE_APPS as SHARED_TEMPLATE_APPS,
  getTemplate as getSharedTemplate,
  getTemplateGatewayAppUrl as getSharedTemplateGatewayAppUrl,
  type AppConfig,
} from "@agent-native/shared-app-config";

const DESKTOP_DEFAULT_EXCLUDED_APP_IDS = new Set(["starter"]);
const DEFAULT_DESKTOP_TEMPLATE_GATEWAY_URL = "http://127.0.0.1:8080";
const DESKTOP_APP_ICON_OVERRIDES: Partial<Record<string, string>> = {
  clips: "VideoPlus",
};
const DESKTOP_DEFAULT_APP_ORDER = [
  "clips",
  "plan",
  "design",
  "content",
  "slides",
  "analytics",
  "mail",
  "forms",
  "brain",
  "assets",
  "calendar",
  "dispatch",
  "chat",
];
const DESKTOP_DEFAULT_APP_ORDER_INDEX = new Map(
  DESKTOP_DEFAULT_APP_ORDER.map((id, index) => [id, index]),
);

function applyDesktopAppOverrides<T extends AppConfig>(app: T): T {
  const icon = DESKTOP_APP_ICON_OVERRIDES[app.id];
  if (!icon || app.icon === icon) return app;
  return { ...app, icon };
}

export function sortDesktopApps<T extends Pick<AppConfig, "id">>(
  apps: T[],
): T[] {
  return [...apps].sort((a, b) => {
    const aIndex =
      DESKTOP_DEFAULT_APP_ORDER_INDEX.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bIndex =
      DESKTOP_DEFAULT_APP_ORDER_INDEX.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return aIndex - bIndex;
  });
}

export const DESKTOP_DEFAULT_APPS = sortDesktopApps(
  SHARED_DEFAULT_APPS.filter(
    (app) => !DESKTOP_DEFAULT_EXCLUDED_APP_IDS.has(app.id),
  ).map(applyDesktopAppOverrides),
);

export const TEMPLATE_APPS = SHARED_TEMPLATE_APPS.map(applyDesktopAppOverrides);

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeLocalDevUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return trimTrailingSlash(url.toString());
  } catch {
    return trimTrailingSlash(value.trim());
  }
}

export function isDefaultDesktopTemplateDevTarget(
  appConfig: Pick<AppConfig, "id" | "devPort" | "devUrl">,
): boolean {
  const template = getSharedTemplate(appConfig.id);
  if (!template) return false;

  const devUrl = appConfig.devUrl?.trim();
  const devPort = appConfig.devPort || template.devPort;
  if (!devUrl) return devPort === template.devPort;

  const normalizedDevUrl = normalizeLocalDevUrl(devUrl);
  return [`http://localhost:${devPort}`, `http://127.0.0.1:${devPort}`].some(
    (defaultUrl) => normalizedDevUrl === normalizeLocalDevUrl(defaultUrl),
  );
}

function getDefaultDesktopTemplateGatewayAppUrl(appId: string): string | null {
  if (!getSharedTemplate(appId)) return null;
  try {
    return trimTrailingSlash(
      new URL(
        `/${appId}`,
        `${DEFAULT_DESKTOP_TEMPLATE_GATEWAY_URL}/`,
      ).toString(),
    );
  } catch {
    return null;
  }
}

export function getDesktopTemplateGatewayAppUrl(appId: string): string | null {
  return (
    getSharedTemplateGatewayAppUrl(appId) ??
    getDefaultDesktopTemplateGatewayAppUrl(appId)
  );
}

// Re-export everything from the shared app config package
export {
  type AppDefinition,
  type AppConfig,
  APP_REGISTRY,
  DEFAULT_APPS,
  FRAME_PORT,
  getAppUrl,
  getTemplateGatewayAppUrl,
  getTemplateGatewayUrl,
  getAppById,
  toAppDefinition,
  generateAppId,
  templateToAppConfig,
  type FrameSettings,
  TEMPLATES,
  visibleTemplates,
  getTemplate,
  type TemplateMeta,
} from "@agent-native/shared-app-config";
