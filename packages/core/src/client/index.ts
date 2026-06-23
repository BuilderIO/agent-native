import { installRouteChunkRecovery } from "./route-chunk-recovery.js";
import { stripAuthRedirectParamFromUrl } from "./auth-redirect-url.js";

installRouteChunkRecovery();
stripAuthRedirectParamFromUrl();

export { getBrowserTabId } from "./browser-tab-id.js";

export {
  addContextToAgentChat,
  appendAgentChatContextToMessage,
  clearAgentChatContext,
  formatAgentChatContextItemsForPrompt,
  listAgentChatContext,
  refreshAgentChatContext,
  removeAgentChatContextItem,
  sendToAgentChat,
  parseSubmitChatMessage,
  setAgentChatContextItem,
  setContextToAgentChat,
  generateTabId,
  type ParsedSubmitChat,
  type AgentChatContextItem,
  type AgentChatContextMessage,
  type AgentChatContextMutationOptions,
  type AgentChatContextRemoveOptions,
  type AgentChatContextSetOptions,
  type AgentChatContextState,
  type AgentChatMessage,
} from "./agent-chat.js";
export {
  saveAgentEngineApiKey,
  type AgentEngineProvider,
  type SaveAgentEngineApiKeyOptions,
} from "./agent-engine-key.js";
export { useAgentChatGenerating } from "./use-agent-chat.js";
export {
  useAgentChatContext,
  type UseAgentChatContextResult,
} from "./use-agent-chat-context.js";
export { useCodeMode, useDevMode } from "./use-dev-mode.js";
export {
  agentNativePath,
  appApiPath,
  appBasePath,
  appPath,
} from "./api-path.js";
export {
  deleteClientAppState,
  readClientAppState,
  setClientAppState,
  writeClientAppState,
  type ClientAppStateReadOptions,
  type ClientAppStateWriteOptions,
} from "./application-state.js";
export {
  useAgentRouteState,
  useSemanticNavigationState,
  type AgentRouteLocation,
  type SemanticNavigationCommandEnvelope,
  type UseAgentRouteStateOptions,
  type UseAgentRouteStateResult,
  type UseSemanticNavigationStateOptions,
  type UseSemanticNavigationStateResult,
} from "./route-state.js";
export {
  ensureEmbedAuthFetchInterceptor,
  getEmbedAuthToken,
  isEmbedAuthActive,
  isEmbedMcpChatBridgeActive,
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
  useAgentEngineConfigured,
  type AgentEngineConfiguredState,
  type UseAgentEngineConfiguredResult,
} from "./use-agent-engine-configured.js";
export { BuilderSetupCard } from "./chat/run-recovery.js";
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
  sendMcpAppHostMessage,
  updateMcpAppModelContext,
  useMcpAppHostContext,
  type AgentNativeMcpAppHostMessageType,
  type McpAppDisplayMode,
  type McpAppHostChatMessage,
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
export { useReconciledState } from "./use-external-value.js";
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
export {
  // Shared editor core (Phase 1): the ONE configurable surface both the plan
  // and content editors build on.
  SharedRichEditor,
  createSharedEditorExtensions,
  MARKDOWN_DIALECT_CONFIG,
  useCollabReconcile,
  RICH_MARKDOWN_PROGRAMMATIC_TRANSACTION,
  getEditorMarkdown,
  SlashCommandMenu,
  DEFAULT_SLASH_COMMANDS,
  createImageSlashCommand,
  // Shared block-level image node + injectable upload contract. Plans opt in
  // via `features.image` + `onImageUpload`; Content keeps its own image block.
  SharedImage,
  createImageExtension,
  pickAndInsertImage,
  uploadEditorImage,
  BubbleToolbar,
  buildDefaultBubbleItems,
  // Back-compat alias + factory kept for existing embedders and specs.
  RichMarkdownEditor,
  createRichMarkdownExtensions,
  // Single-doc plan editor primitives: the GFM↔ProseMirror serializer, the
  // run-id prose attribute, and the shared drag-handle (block grip + reorder).
  RunId,
  RUN_ID_NODE_TYPES,
  gfmToProseJSON,
  proseJSONToGfm,
  DragHandle,
  DEFAULT_DRAG_HANDLE_WRAPPER_SELECTOR,
  // Generic registry-block Tiptap NodeView + side-map provider + dedupe plugin.
  // Hosts mount the node from `createRegistryBlockNode` as an extra extension
  // and wrap the editor in `RegistryBlockDataProvider`.
  createRegistryBlockNode,
  RegistryBlockNodeView,
  RegistryBlockDataProvider,
  useRegistryBlockData,
  // Shared registry-derived block slash-command builder (plan + content adapt it).
  buildRegistryBlockSlashItems,
  getRegistryBlockSlashDescription,
  getRegistryBlockSlashSearchText,
  type BuildRegistryBlockSlashItemsOptions,
  type DragHandleDropContext,
  type DragHandleDropPlacement,
  type DragHandleOptions,
  type CreateRegistryBlockNodeOptions,
  type RegistryBlockDataValue,
  type RegistryBlockSideMapBlock,
  type SharedRichEditorProps,
  type SharedEditorCollab,
  type SharedEditorFeatures,
  type CreateSharedEditorExtensionsOptions,
  type UseCollabReconcileOptions,
  type UseCollabReconcileResult,
  type SlashCommandItem,
  type SlashCommandMenuProps,
  type ImageUploadFn,
  type SharedImageOptions,
  type BubbleToolbarItem,
  type BubbleToolbarProps,
  type RichMarkdownDialect,
  type RichMarkdownEditorPreset,
  type RichMarkdownEditorProps,
  type RichMarkdownCollabUser,
  type CreateRichMarkdownExtensionsOptions,
} from "./rich-markdown-editor/index.js";
// ProseMirror node JSON shape — re-exported so the plan template (which has no
// direct @tiptap dep) can type its doc↔blocks serializer.
export type { JSONContent } from "@tiptap/core";
export { ApiKeySettings } from "./components/ApiKeySettings.js";
export { useSession, type AuthSession } from "./use-session.js";
export {
  RequireSession,
  buildSignInReturnHref,
  type RequireSessionProps,
} from "./require-session.js";
export {
  sendToFrame,
  onFrameMessage,
  requestUserInfo,
  getFrameOrigin,
  getFramePostMessageTargetOrigin,
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
  AgentNativeRouteWarmup,
  type AgentNativeRouteWarmupProps,
} from "./route-warmup.js";
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
  type AssistantChatAdapterContext,
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
export {
  createAgentChatAdapter,
  type AgentChatSurfaceKind,
  type CreateAgentChatAdapterOptions,
} from "./agent-chat-adapter.js";
export {
  AgentComposerFrame,
  type AgentComposerFrameProps,
  PromptComposer,
  TiptapComposer,
  AGENT_PROMPT_MAX_INLINE_IMAGE_BYTES,
  AGENT_PROMPT_MAX_INLINE_TEXT_CHARS,
  escapePromptAttachmentAttribute,
  formatPromptWithAttachments,
  isInlineableAgentPromptFile,
  readAgentPromptAttachment,
  type PromptComposerProps,
  type PromptComposerFile,
  type PromptComposerSubmitOptions,
  type ComposerSubmitIntent,
  type AgentPromptAttachment,
  type ReadAgentPromptAttachmentOptions,
  type AgentComposerLayoutVariant,
  type SlashCommand,
  type SkillResult,
  type TiptapComposerHandle,
  type TiptapComposerProps,
  type TiptapComposerSubmitOptions,
} from "./composer/index.js";
export {
  GuidedQuestionFlow,
  useGuidedQuestionFlow,
  askUserQuestion,
  formatGuidedAnswerValue,
  formatGuidedAnswersForAgent,
  getOtherGuidedAnswerText,
  hasGuidedAnswer,
  isOtherGuidedAnswer,
  makeOtherGuidedAnswer,
  normalizeGuidedAnswers,
  type AskUserQuestionInput,
  type AskUserQuestionOption,
  type AskUserQuestionResult,
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
  type ChatThreadSnapshot,
  type ChatThreadSummary,
  type ChatThreadData,
  type ChatThreadShareLink,
  type ChatThreadShareState,
  type UseChatThreadsOptions,
} from "./use-chat-threads.js";
export { AgentChatHome, type AgentChatHomeProps } from "./AgentChatHome.js";
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
  AGENT_CHAT_HOME_HANDOFF_TTL_MS,
  AGENT_CHAT_VIEW_TRANSITION_CLASS,
  AGENT_CHAT_VIEW_TRANSITION_NAME,
  consumeAgentChatHomeHandoff,
  getAgentChatViewTransitionStyle,
  markAgentChatHomeHandoff,
  navigateWithAgentChatViewTransition,
  startAgentChatViewTransition,
  supportsAgentChatViewTransition,
  type AgentChatHomeHandoffOptions,
  type AgentChatViewTransition,
  type AgentChatViewTransitionOptions,
} from "./chat-view-transition.js";
export {
  useAgentChatHomeHandoff,
  useAgentChatHomeHandoffLinks,
  type UseAgentChatHomeHandoffLinksOptions,
  type UseAgentChatHomeHandoffOptions,
} from "./use-agent-chat-home-handoff.js";
export {
  requestAgentSidebarOpen,
  SIDEBAR_STATE_CHANGE_EVENT,
  setAgentSidebarOpenPreference,
  type AgentSidebarStateChangeDetail,
  type AgentSidebarStateMode,
  type AgentSidebarStateSource,
} from "./agent-sidebar-state.js";
export {
  clearReservedToolRenderersForTests,
  clearToolRenderersForTests,
  registerActionChatRenderer,
  registerFallbackToolRenderer,
  registerReservedActionChatRenderer,
  registerReservedFallbackToolRenderer,
  registerReservedToolRenderer,
  registerToolRenderer,
  resolveToolRenderer,
  type ActionChatRendererRegistration,
  type ToolRendererComponent,
  type ToolRendererContext,
  type ToolRendererMatch,
  type ToolRendererProps,
  type ToolRendererRegistration,
} from "./chat/tool-render-registry.js";
export * from "./chat/connectors.js";
export * from "./chat/runtime.js";
export {
  ACTION_CHAT_UI_DATA_CHART_RENDERER,
  ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER,
  ACTION_CHAT_UI_DATA_TABLE_RENDERER,
  ACTION_CHAT_UI_DATA_WIDGET_RENDERER,
  type ActionChatUIConfig,
} from "../action-ui.js";
export {
  DATA_CHART_WIDGET,
  DATA_INSIGHTS_WIDGET,
  DATA_TABLE_WIDGET,
  createDataChartWidgetResult,
  createDataInsightsWidgetResult,
  createDataTableWidgetResult,
  dataChartWidgetResultSchema,
  dataChartWidgetSchema,
  dataInsightsWidgetResultSchema,
  dataTableWidgetResultSchema,
  dataTableWidgetSchema,
  dataWidgetResultSchema,
  isDataChartWidget,
  isDataTableWidget,
  isDataWidgetResult,
  normalizeDataWidgetKind,
  normalizeDataWidgetResult,
  type DataChartSeriesDefinition,
  type DataChartWidget,
  type DataChartWidgetResult,
  type DataChartWidgetResultInput,
  type DataInsightsWidgetResult,
  type DataInsightsWidgetResultInput,
  type DataTableColumn,
  type DataTableWidget,
  type DataTableWidgetResult,
  type DataTableWidgetResultInput,
  type DataWidgetDisplay,
  type DataWidgetKind,
  type DataWidgetResult,
  type DataWidgetResultMetadata,
} from "./chat/widgets/data-widget-types.js";
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
export {
  StarfieldBackground,
  type StarfieldBackgroundProps,
} from "./StarfieldBackground.js";
export { FeedbackButton, type FeedbackButtonProps } from "./FeedbackButton.js";
export {
  DevDatabaseLink,
  type DevDatabaseLinkProps,
} from "./db-admin/DevDatabaseLink.js";
export { ErrorBoundary } from "./ErrorBoundary.js";
export {
  installRouteChunkRecovery,
  reloadForStaleChunk,
  recoverFromStaleChunkError,
} from "./route-chunk-recovery.js";
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
export { track } from "./track.js";
export {
  useCollaborativeDoc,
  isReconcileLeadClient,
  emailToColor,
  emailToName,
  dedupeCollabUsersByEmail,
  type UseCollaborativeDocOptions,
  type UseCollaborativeDocResult,
  type CollabUser,
} from "../collab/client.js";
export { AGENT_CLIENT_ID } from "../collab/agent-identity.js";
// Presence kit
export {
  usePresence,
  toNormalized,
  fromNormalized,
  type OtherPresence,
  type PresencePayload,
  type UsePresenceResult,
  type NormalizedPoint,
} from "../collab/presence.js";
export {
  useFollowUser,
  type UseFollowUserOptions,
  type UseFollowUserResult,
  type ViewportDescriptor,
} from "../collab/follow-mode.js";
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
  type CommandMenuDoc,
  type CommandDocsGroupProps,
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
  callAction,
  useActionQuery,
  useActionMutation,
  type ActionRegistry,
  type ClientActionCallOptions,
  type ClientActionMethod,
} from "./use-action.js";
export { createAgentNativeQueryClient } from "./create-query-client.js";
export { AppProviders, type AppProvidersProps } from "./app-providers.js";
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
export {
  LiveCursorOverlay,
  type LiveCursorOverlayProps,
  type CursorMapFn,
} from "./components/LiveCursorOverlay.js";
export {
  RemoteSelectionRings,
  type RemoteSelectionRingsProps,
} from "./components/RemoteSelectionRings.js";
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
// Block registry (also available as the dedicated `@agent-native/core/blocks`
// subpath, which server/agent code should prefer via `/blocks/server`).
export {
  defineBlock,
  BlockRegistry,
  registerBlocks,
  BlockRegistryProvider,
  useBlockRegistry,
  useOptionalBlockRegistry,
  BlockView,
  SchemaBlockEditor,
  markdown,
  richtext,
  introspect,
  serializeSpecBlock,
  parseSpecBlock,
  createAttrReader,
  describeBlocksForAgent,
  renderBlockVocabularyReference,
  type BlockSpec,
  type BlockPlacement,
  type BlockMdxConfig,
  type BlockAttrReader,
  type BlockRenderContext,
  type BlockReadProps,
  type BlockEditProps,
  type MdxAttrValue,
  type FieldKind,
  type FieldDescriptor,
  type MdxJsxNode,
  type MdxAttrNode,
  type SerializableBlock,
  type ParsedBlockBase,
  type BlockAgentDoc,
} from "./blocks/index.js";
