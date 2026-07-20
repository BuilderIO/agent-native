export {
  AgentAskPopover,
  type AgentAskPopoverProps,
} from "../AgentAskPopover.js";
export {
  addContextToAgentChat,
  appendAgentChatContextToMessage,
  clearAgentChatContext,
  formatAgentChatContextItemsForPrompt,
  insertAgentComposerReference,
  listAgentChatContext,
  normalizeAgentComposerReference,
  refreshAgentChatContext,
  removeAgentChatContextItem,
  requestAgentChatThreadOpen,
  requestAgentTaskOpen,
  sendToAgentChat,
  sendToAgentChatAndConfirm,
  reportAgentChatSubmitResult,
  AGENT_CHAT_SUBMIT_RESULT_EVENT,
  parseSubmitChatMessage,
  setAgentChatContextItem,
  setContextToAgentChat,
  generateTabId,
  type ParsedSubmitChat,
  type AgentChatOpenTaskRequest,
  type AgentChatOpenThreadRequest,
  type AgentChatContextItem,
  type AgentChatContextMessage,
  type AgentChatContextMutationOptions,
  type AgentChatContextRemoveOptions,
  type AgentChatContextSetOptions,
  type AgentChatContextState,
  type AgentChatMessage,
  type AgentChatSubmitResult,
  type SendToAgentChatAndConfirmResult,
  type AgentComposerReference,
  type AgentComposerReferenceInsertOptions,
  type AgentComposerReferenceInsertPayload,
} from "../agent-chat.js";
export {
  saveAgentEngineApiKey,
  saveAgentEngineProviderSettings,
  type AgentEngineProvider,
  type SaveAgentEngineApiKeyOptions,
  type SaveAgentEngineProviderSettingsOptions,
} from "../agent-engine-key.js";
export { useAgentChatGenerating } from "../use-agent-chat.js";
export {
  useAgentChatContext,
  type UseAgentChatContextResult,
} from "../use-agent-chat-context.js";
export { useCodeMode, useDevMode } from "../use-dev-mode.js";
export {
  codeAgentTranscriptEventsToContent,
  codeAgentTranscriptHasPendingApproval,
  createCodeAgentChatAdapter,
  type CodeAgentChatController,
  type CodeAgentChatControlResult,
  type CodeAgentChatFollowUpMode,
  type CodeAgentChatTranscriptEvent,
  type CreateCodeAgentChatAdapterOptions,
} from "../code-agent-chat-adapter.js";
export {
  buildRepositoryFromCodeAgentTranscript,
  type BuildRepositoryFromCodeAgentTranscriptOptions,
  type CodeAgentThreadTranscriptEvent,
} from "../../agent/thread-data-builder.js";
export {
  compareCodeAgentTranscriptEvents,
  getCodeAgentTranscriptSeq,
  isCodeAgentRunActive,
  mergeCodeAgentTranscriptEvents,
  type CodeAgentRunStateLike,
  type CodeAgentTranscriptOrderEvent,
} from "../../code-agents/transcript-order.js";
export {
  CREDENTIAL_GAP_SIGNAL,
  isCredentialGapCodeAgentEvent,
} from "../../code-agents/transcript-normalizer.js";
export { useSendToAgentChat } from "../use-send-to-agent-chat.js";
export {
  useChatModels,
  type UseChatModelsResult,
  type EngineModelGroup,
} from "../use-chat-models.js";
export {
  CodeRequiredDialog,
  type CodeRequiredDialogProps,
} from "../components/CodeRequiredDialog.js";
export {
  useAgentEngineConfigured,
  type AgentEngineConfiguredState,
  type UseAgentEngineConfiguredResult,
} from "../use-agent-engine-configured.js";
export { BuilderSetupCard } from "../chat/run-recovery.js";
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
} from "../conversation/index.js";
export { McpAppRenderer } from "../mcp-apps/McpAppRenderer.js";
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
} from "../mcp-app-host.js";
export {
  CodeAgentIndicator,
  type CodeAgentIndicatorProps,
} from "../components/CodeAgentIndicator.js";
export {
  buildDynamicAgentSuggestions,
  dedupeSuggestions,
  mergeAgentSuggestions,
  normalizeAgentDynamicSuggestionsConfig,
  useAgentDynamicSuggestions,
  type AgentDynamicSuggestionContext,
  type AgentDynamicSuggestionsConfig,
  type AgentDynamicSuggestionsOption,
} from "../dynamic-suggestions.js";
export {
  AssistantChat,
  clearChatStorage,
  type AssistantChatProps,
  type AssistantChatHandle,
  type AssistantChatAdapterContext,
} from "../AssistantChat.js";
export {
  MultiTabAssistantChat,
  type MultiTabAssistantChatProps,
  type MultiTabAssistantChatHeaderProps,
} from "../MultiTabAssistantChat.js";
export { RunStuckBanner, type RunStuckBannerProps } from "../RunStuckBanner.js";
export {
  KeepTabOpenNotice,
  type KeepTabOpenNoticeProps,
} from "../KeepTabOpenNotice.js";
export {
  useRunStuckDetection,
  useAbortRun,
  type RunStuckState,
  type UseRunStuckDetectionOptions,
} from "../use-run-stuck-detection.js";
export {
  createAgentChatAdapter,
  type AgentChatSurfaceKind,
  type CreateAgentChatAdapterOptions,
} from "../agent-chat-adapter.js";
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
} from "../guided-questions.js";
export {
  useChatThreads,
  type ChatThreadScope,
  type ChatThreadSnapshot,
  type ChatThreadSummary,
  type ChatThreadData,
  type ChatThreadShareLink,
  type ChatThreadShareState,
  type UseChatThreadsOptions,
} from "../use-chat-threads.js";
export {
  ChatHistoryList,
  type ChatHistoryItem,
  type ChatHistorySection,
  type ChatHistoryListProps,
} from "../chat/ChatHistoryList.js";
export { AgentChatHome, type AgentChatHomeProps } from "../AgentChatHome.js";
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
} from "../AgentPanel.js";
export {
  AgentTabsPage,
  type AgentPageExtraTabContext,
  type AgentPageExtraTabFactory,
  type AgentTabsPageProps,
} from "../agent-page/AgentTabsPage.js";
export type { AgentPageScope, AgentPageTabProps } from "../agent-page/types.js";
export {
  AGENT_CHAT_HOME_HANDOFF_TTL_MS,
  AGENT_CHAT_VIEW_TRANSITION_CLASS,
  AGENT_CHAT_VIEW_TRANSITION_NAME,
  consumeAgentChatHomeHandoff,
  getAgentChatViewTransitionStyle,
  isAgentChatHomeHandoffActive,
  markAgentChatHomeHandoff,
  navigateWithAgentChatViewTransition,
  startAgentChatViewTransition,
  supportsAgentChatViewTransition,
  type AgentChatHomeHandoffOptions,
  type AgentChatViewTransition,
  type AgentChatViewTransitionOptions,
} from "../chat-view-transition.js";
export {
  useAgentChatHomeHandoff,
  useAgentChatHomeHandoffLinks,
  type UseAgentChatHomeHandoffLinksOptions,
  type UseAgentChatHomeHandoffOptions,
} from "../use-agent-chat-home-handoff.js";
export {
  requestAgentSidebarOpen,
  SIDEBAR_STATE_CHANGE_EVENT,
  setAgentSidebarOpenPreference,
  type AgentSidebarStateChangeDetail,
  type AgentSidebarStateMode,
  type AgentSidebarStateSource,
} from "../agent-sidebar-state.js";
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
} from "../chat/tool-render-registry.js";
export * from "../chat/connectors.js";
export * from "../chat/runtime.js";
