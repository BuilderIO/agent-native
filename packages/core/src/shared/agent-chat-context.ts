import { splitAgentKitMessageContext } from "@agent-native/agentkit/chat-context";

export { appendAgentChatContextToMessage } from "@agent-native/agentkit/chat-context";
export type { AgentKitMessageParts as AgentChatMessageParts } from "@agent-native/agentkit/chat-context";

export const splitAgentChatContextFromMessage = splitAgentKitMessageContext;
