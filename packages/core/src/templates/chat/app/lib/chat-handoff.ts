import { consumeAgentChatHomeHandoff } from "@agent-native/core/client/agent-chat";

/** Keep a non-empty thread eligible while the user stays on its chat route. */
export const CHAT_HANDOFF_REFRESH_INTERVAL_MS = 60 * 1000;

/** Clear the Core marker even when it has already passed its normal TTL. */
export function clearChatHandoff(): void {
  consumeAgentChatHomeHandoff("chat", { ttlMs: Number.MAX_SAFE_INTEGER });
}
