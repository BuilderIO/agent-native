
import { countMessageTokens } from "../context-xray/tokenize.js";
import type { EngineMessage } from "../engine/types.js";

export function messageToText(message: EngineMessage): string {
  const parts: string[] = [];
  for (const part of message.content) {
    if (part.type === "text" || part.type === "thinking") {
      if (part.text.trim()) parts.push(part.text);
    } else if (part.type === "tool-call") {
      parts.push(`[tool:${part.name}] ${safeJson(part.input)}`.trim());
    } else if (part.type === "tool-result") {
      parts.push(`[tool-result] ${part.content}`.trim());
    }
    // image/file parts are intentionally omitted from the text window.
  }
  const body = parts.join("\n");
  return body ? `${message.role}: ${body}` : "";
}

export function windowToText(messages: EngineMessage[]): string {
  return messages
    .map(messageToText)
    .filter((line) => line.length > 0)
    .join("\n\n");
}

export async function countWindowTokens(
  messages: EngineMessage[],
): Promise<number> {
  const { tokens } = await countMessageTokens(messages);
  return tokens;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}
