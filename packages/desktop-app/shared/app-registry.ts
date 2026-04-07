// Re-export everything from the shared app config package
export {
  type AppDefinition,
  type AppConfig,
  APP_REGISTRY,
  DEFAULT_APPS,
  FRAME_PORT,
  HARNESS_PORT,
  getAppUrl,
  getAppById,
  toAppDefinition,
  generateAppId,
  type FrameSettings,
  type HarnessSettings,
} from "@agent-native/shared-app-config";
