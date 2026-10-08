const CONTEXT_BLOCK_PATTERN =
  /(?:\n\n)?<context\b([^>]*)>([\s\S]*?)<\/context>\n?/gi;
const UNCLOSED_CONTEXT_PATTERN = /(?:\n\n)?<context\b([^>]*)>([\s\S]*)$/i;
const STRAY_CONTEXT_CLOSE_PATTERN = /<\/context>/gi;
const ENCODED_CONTEXT_ATTRIBUTE =
  /\bdata-agentkit-context-encoding=(['"])entities-v1\1/i;

function escapeContextMarkup(text: string): string {
  return text.replaceAll("&", "&amp;").replace(/<(?=\/?context\b)/gi, "&lt;");
}

function restoreContextMarkup(text: string): string {
  return text.replace(/&lt;(?=\/?context\b)/gi, "<").replaceAll("&amp;", "&");
}

export interface AgentKitMessageParts {
  message: string;
  context: string;
}

export function appendAgentChatContextToMessage(
  message: string,
  context: string,
): string {
  const trimmedContext = context.trim();
  if (!trimmedContext) return message;
  return `${escapeContextMarkup(message)}\n\n<context data-agentkit-context-encoding="entities-v1">\n${escapeContextMarkup(trimmedContext)}\n</context>`;
}

export function splitAgentKitMessageContext(
  text: string,
): AgentKitMessageParts {
  const contexts: string[] = [];
  let encodedMessage = false;
  let hasContext = false;
  let message = text.replace(
    CONTEXT_BLOCK_PATTERN,
    (_match, attributes: string, body: string) => {
      hasContext = true;
      const encoded = ENCODED_CONTEXT_ATTRIBUTE.test(attributes);
      encodedMessage ||= encoded;
      contexts.push(encoded ? restoreContextMarkup(body.trim()) : body.trim());
      return "";
    },
  );
  const unclosed = UNCLOSED_CONTEXT_PATTERN.exec(message);
  if (unclosed) {
    hasContext = true;
    const encoded = ENCODED_CONTEXT_ATTRIBUTE.test(unclosed[1] ?? "");
    encodedMessage ||= encoded;
    const body = unclosed[2] ?? "";
    contexts.push(encoded ? restoreContextMarkup(body.trim()) : body.trim());
    message = message.slice(0, unclosed.index);
  }
  if (!hasContext) return { message: text, context: "" };
  message = message.replace(STRAY_CONTEXT_CLOSE_PATTERN, "");
  return {
    message: encodedMessage ? restoreContextMarkup(message) : message.trim(),
    context: contexts.filter(Boolean).join("\n"),
  };
}
