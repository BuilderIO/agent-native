// Types
export type {
  PlatformAdapter,
  IncomingMessage,
  OutgoingMessage,
  IntegrationStatus,
  IntegrationsPluginOptions,
  ImmediateWebhookResponse,
  PlatformAdapterCapabilities,
  UnsupportedPlatformCapabilityError,
} from "./types.js";
export { assertPlatformCapability } from "./types.js";

export {
  BUILT_IN_INTEGRATION_CATALOG,
  INTEGRATION_CATEGORIES,
  getIntegrationCatalogEntry,
  listBuiltInChannelIntegrations,
  listIntegrationCatalog,
  type BuiltInChannelId,
  type AutomationCapabilities,
  type ChannelCapabilities,
  type IntegrationAvailability,
  type IntegrationCatalogEntry,
  type IntegrationCategory,
  type IntegrationCredentialRequirement,
  type IntegrationIconKey,
  type IntegrationSupportMaturity,
} from "./catalog.js";

// Plugin
export {
  createIntegrationsPlugin,
  defaultIntegrationsPlugin,
  enqueueRemoteCommand,
} from "./plugin.js";

export {
  listRemoteDevicesForOwner,
  revokeRemoteDeviceForOwner,
  unregisterRemoteDevice,
} from "./remote-devices-store.js";
export { listRemoteCommandsForOwner } from "./remote-commands-store.js";
export {
  listRemotePushNotificationsForOwner,
  listRemotePushRegistrationsForOwner,
  queueRemotePushNotifications,
  toPublicRemotePushRegistration,
  unregisterRemotePushRegistrationForOwner,
  upsertRemotePushRegistration,
} from "./remote-push-store.js";
export type {
  PublicRemotePushRegistration,
  PublicRemoteDevice,
  RemoteCommand,
  RemoteDevice,
  RemotePushNotification,
  RemotePushRegistration,
  RemoteRunEvent,
} from "./remote-types.js";

// Adapters
export { slackAdapter } from "./adapters/slack.js";
export { telegramAdapter } from "./adapters/telegram.js";
export { whatsappAdapter } from "./adapters/whatsapp.js";
export { discordAdapter } from "./adapters/discord.js";
export {
  clearMicrosoftTeamsAccessTokenCache,
  getMicrosoftTeamsAccessToken,
  microsoftTeamsAdapter,
} from "./adapters/microsoft-teams.js";
export { googleDocsAdapter } from "./adapters/google-docs.js";
export { emailAdapter } from "./adapters/email.js";

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
