export {
  defineAppConfig,
  getAppConfig,
  resetAppConfigForTests,
  appConfigSchema,
  type AppConfig,
  type AppConfigInput,
} from "../app-config/index.js";
export {
  createServer,
  type CreateServerOptions,
  type EnvKeyConfig,
} from "./create-server.js";
export {
  startIntervalJob,
  type IntervalJobOptions,
  type IntervalJobHandle,
} from "./interval-job.js";
export {
  AGENT_BACKGROUND_PROCESSOR_FIELD,
  AGENT_BACKGROUND_PROCESSOR_ROUTE,
  AGENT_BACKGROUND_PROCESSOR_ROUTE_FIELD,
  dispatchPathTargetsNetlifyBackgroundFunction,
  isInBackgroundFunctionRuntime,
  resolveDurableBackgroundDispatchPath,
} from "../agent/durable-background.js";

export {
  readBody,
  readBodyWithSizeLimit,
  streamFile,
  DEFAULT_CHAT_MAX_BODY_BYTES,
  DEFAULT_UPLOAD_MAX_FILE_BYTES,
  MAX_CHAT_ATTACHMENTS_PER_MESSAGE,
  isAllowedUploadMimeType,
} from "./h3-helpers.js";
export {
  buildDeepLink,
  toAbsoluteOpenUrl,
  toDesktopOpenUrl,
  toVsCodeOpenUrl,
  OPEN_ROUTE_SUBPATH,
  DESKTOP_OPEN_URL,
  VSCODE_OPEN_URL,
  type DeepLinkInput,
} from "./deep-link.js";
export { createOpenRouteHandler, type OpenRouteOptions } from "./open-route.js";
export {
  createEmbedStartRouteHandler,
  buildEmbedStartPath,
  type EmbedStartRouteOptions,
} from "./embed-route.js";
export {
  createEmbedSessionTicket,
  consumeEmbedSessionTicket,
  normalizeEmbedTargetPath,
  requestHasEmbedAuthMarker,
  resolveEmbedSessionFromRequest,
  setEmbedSessionCookie,
  signEmbedSessionToken,
  verifyEmbedSessionToken,
  type ConsumedEmbedSessionTicket,
  type ConsumeEmbedSessionTicketOptions,
  type EmbedSessionTicket,
  type EmbedSessionTicketInput,
  type EmbedSessionTokenClaims,
  type ResolvedEmbedSession,
  type VerifyEmbedSessionTokenResult,
} from "./embed-session.js";
export { createSSEHandler, type SSEHandlerOptions } from "./sse.js";
export {
  mountAuthMiddleware,
  autoMountAuth,
  registerAuthPublicPaths,
  getSession,
  COOKIE_NAME,
  addSession,
  removeSession,
  getSessionEmail,
  getFrameworkSessionCookieValues,
  setFrameworkSessionCookie,
  clearFrameworkSessionCookies,
  runAuthGuard,
  setDesktopExchange,
  setDesktopExchangeError,
  safeReturnPath,
  type DesktopExchangeErrorPayload,
  type AuthSession,
  type AuthOptions,
} from "./auth.js";
export {
  handleIdentitySso,
  getIdentityHubUrl,
  isIdentitySsoEnabled,
  isIdentitySsoBypassPath,
  identitySsoLoginButtonHtml,
  IDENTITY_SSO_PROVIDER_ID,
  IDENTITY_SSO_SCOPE,
  IDENTITY_SSO_DESKTOP_COMPLETE_PATH,
} from "./identity-sso.js";
export { hasGoogleAuthIdentity } from "./better-auth-instance.js";
export { requireEnvKey, type MissingKeyResponse } from "./missing-key.js";
export {
  assertCurrentRequestUserIsOrgAdmin,
  currentRequestUserIsOrgAdmin,
} from "./org-admin.js";
export { verifyCaptcha, type CaptchaVerifyResult } from "./captcha.js";
export {
  getLocaleInitScript,
  parseAcceptLanguage,
  resolveLocaleFromRequest,
  type LocaleInitScriptOptions,
  type ResolveLocaleFromRequestOptions,
  type ResolvedRequestLocale,
} from "../localization/server.js";
export {
  createProductionAgentHandler,
  type ActionEntry,
  type ScriptEntry,
  type ProductionAgentOptions,
  type AgentActionSurface,
  type AgentActionSurfaceDetails,
  type ActionTool,
  type ScriptTool,
  type AgentMessage,
  type AgentChatRequest,
  type AgentChatEvent,
  type AgentChatAttachment,
  type AgentChatReference,
  type MentionProvider,
  type MentionProviderItem,
  type AgentLoopFinalResponseGuard,
  type AgentLoopFinalResponseGuardContext,
  type AgentLoopFinalResponseGuardResult,
  type AgentLoopToolCallSummary,
  type AgentLoopToolResultSummary,
} from "../agent/index.js";
export {
  actionsToEngineTools,
  executeAgentToolCall,
  getOwnerActiveApiKey,
  getOwnerApiKeyForEngine,
  resolveOwnerEngineApiKey,
  runAgentLoop,
  type AgentToolCallExecutionResult,
  type ExecuteAgentToolCallOptions,
  type ResolvedOwnerApiKey,
} from "../agent/production-agent.js";
export {
  mountRealtimeVoiceRoutes,
  realtimeVoiceSafetyIdentifier,
  REALTIME_VOICE_MAX_SDP_BYTES,
  REALTIME_VOICE_MAX_TOOL_BODY_BYTES,
  REALTIME_VOICE_MAX_TOOL_OUTPUT_CHARS,
  REALTIME_VOICE_SESSION_PATH,
  REALTIME_VOICE_TOOL_PATH,
  type MountRealtimeVoiceRoutesOptions,
  type RealtimeVoiceRequestContext,
  type RealtimeVoiceToolExecutionRequest,
  type RealtimeVoiceToolExecutionResult,
} from "./realtime-voice.js";
export {
  getStoredModelForEngine,
  resolveEngine,
} from "../agent/engine/index.js";
export {
  completeText,
  type CompleteTextMessage,
  type CompleteTextOptions,
  type CompleteTextResult,
  type CompleteTextUsage,
} from "./complete-text.js";
export { createDevScriptRegistry } from "../scripts/dev/index.js";

