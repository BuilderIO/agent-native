import { splitAgentKitMessageContext } from "@agent-native/agentkit";

export { appendAgentChatContextToMessage } from "@agent-native/agentkit";
export type { AgentKitMessageParts as AgentChatMessageParts } from "@agent-native/agentkit";

export const splitAgentChatContextFromMessage = splitAgentKitMessageContext;
