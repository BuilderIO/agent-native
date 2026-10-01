const CONTEXT_BLOCK_PATTERN = /<context\b[^>]*>([\s\S]*?)<\/context>\n?/gi;
const UNCLOSED_CONTEXT_PATTERN = /<context\b[^>]*>([\s\S]*)$/i;
const STRAY_CONTEXT_CLOSE_PATTERN = /<\/context>/gi;

export interface AgentKitMessageParts {
  message: string;
  context: string;
}

export function splitAgentKitMessageContext(
  text: string,
): AgentKitMessageParts {
  const contexts: string[] = [];
  let message = text.replace(CONTEXT_BLOCK_PATTERN, (_match, body: string) => {
    contexts.push(body.trim());
    return "";
  });
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
