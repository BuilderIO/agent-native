import { installRouteChunkRecovery } from "./route-chunk-recovery.js";

installRouteChunkRecovery();

export {
  sendToAgentChat,
  generateTabId,
  type AgentChatMessage,
} from "./agent-chat.js";
export { useAgentChatGenerating } from "./use-agent-chat.js";
export { useDevMode } from "./use-dev-mode.js";
export {
  agentNativePath,
  appApiPath,
  appBasePath,
  appPath,
} from "./api-path.js";
export {
  ensureEmbedAuthFetchInterceptor,
  getEmbedAuthToken,
  isEmbedAuthActive,
} from "./embed-auth.js";
export {
  codeAgentTranscriptEventsToContent,
  createCodeAgentChatAdapter,
  type CodeAgentChatController,
  type CodeAgentChatControlResult,
  type CodeAgentChatFollowUpMode,
  type CodeAgentChatTranscriptEvent,
  type CreateCodeAgentChatAdapterOptions,
} from "./code-agent-chat-adapter.js";
export {
  buildRepositoryFromCodeAgentTranscript,
  type BuildRepositoryFromCodeAgentTranscriptOptions,
  type CodeAgentThreadTranscriptEvent,
} from "../agent/thread-data-builder.js";
export {
  compareCodeAgentTranscriptEvents,
  getCodeAgentTranscriptSeq,
  isCodeAgentRunActive,
  mergeCodeAgentTranscriptEvents,
  type CodeAgentRunStateLike,
  type CodeAgentTranscriptOrderEvent,
} from "../code-agents/transcript-order.js";
export { useSendToAgentChat } from "./use-send-to-agent-chat.js";
export {
  useChatModels,
  type UseChatModelsResult,
  type EngineModelGroup,
} from "./use-chat-models.js";
export {
  CodeRequiredDialog,
  type CodeRequiredDialogProps,
} from "./components/CodeRequiredDialog.js";
export {
  AgentConversation,
  AgentConversationMessageView,
  normalizeCodeAgentTranscriptForConversation,
  useNearBottomAutoscroll,
  type CodeAgentConversationTranscriptEvent,
  type CodeAgentConversationTranscriptEventType,
  type NormalizeCodeAgentTranscriptOptions,
  type AgentConversationArtifact,
  type AgentConversationAttachment,
  type AgentConversationMessage,
  type AgentConversationMessagePart,
  type AgentConversationMessageRole,
  type AgentConversationNotice,
  type AgentConversationNoticeTone,
  type AgentConversationToolCall,
  type AgentConversationToolState,
} from "./conversation/index.js";
export { McpAppRenderer } from "./mcp-apps/McpAppRenderer.js";
export {
  AGENT_NATIVE_MCP_APP_HOST_MESSAGE_TYPES,
  getMcpAppHostContext,
  openMcpAppHostLink,
  requestMcpAppDisplayMode,
  updateMcpAppModelContext,
  useMcpAppHostContext,
  type AgentNativeMcpAppHostMessageType,
  type McpAppDisplayMode,
  type McpAppHostCapabilities,
  type McpAppHostContext,
  type McpAppHostContextSnapshot,
  type McpAppModelContextContentPart,
  type McpAppModelContextUpdate,
} from "./mcp-app-host.js";
export {
  CodeAgentIndicator,
  type CodeAgentIndicatorProps,
} from "./components/CodeAgentIndicator.js";
export {
  useDbSync,
  useFileWatcher,
  useScreenRefreshKey,
} from "./use-db-sync.js";
export {
  useChangeVersion,
  useChangeVersions,
  getChangeVersion,
  bumpChangeVersion,
} from "./use-change-version.js";
export {
  buildDynamicAgentSuggestions,
  dedupeSuggestions,
  mergeAgentSuggestions,
  normalizeAgentDynamicSuggestionsConfig,
  useAgentDynamicSuggestions,
  type AgentDynamicSuggestionContext,
  type AgentDynamicSuggestionsConfig,
  type AgentDynamicSuggestionsOption,
} from "./dynamic-suggestions.js";
export { cn } from "./utils.js";
export { ApiKeySettings } from "./components/ApiKeySettings.js";
export { useSession, type AuthSession } from "./use-session.js";
export {
  sendToFrame,
  onFrameMessage,
  requestUserInfo,
  getFrameOrigin,
  getCallbackOrigin,
  oauthRedirectUri,
  isInFrame,
  enterStyleEditing,
  enterTextEditing,
  exitSelectionMode,
  type UserInfo,
} from "./frame.js";
export {
  getBuilderParentOrigin,
  isInBuilderFrame,
  sendToBuilderChat,
  type BuilderChatMessage,
} from "./builder-frame.js";
export {
  AgentNative,
  useAgentNativeScreenContext,
  type AgentNativeCommandCallback,
  type AgentNativeCommandCallbackInfo,
  type AgentNativeProps,
} from "./AgentNative.js";
export {
  AgentNativeEmbedded,
  useAgentNativeEmbeddedBrowserSession,
  type AgentNativeEmbeddedBrowserSessionOptions,
  type AgentNativeEmbeddedCommandCallback,
  type AgentNativeEmbeddedCommandCallbackInfo,
  type AgentNativeEmbeddedProps,
  type UseAgentNativeEmbeddedBrowserSessionOptions,
} from "./AgentNativeEmbedded.js";
export {
  defineClientAction,
  type AgentNativeClientActionDefinition,
  type AgentNativeClientActionRunner,
} from "./client-action.js";
export {
  AgentNativeFrame,
  type AgentNativeFrameProps,
} from "./AgentNativeFrame.js";
export {
  AgentNativeExtensionFrame,
  AgentNativeExtensionSlot,
  type AgentNativeExtensionFrameProps,
  type AgentNativeExtensionPermissionList,
  type AgentNativeExtensionSlotProps,
  type AgentNativeExtensionStorageScopeList,
} from "./extensions/AgentNativeExtensionFrame.js";
export {
  AGENT_NATIVE_EXTENSION_MESSAGE_TYPES,
  buildAgentNativeExtensionHtml,
  createHttpAgentNativeExtensionStorage,
  createLocalStorageAgentNativeExtensionStorage,
  getAgentNativeExtensionManifest,
  isAgentNativeExtensionAllowedInSlot,
  normalizeAgentNativeExtensionSandbox,
  type AgentNativeExtensionDefinition,
  type AgentNativeExtensionManifest,
  type AgentNativeExtensionMessageType,
  type AgentNativeExtensionStorage,
  type AgentNativeExtensionStorageContext,
  type AgentNativeExtensionStorageOptions,
  type AgentNativeExtensionStorageRow,
  type AgentNativeExtensionStorageScope,
  type BuildAgentNativeExtensionHtmlOptions,
  type CreateHttpAgentNativeExtensionStorageOptions,
} from "./extensions/portable-extension.js";
export {
  AGENT_NATIVE_HOST_BRIDGE_VERSION,
  AGENT_NATIVE_HOST_MESSAGE_TYPES,
  announceAgentNativeFrameReady,
  createAgentNativeHostBridge,
  defaultAgentNativeHostCommands,
  onAgentNativeHostInit,
  readAgentNativeScreenContext,
  requestAgentNativeHostActions,
  requestAgentNativeHostContext,
  runAgentNativeHostAction,
  sendAgentNativeHostCommand,
  type AgentNativeActionAvailability,
  type AgentNativeActionManifestEntry,
  type AgentNativeClientAction,
  type AgentNativeClientActionApprovalConfig,
  type AgentNativeClientActionGetter,
  type AgentNativeClientActionRuntime,
  type AgentNativeClientActions,
  type AgentNativeHostAuth,
  type AgentNativeHostAuthPayload,
  type AgentNativeHostBridge,
  type AgentNativeHostBridgeEvent,
  type AgentNativeHostBridgeOptions,
  type AgentNativeHostCapabilities,
  type AgentNativeHostCommandHandler,
  type AgentNativeHostCommandHandlers,
  type AgentNativeHostCommandRequest,
  type AgentNativeHostContext,
  type AgentNativeHostContextGetter,
  type AgentNativeHostInit,
  type AgentNativeHostMessageType,
  type AgentNativeHostRequestOptions,
  type AgentNativeHostResourceContext,
  type AgentNativeHostRouteContext,
  type AgentNativeHostSelectionContext,
  type AgentNativeHostSession,
  type AgentNativeJsonSchema,
  type AgentNativeScreenSnapshot,
  type AgentNativeScreenSnapshotOptions,
  type BuiltInAgentNativeHostCommand,
} from "./host-bridge.js";
export {
  AGENT_NATIVE_HOST_TOOL_NAMES,
  createAgentNativeHostTools,
  type AgentNativeHostToolDefinition,
  type AgentNativeHostToolName,
  type AgentNativeHostToolParameters,
  type AgentNativeHostToolSet,
  type CreateAgentNativeHostToolsOptions,
  type RunAgentNativeHostActionToolInput,
  type SendAgentNativeHostCommandToolInput,
} from "./host-tools.js";
export {
  createAgentNativeBrowserSessionBridge,
  startAgentNativeBrowserSessionBridge,
  type AgentNativeBrowserSessionBridge,
  type AgentNativeBrowserSessionBridgeOptions,
} from "./browser-session-bridge.js";
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
  NewWorkspaceAppFlow,
  type NewWorkspaceAppFlowProps,
  type VaultSecretOption,
} from "./NewWorkspaceAppFlow.js";
export {
  AssistantChat,
  clearChatStorage,
  type AssistantChatProps,
  type AssistantChatHandle,
} from "./AssistantChat.js";
export {
  MultiTabAssistantChat,
  type MultiTabAssistantChatProps,
  type MultiTabAssistantChatHeaderProps,
} from "./MultiTabAssistantChat.js";
export { RunStuckBanner, type RunStuckBannerProps } from "./RunStuckBanner.js";
export {
  useRunStuckDetection,
  useAbortRun,
  type RunStuckState,
  type UseRunStuckDetectionOptions,
} from "./use-run-stuck-detection.js";
export { createAgentChatAdapter } from "./agent-chat-adapter.js";
export {
  AgentComposerFrame,
  type AgentComposerFrameProps,
  PromptComposer,
  AGENT_PROMPT_MAX_INLINE_IMAGE_BYTES,
  AGENT_PROMPT_MAX_INLINE_TEXT_CHARS,
  escapePromptAttachmentAttribute,
  formatPromptWithAttachments,
  isInlineableAgentPromptFile,
  readAgentPromptAttachment,
  type PromptComposerProps,
  type PromptComposerFile,
  type PromptComposerSubmitOptions,
  type AgentPromptAttachment,
  type ReadAgentPromptAttachmentOptions,
  type AgentComposerLayoutVariant,
  type SlashCommand,
  type SkillResult,
} from "./composer/index.js";
export type { TiptapComposerHandle } from "./composer/TiptapComposer.js";
export {
  GuidedQuestionFlow,
  useGuidedQuestionFlow,
  formatGuidedAnswerValue,
  formatGuidedAnswersForAgent,
  getOtherGuidedAnswerText,
  hasGuidedAnswer,
  isOtherGuidedAnswer,
  makeOtherGuidedAnswer,
  normalizeGuidedAnswers,
  type GuidedQuestion,
  type GuidedQuestionAnswers,
  type GuidedQuestionFlowProps,
  type GuidedQuestionOption,
  type GuidedQuestionPayload,
  type GuidedQuestionType,
  type UseGuidedQuestionFlowOptions,
} from "./guided-questions.js";
export {
  useChatThreads,
  type ChatThreadScope,
  type ChatThreadSummary,
  type ChatThreadData,
} from "./use-chat-threads.js";
export {
  AgentChatSurface,
  AgentPanel,
  AgentSidebar,
  AgentToggleButton,
  focusAgentChat,
  type AgentChatSurfaceMode,
  type AgentChatSurfaceProps,
  type AgentPanelProps,
  type AgentSidebarProps,
} from "./AgentPanel.js";
export {
  SIDEBAR_STATE_CHANGE_EVENT,
  type AgentSidebarStateChangeDetail,
  type AgentSidebarStateMode,
  type AgentSidebarStateSource,
} from "./agent-sidebar-state.js";
export { AgentNativeIcon } from "./components/icons/AgentNativeIcon.js";
export { SettingsPanel, type SettingsPanelProps } from "./settings/index.js";
export { useBuilderStatus } from "./settings/useBuilderStatus.js";
export {
  openBuilderConnectPopup,
  useBuilderConnectFlow,
  type BuilderConnectFlow,
  type BuilderConnectFlowOptions,
  type OpenBuilderConnectPopupOptions,
} from "./settings/useBuilderStatus.js";
// Deprecated — use AgentSidebar + AgentToggleButton instead
export {
  ProductionAgentPanel,
  type ProductionAgentPanelProps,
} from "./ProductionAgentPanel.js";
export {
  useProductionAgent,
  type ProductionAgentMessage,
  type UseProductionAgentOptions,
  type UseProductionAgentResult,
} from "./useProductionAgent.js";
export { Turnstile, type TurnstileProps } from "./Turnstile.js";
export {
  OpenSourceBadge,
  PoweredByBadge,
  type OpenSourceBadgeProps,
  type PoweredByBadgeProps,
} from "./PoweredByBadge.js";
export { FeedbackButton, type FeedbackButtonProps } from "./FeedbackButton.js";
export { ErrorBoundary } from "./ErrorBoundary.js";
export { installRouteChunkRecovery } from "./route-chunk-recovery.js";
export { ClientOnly } from "./ClientOnly.js";
export { DefaultSpinner } from "./DefaultSpinner.js";
export {
  getThemeInitScript,
  themeInitScript,
  type ThemePreference,
} from "./theme.js";
export {
  APPEARANCE_PRESETS,
  applyAppearance,
  getStoredAppearance,
  useAppearance,
  useAppearanceSync,
  type AppearancePresetId,
} from "./appearance.js";
export {
  AppearancePicker,
  type AppearancePickerProps,
} from "./AppearancePicker.js";
export { AgentTerminal, type AgentTerminalProps } from "./terminal/index.js";
export {
  trackEvent,
  trackSessionStatus,
  configureTracking,
  setSentryUser,
  captureError,
  captureClientException,
  type ClientCaptureContext,
} from "./analytics.js";
export {
  useCollaborativeDoc,
  emailToColor,
  emailToName,
  type UseCollaborativeDocOptions,
  type UseCollaborativeDocResult,
  type CollabUser,
} from "../collab/client.js";
export {
  ResourcesPanel,
  ResourceTree,
  ResourceEditor,
  useResources,
  useResourceTree,
  useResource,
  useCreateResource,
  useUpdateResource,
  useDeleteResource,
  useUploadResource,
  type Resource,
  type ResourceMeta,
  type TreeNode,
  type ResourceScope,
  type ResourceTreeProps,
  type ResourceEditorProps,
} from "./resources/index.js";
export type {
  AppToFrameMessage,
  FrameToAppMessage,
  FrameMessage,
  CodeCompleteMessage,
  ChatRunningMessage,
} from "./frame-protocol.js";
export {
  CommandMenu,
  useCommandMenuShortcut,
  openAgentSidebar,
  submitToAgent,
  type CommandMenuProps,
  type CommandGroupProps,
  type CommandItemProps,
  type CommandShortcutProps,
} from "./CommandMenu.js";
export {
  DevOverlay,
  useDevOverlayShortcut,
  registerDevPanel,
  unregisterDevPanel,
  listDevPanels,
  subscribeDevPanels,
  useDevOption,
  clearAllDevOverlayStorage,
  devOptionKey,
  DEV_OVERLAY_STORAGE_PREFIX,
  type DevOverlayProps,
  type DevPanel,
  type DevOption,
  type DevBooleanOption,
  type DevSelectOption,
  type DevStringOption,
  type DevActionOption,
  type DevOptionValue,
} from "./dev-overlay/index.js";
export {
  useActionQuery,
  useActionMutation,
  type ActionRegistry,
} from "./use-action.js";
export { usePinchZoom, type UsePinchZoomOptions } from "./use-pinch-zoom.js";
export {
  ShareButton,
  ShareDialog,
  VisibilityBadge,
  type ShareButtonProps,
  type ShareDialogProps,
  type VisibilityBadgeProps,
} from "./sharing/index.js";
export {
  postNavigate,
  isInAgentEmbed,
  AGENT_NAVIGATE_MESSAGE_TYPE,
  type AgentNavigateMessage,
} from "./embed.js";
export { IframeEmbed, parseEmbedBody } from "./IframeEmbed.js";
export {
  useAvatarUrl,
  uploadAvatar,
  invalidateAvatarCache,
} from "./use-avatar.js";
export {
  ObservabilityDashboard,
  ThumbsFeedback,
} from "./observability/index.js";
// Presence UI components
export {
  PresenceBar,
  type PresenceBarProps,
} from "./components/PresenceBar.js";
export {
  AgentPresenceChip,
  type AgentPresenceChipProps,
} from "./components/AgentPresenceChip.js";
// Structured data collaboration hooks
export {
  useCollaborativeMap,
  useCollaborativeArray,
  type UseCollaborativeMapOptions,
  type UseCollaborativeMapResult,
  type UseCollaborativeArrayOptions,
  type UseCollaborativeArrayResult,
} from "../collab/client-struct.js";
export { NotificationsBell } from "./notifications/index.js";
