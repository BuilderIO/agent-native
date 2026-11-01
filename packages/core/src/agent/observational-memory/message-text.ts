import { countMessageTokens } from "../context-xray/tokenize.js";
import { AGENT_INTERNAL_CONTINUE_PROMPT } from "../continuation-prompt.js";
import type { EngineMessage } from "../engine/types.js";

export function messageToText(message: EngineMessage): string {
  const parts: string[] = [];
  for (const part of message.content) {
    if (
      "omitFromPersistedHistory" in part &&
      part.omitFromPersistedHistory === true
    )
      continue;
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
  const lines: string[] = [];
  let privateTurn = false;
  for (const message of messages) {
    const startsUserTurn =
      message.role === "user" &&
      message.content.some(
        (part) =>
          part.type === "text" &&
          !part.omitFromPersistedHistory &&
          !part.text.startsWith(AGENT_INTERNAL_CONTINUE_PROMPT),
      );
    if (startsUserTurn) privateTurn = false;
    if (
      message.content.some(
        (part) =>
          "omitFromPersistedHistory" in part &&
          part.omitFromPersistedHistory === true,
      )
    )
      privateTurn = true;
    if (privateTurn) continue;
    const text = messageToText(message);
    if (text) lines.push(text);
  }
  return lines.join("\n\n");
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
