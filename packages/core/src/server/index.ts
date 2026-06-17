export {
  createServer,
  upsertEnvFile,
  type CreateServerOptions,
  type EnvKeyConfig,
} from "./create-server.js";

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
  OPEN_ROUTE_SUBPATH,
  DESKTOP_OPEN_URL,
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
} from "./identity-sso.js";
export { requireEnvKey, type MissingKeyResponse } from "./missing-key.js";
export { verifyCaptcha, type CaptchaVerifyResult } from "./captcha.js";
export {
  createProductionAgentHandler,
  type ActionEntry,
  type ScriptEntry,
  type ProductionAgentOptions,
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
  getOwnerActiveApiKey,
  runAgentLoop,
} from "../agent/production-agent.js";
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
  type AgentChatPluginOptions,
} from "./agent-chat-plugin.js";
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
  type CollabPluginOptions,
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
export { wrapWithAnalytics } from "./analytics.js";
export {
  getH3App,
  awaitBootstrap,
  markDefaultPluginProvided,
  type H3AppShim,
} from "./framework-request-handler.js";
export {
  autoDiscoverActions,
  autoDiscoverScripts,
  loadActionsFromStaticRegistry,
  mergeCoreSharingActions,
  registerPackageActions,
} from "./action-discovery.js";
export {
  mountActionRoutes,
  type MountActionRoutesOptions,
} from "./action-routes.js";
export {
  runWithRequestContext,
  hasRequestContext,
  getRequestContext,
  getRequestUserEmail,
  getRequestUserName,
  getRequestOrgId,
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
  emailAdapter,
  type PlatformAdapter,
  type IncomingMessage,
  type OutgoingMessage,
  type IntegrationStatus,
  type IntegrationsPluginOptions,
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
  resolveBuilderCredential,
  writeBuilderCredentials,
  deleteBuilderCredentials,
  resolveSecret,
} from "./credential-provider.js";
export {
  getBuilderBranchProjectId,
  isBuilderBranchingEnabled,
  resolveBuilderBranchProjectId,
  resolveIsBuilderBranchingEnabled,
  runBuilderAgent,
  type RunBuilderAgentResult,
} from "./builder-browser.js";

export {
  sendEmail,
  isEmailConfigured,
  getEmailProvider,
  type EmailProvider,
  type SendEmailArgs,
} from "./email.js";
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