export {
  createPollHandler,
  recordChange,
  getVersion,
  getChangesSince,
  getPollEmitter,
  canSeeChangeForUser,
  POLL_CHANGE_EVENT,
} from "./poll.js";
export { createPollEventsHandler } from "./poll-events.js";
export { createAuthPlugin, defaultAuthPlugin } from "./auth-plugin.js";
export {
  BETTER_AUTH_MIGRATIONS,
  runBetterAuthMigrations,
} from "./better-auth-migrations.js";
export { runFrameworkReleaseMigrations } from "./release-migrations.js";
export {
  initServerSentry,
  isServerSentryEnabled,
  setSentryUserForRequest,
  captureRouteError,
  type RouteErrorContext,
} from "./sentry.js";
export {
  captureError,
  captureServerError,
  registerErrorCaptureProvider,
  type CaptureErrorContext,
  type CaptureErrorProvider,
} from "./capture-error.js";
export { createSentryPlugin, defaultSentryPlugin } from "./sentry-plugin.js";
// Re-export the org plugin so the auto-discovery's DEFAULT_PLUGIN_REGISTRY
// (which references "defaultOrgPlugin" from @agent-native/core/server) can
// resolve it during the deploy build worker-entry generation.
export { createOrgPlugin, defaultOrgPlugin } from "../org/plugin.js";
export {
  createFeatureFlagA2AActionRouteAuth,
  createFeatureFlagsPlugin,
} from "../feature-flags/server.js";
export {
  createContextXrayPlugin,
  defaultContextXrayPlugin,
} from "../agent/context-xray/plugin.js";
export {
  createObservationalMemoryPlugin,
  defaultObservationalMemoryPlugin,
} from "../agent/observational-memory/plugin.js";
export {
  createGoogleAuthPlugin,
  type GoogleAuthPluginOptions,
} from "./google-auth-plugin.js";
export type { GoogleAuthMode } from "./google-auth-mode.js";
export {
  createAgentChatPlugin,
  defaultAgentChatPlugin,
  refreshGlobalMcpManager,
  type AgentChatPluginOptions,
} from "./agent-chat-plugin.js";
export type {
  AgentChatMcpIcon,
  AgentChatMcpOptions,
} from "./agent-chat/mcp-options.js";
export {
  configureAgentNativeEmbeddedEnvironment,
  createAgentNativeEmbeddedAuthOptions,
  createAgentNativeEmbeddedPlugin,
  mountAgentNativeEmbedded,
  normalizeAgentNativeEmbeddedSession,
  type AgentNativeEmbeddedAuthOptions,
  type AgentNativeEmbeddedGetSession,
  type AgentNativeEmbeddedHostSession,
  type AgentNativeEmbeddedPluginOptions,
} from "./embedded.js";
export {
  createThread,
  getThread,
  listThreads,
  updateThreadData,
  deleteThread,
  setThreadArchived,
  setThreadPinned,
  setThreadScope,
  type ChatThread,
  type ChatThreadScope,
  type ChatThreadSummary,
  type ListThreadsOptions,
} from "../chat-threads/store.js";
export {
  createResourcesPlugin,
  defaultResourcesPlugin,
} from "./resources-plugin.js";
export {
  createCoreRoutesPlugin,
  defaultCoreRoutesPlugin,
  FRAMEWORK_ROUTE_PREFIX,
  type CoreRoutesPluginOptions,
} from "./core-routes-plugin.js";
export {
  buildRuntimeConfigPrompt,
  formatRuntimeConfigReport,
  getRuntimeConfigReport,
  parseRuntimeConfigReport,
  runtimeConfigRequirementsFromSearchParams,
  type RuntimeConfigEnvironment,
  type RuntimeConfigIssue,
  type RuntimeConfigIssueCode,
  type RuntimeConfigIssueSeverity,
  type RuntimeConfigPhase,
  type RuntimeConfigReport,
  type RuntimeConfigRequirements,
} from "../shared/runtime-config.js";
export {
  AGENT_NATIVE_OG_IMAGE_CACHE_CONTROL,
  AGENT_NATIVE_OG_IMAGE_HEIGHT,
  AGENT_NATIVE_OG_IMAGE_NETLIFY_CACHE_CONTROL,
  AGENT_NATIVE_OG_IMAGE_WIDTH,
  agentNativeOgImageResponseHeaders,
  createAgentNativeOgImageHandler,
  renderAgentNativeOgImagePng,
  renderAgentNativeOgImageSvg,
  type AgentNativeOgImageInput,
} from "./social-og-image.js";
export { OG_FONT_FAMILY, resolveOgFontFiles } from "./og-fonts.js";
export {
  createBrowserSessionActionEntries,
  type CreateBrowserSessionActionEntriesOptions,
} from "../browser-sessions/actions.js";
export {
  DEFAULT_BROWSER_SESSION_REQUEST_POLL_MS,
  DEFAULT_BROWSER_SESSION_REQUEST_TIMEOUT_MS,
  DEFAULT_BROWSER_SESSION_TTL_MS,
  callBrowserSession,
  claimBrowserSessionRequest,
  completeBrowserSessionRequest,
  createBrowserSessionRequest,
  disconnectBrowserSession,
  getBrowserSession,
  getBrowserSessionRequest,
  listBrowserSessions,
  registerBrowserSession,
  waitForBrowserSessionRequest,
} from "../browser-sessions/store.js";
export {
  mountBrowserSessionRoutes,
  type MountBrowserSessionRoutesOptions,
} from "../browser-sessions/routes.js";
export type {
  AgentNativeBrowserSession,
  AgentNativeBrowserSessionAction,
  AgentNativeBrowserSessionRecord,
  AgentNativeBrowserSessionRequest,
  AgentNativeBrowserSessionRequestStatus,
  AgentNativeBrowserSessionRequestType,
  CreateAgentNativeBrowserSessionRequestInput,
  RegisterAgentNativeBrowserSessionInput,
} from "../browser-sessions/types.js";
export {
  createTerminalPlugin,
  defaultTerminalPlugin,
  type TerminalPluginOptions,
} from "../terminal/terminal-plugin.js";
export {
  createCollabPlugin,
  type CollabAccess,
  type CollabPluginOptions,
  type CollabResourceIdResolver,
} from "./collab-plugin.js";

