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
  IntegrationExecutionContext,
  IntegrationActorTrust,
  IntegrationContextMessage,
  IntegrationFileReference,
  IntegrationConversationType,
  IntegrationTriggerKind,
  PlatformRunProgress,
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
  getRemoteComputerCapabilities,
  listRemoteDevicesForOwner,
  revokeRemoteDeviceForOwner,
  unregisterRemoteDevice,
} from "./remote-devices-store.js";
export {
  claimNextComputerCommand,
  enqueueComputerCommand,
  listRemoteCommandsForOwner,
} from "./remote-commands-store.js";
export {
  assertValidComputerCommandEnvelope,
  computeComputerActionHash,
  computerOperationRequiresApproval,
  ComputerSupervisionError,
} from "./computer-supervision.js";
export {
  authorizeComputerOperation,
  createComputerApprovalRequest,
  decideComputerApproval,
  getComputerApprovalForOwner,
  listComputerApprovalsForOwner,
  type ComputerApprovalRecord,
  type ComputerApprovalStatus,
} from "./computer-supervision-store.js";
export { insertRemoteLiveViewEvents } from "./remote-run-events-store.js";
export {
  listRemotePushNotificationsForOwner,
  listRemotePushRegistrationsForOwner,
  queueRemotePushNotifications,
  toPublicRemotePushRegistration,
  unregisterRemotePushRegistrationForOwner,
  upsertRemotePushRegistration,
} from "./remote-push-store.js";
export type {
  ComputerApprovalScope,
  ComputerCommandAction,
  ComputerCommandEnvelope,
  ComputerOperationClass,
  PublicRemotePushRegistration,
  PublicRemoteDevice,
  RemoteComputerCapabilities,
  RemoteCommand,
  RemoteDevice,
  RemoteDeviceMetadata,
  RemoteLiveViewEvent,
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
  disconnectIntegrationInstallation,
  getActiveIntegrationInstallationByKey,
  getActiveIntegrationInstallationForTenant,
  getIntegrationInstallation,
  listIntegrationInstallations,
  resolveIntegrationTokenBundle,
  updateIntegrationInstallation,
  upsertIntegrationInstallation,
} from "./installations-store.js";
export type {
  InstallationActor,
  IntegrationInstallation,
  IntegrationInstallationHealth,
  IntegrationInstallationStatus,
  IntegrationTokenBundle,
} from "./installations-store.js";

export {
  assertSlackInstallAccess,
  buildSlackAuthorizeUrl,
  exchangeSlackOAuthCode,
  refreshSlackOAuthToken,
  slackInstallationKey,
  slackOAuthResponseToInstallation,
  testSlackAuth,
} from "./slack-oauth.js";

export {
  SLACK_AGENT_BOT_EVENTS,
  buildSlackAgentManifest,
  type SlackAgentManifestUrls,
} from "./slack-manifest.js";

export {
  DEFAULT_INTEGRATION_SCOPE_POLICY,
  deleteIntegrationScope,
  evaluateIntegrationScopePolicy,
  getIntegrationScope,
  integrationScopeSubjectKey,
  listIntegrationScopes,
  saveIntegrationScope,
} from "./scope-store.js";
export type {
  IntegrationConversationTrust,
  IntegrationScope,
  IntegrationScopeAccess,
  IntegrationScopePolicy,
} from "./scope-store.js";

export {
  getIntegrationBudgetSnapshot,
  getIntegrationUsageBudget,
  listIntegrationUsageBudgets,
  listIntegrationBudgetThresholdEvents,
  releaseIntegrationUsageBudget,
  reserveIntegrationUsageBudget,
  saveIntegrationUsageBudget,
  settleIntegrationUsageBudget,
} from "./usage-budget-store.js";
export type {
  IntegrationBudgetPeriod,
  IntegrationBudgetSubject,
  IntegrationUsageBudget,
} from "./usage-budget-store.js";

export {
  getThreadMapping,
  saveThreadMapping,
  deleteThreadMapping,
  listThreadMappings,
  type ThreadMapping,
} from "./thread-mapping-store.js";
