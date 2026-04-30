export {
  sendToAgentChat,
  generateTabId,
  type AgentChatMessage,
} from "./agent-chat.js";
export { DEV_MODE_USER_EMAIL } from "./dev-mode.js";
export { useAgentChatGenerating } from "./use-agent-chat.js";
export { useDevMode } from "./use-dev-mode.js";
export { useBuilderEnabled } from "./use-builder-enabled.js";
export { agentNativePath, appBasePath } from "./api-path.js";
export { useSendToAgentChat } from "./use-send-to-agent-chat.js";
export {
  CodeRequiredDialog,
  type CodeRequiredDialogProps,
} from "./components/CodeRequiredDialog.js";
export {
  CodeAgentIndicator,
  type CodeAgentIndicatorProps,
} from "./components/CodeAgentIndicator.js";
export {
  useDbSync,
  useFileWatcher,
  useScreenRefreshKey,
} from "./use-db-sync.js";
export { cn } from "./utils.js";
export { ApiKeySettings } from "./components/ApiKeySettings.js";
export { useSession, type AuthSession } from "./use-session.js";
export {
  sendToFrame,
  onFrameMessage,
  requestUserInfo,
  getFrameOrigin,
  getCallbackOrigin,
  isInFrame,
  enterStyleEditing,
  enterTextEditing,
  exitSelectionMode,
  type UserInfo,
} from "./frame.js";
export {
  AssistantChat,
  BuilderCtaCard,
  clearChatStorage,
  type AssistantChatProps,
  type AssistantChatHandle,
} from "./AssistantChat.js";
export {
  MultiTabAssistantChat,
  type MultiTabAssistantChatProps,
  type MultiTabAssistantChatHeaderProps,
} from "./MultiTabAssistantChat.js";
export { createAgentChatAdapter } from "./agent-chat-adapter.js";
export {
  useChatThreads,
  type ChatThreadSummary,
  type ChatThreadData,
} from "./use-chat-threads.js";
export {
  AgentPanel,
  AgentSidebar,
  AgentToggleButton,
  focusAgentChat,
  type AgentPanelProps,
  type AgentSidebarProps,
} from "./AgentPanel.js";
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
export { PoweredByBadge, type PoweredByBadgeProps } from "./PoweredByBadge.js";
export { FeedbackButton, type FeedbackButtonProps } from "./FeedbackButton.js";
export { ErrorBoundary } from "./ErrorBoundary.js";
export { ClientOnly } from "./ClientOnly.js";
export { DefaultSpinner } from "./DefaultSpinner.js";
export { AgentTerminal, type AgentTerminalProps } from "./terminal/index.js";
export {
  trackEvent,
  trackSessionStatus,
  configureTracking,
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
