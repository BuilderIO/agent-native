export {
  agentChat,
  type AgentChatMessage,
  type AgentChatCallOptions,
  type AgentChatResponse,
} from "./agent-chat.js";
export {
  appendAgentChatContextToMessage,
  splitAgentChatContextFromMessage,
  type AgentChatMessageParts,
} from "./agent-chat-context.js";
export { agentEnv, type EnvVar } from "./agent-env.js";
export {
  extractOAuthStateAppId,
  extractOAuthStateProvider,
} from "./oauth-state.js";
export { isGoogleProfileImageUrl } from "./google-profile-image.js";
export {
  SIGN_IN_CONTINUATION_MAX_LENGTH,
  SIGN_IN_CONTINUATION_PARAM,
  SIGN_IN_ENTRY_PATH,
  SIGN_IN_LEGACY_ENTRY_PATH,
  SIGN_IN_LEGACY_RETURN_PARAM,
  decodeContinuation,
  encodeContinuation,
  normalizeAppPath,
  signInJourney,
  signInJourneyInlineScript,
  type SignInJourney,
  type SignInJourneyInput,
} from "./sign-in-journey.js";
export { truncate } from "./truncate.js";
export {
  isHumanReadableDocumentTitle,
  normalizeDocumentTitle,
} from "./document-title.js";
export { injectDocumentMarkup } from "./html-document.js";
export {
  formatHtmlStyleSummary,
  summarizeHtmlStyles,
  type HtmlStyleFragment,
  type HtmlStyleSummary,
  type HtmlStyleValue,
} from "./html-style-summary.js";
export { withBuilderUtmTrackingParams } from "./builder-link-tracking.js";
export {
  BETA_FORCE_QUERY_PARAM,
  BETA_FORCE_SESSION_STORAGE_KEY,
  BETA_REDIRECT_DURATION_MS,
  BETA_REDIRECT_STORAGE_KEY,
  BETA_REDIRECT_SIGN_OUT_STORAGE_KEY,
  BETA_OPT_OUT_DURATION_MS,
  BETA_OPT_OUT_QUERY_PARAM,
  BETA_OPT_OUT_STORAGE_KEY,
  ENVIRONMENT_BETA_HOSTS,
  resolveEnvironmentTargets,
  type EnvironmentBadgeTargets,
} from "./environment-lanes.js";
export {
  SSR_HTML_CONTENT_TYPE,
  SSR_QUERY_CACHE_KEY_HEADER,
  type SsrHtmlContentTypeOptions,
  withSsrHtmlContentType,
} from "./cache-control.js";
export {
  SURFACE_HIDDEN_FLAG,
  SURFACE_VISIBILITY_EVENT,
  addSurfaceVisibilityListener,
  buildSurfaceVisibilityScript,
  isHostSurfaceHidden,
  isSurfaceHidden,
} from "./surface-visibility.js";
export {
  AGENT_NATIVE_DOCS_ORIGIN,
  docsUrl,
  type DocsUrlOptions,
} from "./docs-url.js";
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
} from "./runtime-config.js";
export {
  llmConnectionTrackingProperties,
  normalizeLlmConnection,
  type LlmConnectionStatus,
} from "./llm-connection.js";
export {
  AGENT_NATIVE_ACTION_EVENTS,
  AGENT_NATIVE_LIFECYCLE_EVENTS,
  normalizeTrackingDimension,
  withCanonicalTrackingProperties,
  type AgentNativeActionEventName,
  type AgentNativeLifecycleEventName,
} from "./analytics-events.js";
export {
  DISPATCH_WORKSPACE_ROOT_REDIRECTS,
  RESERVED_WORKSPACE_APP_IDS,
  assertValidWorkspaceAppId,
  getWorkspaceAppIdValidationError,
  isValidWorkspaceAppIdFormat,
  normalizeWorkspaceAppId,
} from "./workspace-app-id.js";
export {
  DEFAULT_WORKSPACE_APP_AUDIENCE,
  WORKSPACE_APP_AUDIENCES,
  normalizeWorkspaceAppAudience,
  normalizeWorkspaceAppPathList,
  workspaceAppAudienceFromEnv,
  workspaceAppAudienceFromPackageJson,
  workspaceAppRouteAccessFromEnv,
  workspaceAppRouteAccessFromPackageJson,
  type WorkspaceAppRouteAccess,
  type WorkspaceAppRouteAccessFromConfig,
  type WorkspaceAppAudience,
} from "./workspace-app-audience.js";
export {
  AGENT_NATIVE_OPEN_PATH,
  AGENT_SIDEBAR_QUERY_PARAM,
  AGENT_SIDEBAR_QUERY_VALUE_CLOSED,
  AGENT_SIDEBAR_QUERY_VALUE_OPEN,
  isAgentNativeOpenDeepLink,
  withCollapsedAgentSidebarParam,
} from "./agent-sidebar-url.js";
export {
  buildChatFirstAppCreationPrompt,
  titleFromChatFirstAppPrompt,
  type ChatFirstAppCreationPromptInput,
  type ChatFirstAppCreationResource,
  type ChatFirstAppCreationVaultAccessMode,
} from "./chat-first-app-creation.js";
export { isQaTestEmail } from "./qa-test-email.js";
export {
  SYNTHETIC_TRAFFIC_BETA_E2E,
  SYNTHETIC_TRAFFIC_HEADER,
  isSyntheticTrafficValue,
} from "./test-traffic.js";
export {
  NATIVE_AUTH_COPY,
  resolveNativeAuthCopy,
  type NativeAuthCopy,
} from "./auth-copy.js";
export {
  createPollEngine,
  type PollEngineOptions,
  type PollEngineHandle,
} from "./poll-engine.js";
export {
  AGENT_NATIVE_DEFAULT_SOCIAL_IMAGE,
  AGENT_NATIVE_SOCIAL_IMAGE_CACHE_BUSTER,
  AGENT_NATIVE_SOCIAL_IMAGE_ALT,
  AGENT_NATIVE_SOCIAL_IMAGE_HEIGHT,
  AGENT_NATIVE_SOCIAL_IMAGE_PATH,
  AGENT_NATIVE_SOCIAL_IMAGE_TYPE,
  AGENT_NATIVE_SOCIAL_IMAGE_WIDTH,
  defaultSocialImageMeta,
  withAgentNativeSocialImageCacheBuster,
  withDefaultSocialImage,
  type SocialMetaDescriptor,
} from "./social-meta.js";
export {
  EMBED_MODE_QUERY_PARAM,
  EMBED_SESSION_COOKIE,
  EMBED_START_PATH,
  EMBED_TOKEN_QUERY_PARAM,
} from "./embed-auth.js";
export {
  AGENT_ACCESS_PARAM,
  DEFAULT_AGENT_ACCESS_TTL_SECONDS,
  appendAgentAccessParam,
  buildAgentAccessApiUrl,
  buildAgentAccessUrl,
  normalizeAgentAccessBasePath,
  normalizeAgentAccessOrigin,
  scopedAgentAccessResourceId,
  toAgentAccessUrl,
  type AgentAccessApiUrlOptions,
  type AgentAccessResourceScope,
  type AgentAccessUrlOptions,
} from "./agent-access.js";
export {
  AGENT_READABLE_RESOURCE_PAYLOAD_TYPE,
  AGENT_READABLE_RESOURCE_SCRIPT_TYPE,
  buildAgentReadableResourceDiscovery,
  renderAgentReadableResourceDiscoveryScript,
  safeJsonForHtml,
  type AgentReadableResourceDiscovery,
  type BuildAgentReadableResourceDiscoveryOptions,
} from "./agent-readable-resource.js";
export {
  applyTargetedReplace,
  findTargetedMatches,
  type TargetedAmbiguousMatch,
  type TargetedCandidate,
  type TargetedMatch,
  type TargetedMatchFailure,
  type TargetedMatchesResult,
  type TargetedReplaceResult,
  type TargetedTextEditOptions,
} from "./targeted-text-edit.js";
export {
  DIAGNOSTIC_SNIPPET_CLOSE,
  DIAGNOSTIC_SNIPPET_OPEN,
  stripDiagnosticSnippets,
  wrapDiagnosticSnippet,
} from "./diagnostic-snippet.js";
