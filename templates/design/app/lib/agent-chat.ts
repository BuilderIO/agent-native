import {
  sendToAgentChat,
  type AgentChatMessage,
} from "@agent-native/core/client";

export const DESIGN_CHAT_STORAGE_KEY = "design";

export function sendToDesignAgentChat(opts: AgentChatMessage): string {
  return sendToAgentChat({
    ...opts,
    chatTarget: "local",
  });
}
