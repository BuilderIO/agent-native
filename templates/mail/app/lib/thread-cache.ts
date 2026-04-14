// Plain in-memory cache for thread messages. No React Query abstraction —
// just a Map you can inspect in devtools as `window.__threadCache`.
//
// Why this exists: React Query's prefetch + cache semantics (staleTime,
// gcTime, placeholderData, isFetching, etc) made "did this prefetch actually
// populate the cache?" impossible to answer at a glance. This file gives us
// a direct read/write store so the fast path is obvious.

import { useEffect, useState } from "react";
import type { EmailMessage } from "@shared/types";
import { TAB_ID } from "@/lib/tab-id";

type CacheEntry = {
  messages: EmailMessage[];
  fetchedAt: number;
};

// Module-level state — survives SPA navigation within a tab.
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<EmailMessage[]>>();
const subscribers = new Set<() => void>();

function notify() {
  for (const fn of subscribers) fn();
}

async function fetchThread(threadId: string): Promise<EmailMessage[]> {
  const res = await fetch(`/api/threads/${threadId}/messages`, {
    headers: {
      "Content-Type": "application/json",
      "X-Request-Source": TAB_ID,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export function getCachedThread(threadId: string): EmailMessage[] | undefined {
  return cache.get(threadId)?.messages;
}

export function setCachedThread(threadId: string, messages: EmailMessage[]) {
  cache.set(threadId, { messages, fetchedAt: Date.now() });
  notify();
}

export function invalidateCachedThread(threadId: string) {
  cache.delete(threadId);
  inflight.delete(threadId);
  notify();
}

// Fetch if not already cached or in flight. Safe to call many times for the
// same id — dedupes via the inflight map.
export function ensureThread(threadId: string): Promise<EmailMessage[]> {
  const cached = cache.get(threadId);
  if (cached) return Promise.resolve(cached.messages);
  const existing = inflight.get(threadId);
  if (existing) return existing;
  const p = fetchThread(threadId)
    .then((messages) => {
      cache.set(threadId, { messages, fetchedAt: Date.now() });
      inflight.delete(threadId);
      notify();
      return messages;
    })
    .catch((err) => {
      inflight.delete(threadId);
      throw err;
    });
  inflight.set(threadId, p);
  return p;
}

// Rate-limited bulk warm — serial with minimal parallelism so we don't
// re-trip Gmail's per-minute quota when warming many threads at once.
export function warmThreads(threadIds: string[], concurrency = 2) {
  const queue = threadIds.filter((id) => !cache.has(id) && !inflight.has(id));
  if (queue.length === 0) return;
  let active = 0;
  const pump = () => {
    while (active < concurrency && queue.length > 0) {
      const id = queue.shift()!;
      active++;
      ensureThread(id)
        .catch(() => {}) // swallow — we'll retry on real open
        .finally(() => {
          active--;
          pump();
        });
    }
  };
  pump();
}

// React hook: returns the cached messages (or undefined), and kicks off a
// fetch if missing. Re-renders when the entry for this threadId changes.
export function useThreadCache(
  threadId: string | undefined,
  placeholder?: EmailMessage[],
): {
  messages: EmailMessage[] | undefined;
  isFromCache: boolean;
  isLoading: boolean;
} {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  }, []);

  useEffect(() => {
    if (!threadId) return;
    if (!cache.has(threadId) && !inflight.has(threadId)) {
      void ensureThread(threadId);
    }
  }, [threadId]);

  if (!threadId) {
    return { messages: undefined, isFromCache: false, isLoading: false };
  }
  const hit = cache.get(threadId);
  if (hit)
    return { messages: hit.messages, isFromCache: true, isLoading: false };
  return {
    messages: placeholder,
    isFromCache: false,
    isLoading: inflight.has(threadId),
  };
}

// Devtools: inspect via `window.__threadCache` in the browser console.
if (typeof window !== "undefined") {
  (window as any).__threadCache = {
    cache,
    inflight,
    get: getCachedThread,
    warm: warmThreads,
    invalidate: invalidateCachedThread,
    size: () => cache.size,
    keys: () => [...cache.keys()],
  };
}
