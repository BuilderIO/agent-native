// Plain in-memory cache for thread messages. Inspect in devtools as
// `window.__threadCache`. Exists because React Query's cache layering
// (staleTime, gcTime, placeholderData, isFetching) made it hard to answer
// "did this prefetch actually populate the cache?" at a glance; this gives
// us a direct read/write store with transparent state.

import { useEffect, useState } from "react";
import type { EmailMessage } from "@shared/types";
import { TAB_ID } from "@/lib/tab-id";

type CacheEntry = {
  messages: EmailMessage[];
  fetchedAt: number;
};

const STORAGE_KEY = "mail.threadCache.v1";
const STORAGE_TTL = 60 * 60 * 1000; // 1 hour
const STORAGE_MAX_ENTRIES = 50;
const STORAGE_MAX_BYTES = 3 * 1024 * 1024; // ~3MB, well under the 5MB cap

// Park state on globalThis so Vite HMR module reloads don't wipe the cache.
type Globals = {
  __mailThreadCache?: Map<string, CacheEntry>;
  __mailThreadInflight?: Map<string, Promise<EmailMessage[]>>;
  __mailThreadSubscribers?: Map<string, Set<() => void>>;
  __mailThreadVersions?: Map<string, number>;
};
const g = globalThis as Globals;
const cache = (g.__mailThreadCache ??= new Map());
const inflight = (g.__mailThreadInflight ??= new Map());
// Scoped by threadId so writing one thread's cache doesn't re-render
// components viewing a different thread.
const subscribers = (g.__mailThreadSubscribers ??= new Map());
// Version counter per threadId — bumped by invalidateCachedThread so an
// in-flight fetch started before the invalidate discards its result
// instead of repopulating stale data.
const versions = (g.__mailThreadVersions ??= new Map());

function getVersion(threadId: string): number {
  return versions.get(threadId) ?? 0;
}

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

// ── localStorage persistence ─────────────────────────────────────────────────
// Hydrate on module load; flush (debounced) on writes. Survives page reloads
// and server restarts so repeat opens within an hour stay instant.

let flushTimer: ReturnType<typeof setTimeout> | null = null;

function loadFromStorage() {
  if (typeof window === "undefined") return;
  // If globalThis already has entries (HMR reload with warm in-memory cache),
  // skip — don't overwrite fresher in-memory state with disk.
  if (cache.size > 0) return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
    const now = Date.now();
    for (const [id, entry] of Object.entries(parsed)) {
      if (!entry || now - entry.fetchedAt > STORAGE_TTL) continue;
      cache.set(id, entry);
    }
  } catch {
    // Corrupted entry — nuke it
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }
}

function scheduleFlush() {
  if (typeof window === "undefined") return;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushToStorage();
  }, 250);
}

