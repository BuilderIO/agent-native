import { splitAgentKitMessageContext } from "@agent-native/agentkit";

export type { AgentKitMessageParts as AgentChatMessageParts } from "@agent-native/agentkit";

export function appendAgentChatContextToMessage(
  message: string,
  context: string,
): string {
  const trimmedContext = context.trim();
  if (!trimmedContext) return message;
  return `${message}\n\n<context>\n${trimmedContext}\n</context>`;
}

export const splitAgentChatContextFromMessage = splitAgentKitMessageContext;
