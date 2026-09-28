import type { EmailMessage } from "@shared/types.js";

export const threadMessagesCache = new Map<
  string,
  { messages: EmailMessage[]; expiresAt: number }
>();

export const THREAD_CACHE_TTL = 5 * 60 * 1000;

export function threadCacheKey(ownerEmail: string, threadId: string) {
  return `${ownerEmail}:${threadId}`;
}

export function invalidateThreadCache(ownerEmail: string, threadId: string) {
  threadMessagesCache.delete(threadCacheKey(ownerEmail, threadId));
}
