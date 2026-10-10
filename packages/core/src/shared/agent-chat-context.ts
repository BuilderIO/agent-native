import { splitAgentKitMessageContext } from "@agent-native/agentkit/chat-context";

export { appendAgentChatContextToMessage } from "@agent-native/agentkit/chat-context";
export type { AgentKitMessageParts as AgentChatMessageParts } from "@agent-native/agentkit/chat-context";

export const splitAgentChatContextFromMessage = splitAgentKitMessageContext;

const ENCODED_AGENT_CHAT_CONTEXT_OPENING =
  '<context data-agentkit-context-encoding="entities-v1">';
const LEGACY_CONTEXT_OPEN_PATTERN = /<context(?=[\s>])[^>]*>/gi;

export function stripAgentChatContextFromMessage(text: string): string {
  LEGACY_CONTEXT_OPEN_PATTERN.lastIndex = 0;
  const opening = LEGACY_CONTEXT_OPEN_PATTERN.exec(text);
  if (!opening) return text;

  if (opening[0] === ENCODED_AGENT_CHAT_CONTEXT_OPENING)
    return splitAgentChatContextFromMessage(text).message;

  const closingPattern = /<\/context(?=[\s>])[^>]*>/gi;
  closingPattern.lastIndex = opening.index + opening[0].length;
  let lastClosing: RegExpExecArray | null = null;
  let closing = closingPattern.exec(text);
  while (closing) {
    lastClosing = closing;
    closing = closingPattern.exec(text);
  }

  if (!lastClosing) return text.slice(0, opening.index);
  LEGACY_CONTEXT_OPEN_PATTERN.lastIndex =
    lastClosing.index + lastClosing[0].length;
  if (LEGACY_CONTEXT_OPEN_PATTERN.exec(text))
    return text.slice(0, opening.index);
  return (
    text.slice(0, opening.index) +
    text.slice(lastClosing.index + lastClosing[0].length)
  );
}
