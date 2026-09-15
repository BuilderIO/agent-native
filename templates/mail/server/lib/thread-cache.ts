import type { EmailMessage } from "@shared/types.js";

// In-memory cache for fully-fetched thread messages. Keyed by
// `${ownerEmail}:${threadId}` so different users don't share entries.
// Keeps prefetches and repeat opens from hammering the Gmail API.
export const threadMessagesCache = new Map<
  string,
  { messages: EmailMessage[]; expiresAt: number }
>();

export const THREAD_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function threadCacheKey(ownerEmail: string, threadId: string) {
  return `${ownerEmail}:${threadId}`;
}

export function invalidateThreadCache(ownerEmail: string, threadId: string) {
  threadMessagesCache.delete(threadCacheKey(ownerEmail, threadId));
}