export {
  spawnTask,
  getTask,
  getTaskByThread,
  listTasks,
  sendToTask,
  markTaskErrored,
  type AgentTask,
  type SpawnTaskOptions,
} from "./agent-teams.js";
export { isOAuthConnected, getOAuthAccounts } from "./oauth-helpers.js";
export {
  hasGoogleSignInCredentials,
  GOOGLE_LEGACY_PROVIDER_CREDENTIAL_KEYS,
  GOOGLE_PRIMARY_PROVIDER_CREDENTIAL_KEYS,
  GOOGLE_PROVIDER_CREDENTIAL_KEY_PAIRS,
  resolveGoogleLegacyProviderCredentials,
  resolveGoogleProviderCredentialCandidatesWithReader,
  resolveGoogleProviderCredentialCandidates,
  resolveGoogleProviderCredentials,
  resolveGoogleSignInCredentials,
  type GoogleOAuthCredentialKeyPair,
  type GoogleOAuthCredentials,
  type ReadGoogleOAuthCredential,
} from "./google-oauth-credentials.js";
export { wrapWithAnalytics } from "./analytics.js";
export {
  getH3App,
  awaitBootstrap,
  markDefaultPluginProvided,
  type H3AppShim,
} from "./framework-request-handler.js";
export {
  fireInternalDispatch,
  resolveSelfDispatchBaseUrl,
  type FireInternalDispatchOptions,
} from "./self-dispatch.js";
export {
  extractBearerToken as extractInternalBearerToken,
  verifyInternalToken,
} from "../integrations/internal-token.js";
export {
  autoDiscoverActions,
  autoDiscoverScripts,
  loadActionsFromStaticRegistry,
  mergeCoreSharingActions,
  registerPackageActions,
} from "./action-discovery.js";
// A standalone `mountMCP` plugin has to compose the same action surface the
// agent-chat plugin does. Without these, the only way to build one was to
// hand-roll a copy — which is how a template ends up with a `tool-search` that
// drifts from the framework's, and an MCP mount that silently ignores
// `frameworkTools`.
export {
  attachToolSearch,
  createToolSearchEntry,
  searchToolRegistry,
  TOOL_SEARCH_ACTION_NAME,
} from "../agent/tool-search.js";
export {
  filterFrameworkToolGroups,
  frameworkGroupEnabled,
  resolveFrameworkTools,
  FRAMEWORK_TOOL_GROUPS,
  type FrameworkToolGroup,
  type FrameworkToolsConfig,
  type FrameworkToolsOption,
  type ResolvedFrameworkTools,
} from "../framework-tools.js";
export {
  registerPromptContextProvider,
  type PromptContextProvider,
  type PromptContextProviderContext,
  type PromptContextProviderContribution,
} from "./agent-chat/prompt-resources.js";
export {
  mountActionRoutes,
  type MountActionRoutesOptions,
  type ActionRouteAuthAdapter,
  type ActionRouteResolvedCaller,
} from "./action-routes.js";
export {
  AGENT_RUN_OWNER_CONTEXT_KEY,
  seedAgentRunOwnerContext,
  type AgentRunOwnerContext,
} from "./agent-run-context.js";
export {
  runWithRequestContext,
  hasRequestContext,
  hasRequestBoundary,
  getRequestContext,
  getRequestUserEmail,
  getRequestUserName,
  getRequestOrgId,
  getAmbientUserEmail,
  getAmbientOrgId,
  getRequestTimezone,
  getRequestRunContext,
  getCredentialContext,
  isIntegrationCallerRequest,
  type RequestContext,
  type RequestRunContext,
} from "./request-context.js";
export { formatDateInTimezone, todayInTimezone } from "./date-utils.js";

