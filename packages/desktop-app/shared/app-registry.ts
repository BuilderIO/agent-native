// Re-export everything from the shared app config package
export {
  type AppDefinition,
  type AppConfig,
  APP_REGISTRY,
  DEFAULT_APPS,
  FRAME_PORT,
  getAppUrl,
  getAppById,
  toAppDefinition,
  generateAppId,
  type FrameSettings,
  TEMPLATES,
  visibleTemplates,
  getTemplate,
  type TemplateMeta,
} from "@agent-native/shared-app-config";
