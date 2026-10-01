import { splitAgentKitMessageContext } from "@agent-native/agentkit";

export type { AgentKitMessageParts as AgentChatMessageParts } from "@agent-native/agentkit";

export function appendAgentChatContextToMessage(
  message: string,
  context: string,
): string {
  const trimmedContext = context.trim();
  if (!trimmedContext) return message;
  return `${escapeContextMarkup(message)}\n\n<context data-agentkit-context-encoding="entities-v1">\n${escapeContextMarkup(trimmedContext)}\n</context>`;
}

function escapeContextMarkup(text: string): string {
  return text.replaceAll("&", "&amp;").replace(/<(?=\/?context\b)/gi, "&lt;");
}

export const splitAgentChatContextFromMessage = splitAgentKitMessageContext;
