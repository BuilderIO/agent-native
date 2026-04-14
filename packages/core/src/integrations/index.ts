// Types
export type {
  PlatformAdapter,
  IncomingMessage,
  OutgoingMessage,
  IntegrationStatus,
  IntegrationsPluginOptions,
} from "./types.js";

// Plugin
export {
  createIntegrationsPlugin,
  defaultIntegrationsPlugin,
} from "./plugin.js";

// Adapters
export { slackAdapter } from "./adapters/slack.js";
export { telegramAdapter } from "./adapters/telegram.js";
export { whatsappAdapter } from "./adapters/whatsapp.js";
export { googleDocsAdapter } from "./adapters/google-docs.js";

// Google Docs integration
export {
  startGoogleDocsPoller,
  stopGoogleDocsPoller,
  handlePushNotification,
} from "./google-docs-poller.js";

// Stores
export {
  getIntegrationConfig,
  saveIntegrationConfig,
  deleteIntegrationConfig,
  listIntegrationConfigs,
  type IntegrationConfig,
} from "./config-store.js";

export {
  getThreadMapping,
  saveThreadMapping,
  deleteThreadMapping,
  listThreadMappings,
  type ThreadMapping,
} from "./thread-mapping-store.js";
