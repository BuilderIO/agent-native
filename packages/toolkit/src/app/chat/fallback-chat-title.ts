import { stripAgentChatContextFromMessage } from "@agent-native/core/shared";

export function fallbackChatTitle(message: string): string {
  return stripAgentChatContextFromMessage(message)
    .replace(/@\[([^\]|]+)\|[^\]]*\]/g, "@$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}
