// Re-export everything from the shared app config package
export {
  type AppDefinition,
  type AppConfig,
  APP_REGISTRY,
  DEFAULT_APPS,
  HARNESS_PORT,
  getAppUrl,
  getAppById,
  toAppDefinition,
  generateAppId,
} from "@agent-native/shared-app-config";
