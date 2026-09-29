/** Compatibility exports for callers migrating to the AgentKit chat surface. */
export {
  AgentKitAssistantChat,
  AgentKitAssistantChat as AssistantChat,
} from "./AgentKitAssistantChat.js";
export type { AgentKitAssistantChatProps } from "./AgentKitAssistantChat.js";
export type {
  AgentRequestMode,
  AgentRecoveryAction,
  AssistantChatAdapterContext,
  AssistantChatHandle,
  AssistantChatProps,
  AssistantChatSendOptions,
  AssistantChatSubmitResult,
  AssistantChatSuggestionVisibility,
  AssistantChatThreadFooterSlot,
} from "./chat/surface-types.js";
export { CHAT_STORAGE_PREFIX, clearChatStorage } from "./chat/storage.js";
