/**
 * The `<context>` envelope an app wraps around hidden prompt context, and its
 * inverse. Anything that classifies intent must read the two halves apart: the
 * message is what the user asked for, the context is what the app attached.
 */

const CONTEXT_BLOCK_PATTERN = /<context\b[^>]*>([\s\S]*?)<\/context>\n?/gi;
const UNCLOSED_CONTEXT_PATTERN = /<context\b[^>]*>([\s\S]*)$/i;
const STRAY_CONTEXT_CLOSE_PATTERN = /<\/context>/gi;

export interface AgentChatMessageParts {
  /** The user-visible prompt, with every attached context block removed. */
  message: string;
  /** The attached context bodies, joined; empty when nothing was attached. */
  context: string;
}

export function appendAgentChatContextToMessage(
  message: string,
  context: string,
): string {
  const trimmedContext = context.trim();
  if (!trimmedContext) return message;
  return `${message}\n\n<context>\n${trimmedContext}\n</context>`;
}

export function splitAgentChatContextFromMessage(
  text: string,
): AgentChatMessageParts {
  const contexts: string[] = [];
  let message = text.replace(CONTEXT_BLOCK_PATTERN, (_match, body: string) => {
    contexts.push(body.trim());
    return "";
  });
  // A truncated payload still carries context the reader must not see as the
  // user's own words, so an unclosed tag swallows the rest of the message.
  const unclosed = UNCLOSED_CONTEXT_PATTERN.exec(message);
  if (unclosed) {
    contexts.push(unclosed[1].trim());
    message = message.slice(0, unclosed.index);
  }
  return {
    message: message.replace(STRAY_CONTEXT_CLOSE_PATTERN, "").trim(),
    context: contexts.filter(Boolean).join("\n"),
  };
}