export {
  createOnboardingPlugin,
  defaultOnboardingPlugin,
} from "../onboarding/plugin.js";

export {
  registerFileUploadProvider,
  unregisterFileUploadProvider,
  listFileUploadProviders,
  getActiveFileUploadProvider,
  getActiveFileUploadProviderForRequest,
  uploadFile,
  builderFileUploadProvider,
  type FileUploadInput,
  type FileUploadProvider,
  type FileUploadResult,
} from "../file-upload/index.js";

export {
  createIntegrationsPlugin,
  defaultIntegrationsPlugin,
  enqueueRemoteCommand,
  slackAdapter,
  telegramAdapter,
  whatsappAdapter,
  discordAdapter,
  microsoftTeamsAdapter,
  emailAdapter,
  assertPlatformCapability,
  type PlatformAdapter,
  type IncomingMessage,
  type OutgoingMessage,
  type PlatformAdapterCapabilities,
  type ImmediateWebhookResponse,
  type IntegrationStatus,
  type IntegrationsPluginOptions,
  type IntegrationExecutionContext,
  BUILT_IN_INTEGRATION_CATALOG,
  INTEGRATION_CATEGORIES,
  getIntegrationCatalogEntry,
  listBuiltInChannelIntegrations,
  listIntegrationCatalog,
  type BuiltInChannelId,
  type ChannelCapabilities,
  type IntegrationAvailability,
  type IntegrationCatalogEntry,
  type IntegrationCategory,
  type IntegrationCredentialRequirement,
  type IntegrationIconKey,
  type IntegrationSupportMaturity,
} from "../integrations/index.js";

