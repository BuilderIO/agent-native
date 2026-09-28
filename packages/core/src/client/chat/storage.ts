export const CHAT_STORAGE_PREFIX = "agent-chat:";

/** Remove persisted chat for a given tabId (or "default"). */
export function clearChatStorage(tabId?: string) {
  sessionStorage.removeItem(`${CHAT_STORAGE_PREFIX}${tabId || "default"}`);
}
