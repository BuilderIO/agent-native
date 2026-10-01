const CONTEXT_BLOCK_PATTERN = /<context\b([^>]*)>([\s\S]*?)<\/context>\n?/gi;
const UNCLOSED_CONTEXT_PATTERN = /<context\b([^>]*)>([\s\S]*)$/i;
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

export function splitAgentKitMessageContext(
  text: string,
): AgentKitMessageParts {
  const contexts: string[] = [];
  let encodedMessage = false;
  let message = text.replace(
    CONTEXT_BLOCK_PATTERN,
    (_match, attributes: string, body: string) => {
      const encoded = ENCODED_CONTEXT_ATTRIBUTE.test(attributes);
      encodedMessage ||= encoded;
      contexts.push(encoded ? restoreContextMarkup(body.trim()) : body.trim());
      return "";
    },
  );
  const unclosed = UNCLOSED_CONTEXT_PATTERN.exec(message);
  if (unclosed) {
    const encoded = ENCODED_CONTEXT_ATTRIBUTE.test(unclosed[1] ?? "");
    encodedMessage ||= encoded;
    const body = unclosed[2] ?? "";
    contexts.push(encoded ? restoreContextMarkup(body.trim()) : body.trim());
    message = message.slice(0, unclosed.index);
  }
  message = message.replace(STRAY_CONTEXT_CLOSE_PATTERN, "").trim();
  return {
    message: encodedMessage ? restoreContextMarkup(message) : message,
    context: contexts.filter(Boolean).join("\n"),
  };
}
