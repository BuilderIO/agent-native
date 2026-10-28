import type { EmailMessage } from "@shared/types.js";

export const threadMessagesCache = new Map<
  string,
  { messages: EmailMessage[]; expiresAt: number }
>();

export const THREAD_CACHE_TTL = 5 * 60 * 1000;

export function threadCacheKey(
  ownerEmail: string,
  threadId: string,
  accountEmail?: string,
) {
  return `${ownerEmail}\u0000${accountEmail?.trim().toLowerCase() ?? ""}\u0000${threadId}`;
}

export function invalidateThreadCache(
  ownerEmail: string,
  threadId: string,
  accountEmail?: string,
) {
  if (accountEmail) {
    threadMessagesCache.delete(
      threadCacheKey(ownerEmail, threadId, accountEmail),
    );
    return;
  }

  const prefix = `${ownerEmail}\u0000`;
  const suffix = `\u0000${threadId}`;
  for (const key of threadMessagesCache.keys()) {
    if (key.startsWith(prefix) && key.endsWith(suffix)) {
      threadMessagesCache.delete(key);
    }
  }
}
