import {
  sendToAgentChat,
  type AgentChatMessage,
} from "@agent-native/core/client/agent-chat";

export function sendToPlanCreationAgentChat(opts: AgentChatMessage): string {
  return sendToAgentChat({
    ...opts,
    chatTarget: "local",
    newTab: true,
    reuseEmptyTab: true,
  });
}
