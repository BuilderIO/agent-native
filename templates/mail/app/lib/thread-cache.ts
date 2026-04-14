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
// Scoped by threadId so warming thread B doesn't re-render the component
// viewing thread A — that cascade was re-running the expensive iframe
// doc.write() effect in EmailThread on every cache write.
const subscribers = new Map<string, Set<() => void>>();

function notify(threadId: string) {
  const set = subscribers.get(threadId);
  if (!set) return;
  for (const fn of set) fn();
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

function log(...args: unknown[]) {
  if (typeof window !== "undefined") {
    console.log("[thread-cache]", performance.now().toFixed(0), ...args);
  }
}

if (typeof window !== "undefined") {
  console.log("[thread-cache] MODULE LOADED");
}

export function getCachedThread(threadId: string): EmailMessage[] | undefined {
  return cache.get(threadId)?.messages;
}

export function setCachedThread(threadId: string, messages: EmailMessage[]) {
  cache.set(threadId, { messages, fetchedAt: Date.now() });
  notify(threadId);
}

export function invalidateCachedThread(threadId: string) {
  cache.delete(threadId);
  inflight.delete(threadId);
  notify(threadId);
}

// Fetch if not already cached or in flight. Safe to call many times for the
// same id — dedupes via the inflight map.
export function ensureThread(threadId: string): Promise<EmailMessage[]> {
  const cached = cache.get(threadId);
  if (cached) {
    log("ensureThread HIT", threadId);
    return Promise.resolve(cached.messages);
  }
  const existing = inflight.get(threadId);
  if (existing) {
    log("ensureThread INFLIGHT", threadId);
    return existing;
  }
  log("ensureThread FETCH", threadId);
  const t0 = performance.now();
  const p = fetchThread(threadId)
    .then((messages) => {
      cache.set(threadId, { messages, fetchedAt: Date.now() });
      inflight.delete(threadId);
      notify(threadId);
      log(
        `ensureThread DONE ${threadId} (${(performance.now() - t0).toFixed(0)}ms)`,
      );
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
    if (!threadId) return;
    const fn = () => force((n) => n + 1);
    let set = subscribers.get(threadId);
    if (!set) {
      set = new Set();
      subscribers.set(threadId, set);
    }
    set.add(fn);
    return () => {
      set!.delete(fn);
      if (set!.size === 0) subscribers.delete(threadId);
    };
  }, [threadId]);

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
  if (hit) {
    log("useThreadCache RENDER HIT", threadId);
    return { messages: hit.messages, isFromCache: true, isLoading: false };
  }
  log("useThreadCache RENDER MISS", threadId, "placeholder?", !!placeholder);
  return {
    messages: placeholder,
    isFromCache: false,
    isLoading: inflight.has(threadId),
  };
}

// Devtools: inspect via `window.__threadCache` in the browser console.
// Enable verbose logging with `window.__cacheDebug = true` then reload.
if (typeof window !== "undefined") {
  (window as any).__threadCache = {
    cache,
    inflight,
    get: getCachedThread,
    warm: warmThreads,
    invalidate: invalidateCachedThread,
    size: () => cache.size,
    keys: () => [...cache.keys()],
    enableDebug: () => {
      (window as any).__cacheDebug = true;
      console.log(
        "[thread-cache] debug on — reload is NOT required, new events will log",
      );
    },
  };
}