function flushToStorage() {
  if (typeof window === "undefined") return;
  try {
    // Keep the N most recently fetched entries, then trim by total size.
    const entries = [...cache.entries()].sort(
      (a, b) => b[1].fetchedAt - a[1].fetchedAt,
    );
    const out: Record<string, CacheEntry> = {};
    let bytes = 0;
    let count = 0;
    for (const [id, entry] of entries) {
      if (count >= STORAGE_MAX_ENTRIES) break;
      const serialized = JSON.stringify(entry);
      if (bytes + serialized.length > STORAGE_MAX_BYTES) break;
      out[id] = entry;
      bytes += serialized.length;
      count++;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  } catch {
    // Quota exceeded or private mode — silently give up, in-memory cache still works
  }
}

export function getCachedThread(threadId: string): EmailMessage[] | undefined {
  return cache.get(threadId)?.messages;
}

export function setCachedThread(threadId: string, messages: EmailMessage[]) {
  cache.set(threadId, { messages, fetchedAt: Date.now() });
  notify(threadId);
  scheduleFlush();
}

export function invalidateCachedThread(threadId: string) {
  cache.delete(threadId);
  inflight.delete(threadId);
  versions.set(threadId, getVersion(threadId) + 1);
  notify(threadId);
  scheduleFlush();
}

// If a cached entry is older than this, we still return it instantly but
// kick off a background refresh so updates land without the user waiting.
const STALE_AFTER = 60 * 1000; // 1 minute

// Fetch if not already cached or in flight. Safe to call many times for the
// same id — dedupes via the inflight map.
export function ensureThread(threadId: string): Promise<EmailMessage[]> {
  const cached = cache.get(threadId);
  if (cached) {
    // Stale-while-revalidate: return cached instantly, refresh in background.
    if (
      Date.now() - cached.fetchedAt > STALE_AFTER &&
      !inflight.get(threadId)
    ) {
      void backgroundRefresh(threadId);
    }
    return Promise.resolve(cached.messages);
  }
  const existing = inflight.get(threadId);
  if (existing) return existing;
  const startedVersion = getVersion(threadId);
  const p = fetchThread(threadId)
    .then((messages) => {
      // If invalidateCachedThread ran while we were in flight, the version
      // bumped — discard the stale response rather than repopulating.
      if (getVersion(threadId) !== startedVersion) {
        inflight.delete(threadId);
        return messages;
      }
      cache.set(threadId, { messages, fetchedAt: Date.now() });
      inflight.delete(threadId);
      notify(threadId);
      scheduleFlush();
      return messages;
    })
    .catch((err) => {
      inflight.delete(threadId);
      throw err;
    });
  inflight.set(threadId, p);
  return p;
}

// Silently refresh a cached thread. Only notifies subscribers if the content
// actually changed, avoiding re-render churn when nothing's new.
function backgroundRefresh(threadId: string) {
  const startedVersion = getVersion(threadId);
  const p = fetchThread(threadId)
    .then((messages) => {
      if (getVersion(threadId) !== startedVersion) {
        inflight.delete(threadId);
        return messages;
      }
      const prev = cache.get(threadId);
      cache.set(threadId, { messages, fetchedAt: Date.now() });
      inflight.delete(threadId);
      scheduleFlush();
      const prevJson = prev ? JSON.stringify(prev.messages) : "";
      const nextJson = JSON.stringify(messages);
      if (prevJson !== nextJson) notify(threadId);
      return messages;
    })
    .catch(() => {
      inflight.delete(threadId);
      return [];
    });
  inflight.set(threadId, p);
  return p;
}

// Bulk warm — threads.get is 10 units and the server-side token bucket
// paces us under Gmail's 250/user/sec cap automatically, so we can run
// with higher concurrency without tripping quota. 10 in flight = 100
// units/sec worst case, comfortably within budget.
export function warmThreads(threadIds: string[], concurrency = 10) {
  const queue = threadIds.filter((id) => !cache.has(id) && !inflight.has(id));
  if (queue.length === 0) return;
  let active = 0;
  const pump = () => {
    while (active < concurrency && queue.length > 0) {
      const id = queue.shift()!;
      active++;
      ensureThread(id)
        .catch(() => {})
        .finally(() => {
          active--;
          pump();
        });
    }
  };
  pump();
}

// React hook: returns cached messages (or undefined), kicks off a fetch if
// missing, re-renders when this threadId's entry changes.
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

  if (!threadId) {
    return { messages: undefined, isFromCache: false, isLoading: false };
  }
  const hit = cache.get(threadId);
  if (hit) {
    return { messages: hit.messages, isFromCache: true, isLoading: false };
  }
  // Kick off the fetch synchronously during render for cold opens so the
  // hook returns isLoading=true on the first paint. ensureThread dedupes.
  if (!inflight.has(threadId)) {
    void ensureThread(threadId).catch(() => {});
  }
  return {
    messages: placeholder,
    isFromCache: false,
    isLoading: inflight.has(threadId),
  };
}

// Devtools: inspect via `window.__threadCache` in the console.
if (typeof window !== "undefined") {
  (window as any).__threadCache = {
    cache,
    inflight,
    get: getCachedThread,
    warm: warmThreads,
    invalidate: invalidateCachedThread,
    size: () => cache.size,
    keys: () => [...cache.keys()],
    flush: () => flushToStorage(),
    clearStorage: () => {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
        console.log("[thread-cache] localStorage cleared");
      } catch {}
    },
  };

  (window as any).__showSkeleton = () => {
    const origFetch = (window as any).__origFetch || window.fetch;
    (window as any).__origFetch = origFetch;
    window.fetch = function (url: any, opts: any) {
      if (
        typeof url === "string" &&
        url.includes("/api/threads/") &&
        url.includes("/messages")
      ) {
        return new Promise(() => {});
      }
      return origFetch.call(window, url, opts);
    } as typeof fetch;
    cache.clear();
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
    console.log(
      "[skeleton] Thread API blocked, cache cleared. Click an email to see the skeleton.",
    );
    console.log("[skeleton] Run __hideSkeleton() to restore normal behavior.");
  };
  (window as any).__hideSkeleton = () => {
    if ((window as any).__origFetch) {
      window.fetch = (window as any).__origFetch;
      delete (window as any).__origFetch;
    }
    inflight.clear();
    console.log(
      "[skeleton] Normal fetch restored. Reload the page to refetch threads.",
    );
  };
}

// Hydrate after everything above is defined.
loadFromStorage();
