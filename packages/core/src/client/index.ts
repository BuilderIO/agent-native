export {
  sendToAgentChat,
  generateTabId,
  type AgentChatMessage,
} from "./agent-chat.js";
export { useAgentChatGenerating } from "./use-agent-chat.js";
export { useDevMode } from "./use-dev-mode.js";
export { useSendToAgentChat } from "./use-send-to-agent-chat.js";
export {
  CodeRequiredDialog,
  type CodeRequiredDialogProps,
} from "./components/CodeRequiredDialog.js";
export {
  CodeAgentIndicator,
  type CodeAgentIndicatorProps,
} from "./components/CodeAgentIndicator.js";
export { useDbSync, useFileWatcher } from "./use-db-sync.js";
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
  // Backward compatibility aliases
  sendToHarness,
  onHarnessMessage,
  getHarnessOrigin,
  isInHarness,
  type UserInfo,
} from "./frame.js";
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
export { ErrorBoundary } from "./ErrorBoundary.js";
export { ClientOnly } from "./ClientOnly.js";
export { DefaultSpinner } from "./DefaultSpinner.js";
export { AgentTerminal, type AgentTerminalProps } from "./terminal/index.js";
export { trackEvent, trackSessionStatus } from "./analytics.js";
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
  // Backward compatibility aliases
  AppToHarnessMessage,
  HarnessToAppMessage,
  HarnessMessage,
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