export {
  isElectron,
  isMobile,
  getOrigin,
  getAppBasePath,
  getAppUrl,
  resolveOAuthRedirectUri,
  isAllowedOAuthRedirectUri,
  encodeOAuthState,
  decodeOAuthState,
  resolveOAuthOwner,
  createOAuthSession,
  oauthCallbackResponse,
  oauthErrorPage,
  oauthDesktopExchangePage,
  type OAuthStatePayload,
  type OAuthOwnerResult,
  type OAuthSessionResult,
} from "./google-oauth.js";

export {
  buildWorkspaceProviderAuthorizationUrl,
  createWorkspaceProviderOAuthHandler,
  exchangeWorkspaceProviderOAuthCode,
  handleWorkspaceProviderOAuthCallback,
  handleWorkspaceProviderOAuthStart,
  isWorkspaceProviderOAuthFlowValid,
  mergeWorkspaceOAuthValues,
  resolveWorkspaceProviderIdentity,
  workspaceProviderOAuthPath,
  type GenericWorkspaceOAuthProvider,
  type WorkspaceProviderOAuthFlow,
} from "./workspace-provider-oauth.js";

export {
  FeatureNotConfiguredError,
  hasBuilderPrivateKey,
  isBuilderEnvManaged,
  getBuilderProxyOrigin,
  getBuilderImageGenerationBaseUrl,
  getBuilderWebSearchBaseUrl,
  getBuilderAuthHeader,
  resolveBuilderPrivateKey,
  resolveBuilderAuthHeader,
  resolveHasBuilderPrivateKey,
  resolveHasCompleteBuilderConnection,
  resolveBuilderCredentials,
  resolveBuilderCredentialsDetailed,
  // Gateway lane, for the metered surfaces a deployed site can call without an
  // identity — image and video generation, realtime transcription. Falls
  // through to the identity credential first, so a consumer moves lane by
  // swapping the resolver and changing nothing else.
  resolveBuilderGatewayCredentials,
  resolveBuilderGatewayCredentialsDetailed,
  resolveBuilderCredentialSource,
  resolveBuilderCredential,
  readDeployCredentialEnv,
  writeBuilderCredentials,
  deleteBuilderCredentials,
  resolveSecret,
  type BuilderCredentialsDetailed,
} from "./credential-provider.js";
export {
  builderDesignSystemUrl,
  builderProjectBranchUrl,
  buildBuilderDesignSystemIndexFiles,
  collectBuilderDesignSystemGitHubFiles,
  createBuilderDesignSystemProxyFields,
  fetchBuilderDesignSystemDecodeJobStatus,
  fetchBuilderDesignSystemDocs,
  getBuilderDesignSystemsBaseUrl,
  hydrateBuilderDesignSystemReference,
  indexBuilderDesignSystem,
  localBuilderDesignSystemId,
  mimeTypeForBuilderDesignSystemFilename,
  parseBuilderDesignSystemProxyReference,
  startBuilderDesignSystemIndex,
  startBuilderDesignSystemUpload,
  type BuildBuilderDesignSystemIndexFilesOptions,
  type BuilderDesignSystemCodeFileInput,
  type BuilderDesignSystemDecodeJobStatus,
  type BuilderDesignSystemDocsOptions,
  type BuilderDesignSystemDocument,
  type BuilderDesignSystemHydratedReference,
  type BuilderDesignSystemIndexFile,
  type BuilderDesignSystemIndexFromSourcesOptions,
  type BuilderDesignSystemIndexOptions,
  type BuilderDesignSystemIndexResult,
  type BuilderDesignSystemGitHubFile,
  type BuilderDesignSystemGitHubFileCollection,
  type BuilderDesignSystemGitHubSource,
  type BuilderDesignSystemUploadAttachment,
  type BuilderDesignSystemUploadSlot,
  type BuilderDesignSystemProxyFields,
  type BuilderDesignSystemProxyFieldsOptions,
  type BuilderDesignSystemProxyReference,
  type BuilderDesignSystemSourceKind,
} from "./builder-design-systems.js";
export {
  createBuilderProject,
  ensureBuilderProject,
  findBuilderProjectForRepo,
  getBuilderBranchProjectId,
  isBuilderBranchingEnabled,
  requestBuilderBrowserConnection,
  resolveBuilderBranchProjectId,
  resolveIsBuilderBranchingEnabled,
  runBuilderAgent,
  type BuilderProjectResult,
  type RunBuilderAgentResult,
} from "./builder-browser.js";
export {
  ensureFusionContainer,
  sendFusionBranchMessage,
  pushFusionBranch,
  reserveFusionHostingSlug,
  deployFusionProject,
  getFusionDeploys,
  getFusionBranchEditorUrl,
  getFusionHostingUrl,
  type FusionBranchRef,
  type EnsureFusionContainerResult,
  type SendFusionMessageResult,
} from "./fusion-app.js";

