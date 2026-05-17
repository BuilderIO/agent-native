import { DEFAULT_APPS as SHARED_DEFAULT_APPS } from "@agent-native/shared-app-config";

const DESKTOP_DEFAULT_EXCLUDED_APP_IDS = new Set(["starter"]);

export const DESKTOP_DEFAULT_APPS = SHARED_DEFAULT_APPS.filter(
  (app) => !DESKTOP_DEFAULT_EXCLUDED_APP_IDS.has(app.id),
);

// Re-export everything from the shared app config package
export {
  type AppDefinition,
  type AppConfig,
  APP_REGISTRY,
  DEFAULT_APPS,
  TEMPLATE_APPS,
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