export {
  sendEmail,
  isEmailConfigured,
  getEmailReadiness,
  getEmailProvider,
  type EmailAttachment,
  type EmailReadiness,
  type EmailProvider,
  type SendEmailArgs,
} from "./email.js";
export {
  defineTransactionalEmail,
  listTransactionalEmails,
  getTransactionalEmail,
  renderTransactionalEmailPreview,
  type TransactionalEmailDefinition,
  type RegisteredTransactionalEmail,
} from "../email-catalog/registry.js";
export {
  notifyActivity,
  runActivityNotification,
  resolveActivityRecipients,
  type ActivityDeliveryFailure,
  type ActivityNotificationResult,
  type ActivityNotificationStatus,
  type NotifyActivityInput,
  type ResolveActivityRecipientsInput,
} from "./activity-notifications.js";
export {
  renderEmail,
  emailStrong,
  emailLink,
  type RenderEmailArgs,
  type RenderedEmail,
  type EmailCta,
} from "./email-template.js";
export { getAppProductionUrl, getFirstPartyProdUrl } from "./app-url.js";
export {
  getConfiguredAppBasePath,
  normalizeAppBasePath,
  withConfiguredAppBasePath,
} from "./app-base-path.js";
export {
  signShortLivedToken,
  verifyShortLivedToken,
  type ShortLivedTokenClaims,
  type VerifyResult as ShortLivedTokenVerifyResult,
} from "./short-lived-token.js";
export {
  AGENT_ACCESS_PARAM,
  DEFAULT_AGENT_ACCESS_TTL_SECONDS,
  appendAgentAccessParam,
  buildAgentAccessApiUrl,
  buildAgentAccessUrl,
  createScopedAgentAccessGrant,
  normalizeAgentAccessBasePath,
  normalizeAgentAccessOrigin,
  scopedAgentAccessResourceId,
  signScopedAgentAccessToken,
  toAgentAccessUrl,
  verifyScopedAgentAccessToken,
  type AgentAccessApiUrlOptions,
  type AgentAccessResourceScope,
  type AgentAccessUrlOptions,
  type ScopedAgentAccessGrant,
  type ScopedAgentAccessTokenOptions,
} from "./agent-access.js";
export {
  AGENT_READABLE_RESOURCE_PAYLOAD_TYPE,
  AGENT_READABLE_RESOURCE_SCRIPT_TYPE,
  buildAgentReadableResourceDiscovery,
  renderAgentReadableResourceDiscoveryScript,
  safeJsonForHtml,
  type AgentReadableResourceDiscovery,
  type BuildAgentReadableResourceDiscoveryOptions,
} from "../shared/agent-readable-resource.js";

// SSR handler is NOT re-exported here — it uses a virtual module
// (virtual:react-router/server-build) that only exists at Vite dev/build time.
// Including it in this barrel would break the esbuild CF Pages bundler.
// Templates import directly: import { ssrHandler } from "@agent-native/core/server/ssr-handler"

// Nitro plugin helper — re-exported so templates don't need nitro as a direct dependency.
// defineNitroPlugin is an identity function; this typed wrapper lets templates use it
// without resolving `nitro/runtime` (which requires Nitro's virtual modules at runtime).
export type NitroPluginDef = (nitroApp: any) => void | Promise<void>;
export function defineNitroPlugin(def: NitroPluginDef): NitroPluginDef {
  return def;
}
