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

const STORAGE_KEY = "mail.threadCache.v1";
const STORAGE_TTL = 60 * 60 * 1000; // 1 hour
const STORAGE_MAX_ENTRIES = 50;
const STORAGE_MAX_BYTES = 3 * 1024 * 1024; // ~3MB, well under the 5MB cap

// Park state on globalThis so Vite HMR reloads of this module don't wipe the
// cache — before, every save during dev re-ran `new Map()` and the next
// thread open had to re-fetch from Gmail (~500ms+).
type Globals = {
  __mailThreadCache?: Map<string, CacheEntry>;
  __mailThreadInflight?: Map<string, Promise<EmailMessage[]>>;
  __mailThreadSubscribers?: Map<string, Set<() => void>>;
  __mailThreadVersions?: Map<string, number>;
};
const g = globalThis as Globals;
const cache = (g.__mailThreadCache ??= new Map());
const inflight = (g.__mailThreadInflight ??= new Map());
// Scoped by threadId so warming thread B doesn't re-render the component
// viewing thread A — that cascade was re-running the expensive iframe
// doc.write() effect in EmailThread on every cache write.
const subscribers = (g.__mailThreadSubscribers ??= new Map());
// Version counter per threadId — bumped by invalidateCachedThread so any
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

// ── localStorage persistence ─────────────────────────────────────────────────
// Hydrate on module load; flush asynchronously on cache writes. Survives page
// reloads and server restarts so repeat opens within an hour stay instant.

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
    log(`hydrated ${cache.size} threads from localStorage`);
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

// Auto-enable debug logging when running with DEBUG=true (forwarded by
// dev-all to VITE_DEBUG). Turn on/off manually with
// `window.__threadCache.enableDebug()` at any time.
if (typeof window !== "undefined" && import.meta.env.VITE_DEBUG === "true") {
  (window as any).__cacheDebug = true;
}

// Hydrate after cache/subscribers are defined. In dev, HMR reloads this module
// frequently; loadFromStorage skips if the in-memory Map already has entries.
loadFromStorage();

function log(...args: unknown[]) {
  if (typeof window !== "undefined" && (window as any).__cacheDebug) {
    console.log("[thread-cache]", performance.now().toFixed(0), ...args);
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
  // Bump the version so any still-pending fetch whose promise hasn't
  // resolved yet (started with the old version) discards its result.
  versions.set(threadId, getVersion(threadId) + 1);
  notify(threadId);
  scheduleFlush();
}

// Fetch if not already cached or in flight. Safe to call many times for the
// same id — dedupes via the inflight map.
// If a cached entry is older than this, we still return it instantly (instant
// UX) but kick off a background refresh so updates land without the user
// waiting. Anything newer than this we trust as-is.
const STALE_AFTER = 60 * 1000; // 1 minute

export function ensureThread(threadId: string): Promise<EmailMessage[]> {
  const cached = cache.get(threadId);
  if (cached) {
    log("ensureThread HIT", threadId);
    // Stale-while-revalidate: fire a background refresh if the entry is old
    // but avoid refetching if one's already in flight for this id.
    if (
      Date.now() - cached.fetchedAt > STALE_AFTER &&
      !inflight.get(threadId)
    ) {
      void backgroundRefresh(threadId);
    }
    return Promise.resolve(cached.messages);
  }
  const existing = inflight.get(threadId);
  if (existing) {
    log("ensureThread INFLIGHT", threadId);
    return existing;
  }
  log("ensureThread FETCH", threadId);
  const t0 = performance.now();
  const startedVersion = getVersion(threadId);
  const p = fetchThread(threadId)
    .then((messages) => {
      // If invalidateCachedThread ran while we were in flight, the version
      // bumped — discard the stale response rather than repopulating.
      if (getVersion(threadId) !== startedVersion) {
        inflight.delete(threadId);
        log("ensureThread DISCARDED (invalidated)", threadId);
        return messages;
      }
      cache.set(threadId, { messages, fetchedAt: Date.now() });
      inflight.delete(threadId);
      notify(threadId);
      scheduleFlush();
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

// Silently refresh a cached thread in the background. Only notifies
// subscribers if the content actually changed (avoids re-render churn).
function backgroundRefresh(threadId: string) {
  log("backgroundRefresh START", threadId);
  const startedVersion = getVersion(threadId);
  const p = fetchThread(threadId)
    .then((messages) => {
      if (getVersion(threadId) !== startedVersion) {
        inflight.delete(threadId);
        log("backgroundRefresh DISCARDED (invalidated)", threadId);
        return messages;
      }
      const prev = cache.get(threadId);
      cache.set(threadId, { messages, fetchedAt: Date.now() });
      inflight.delete(threadId);
      scheduleFlush();
      // Only notify if the payload actually changed — otherwise we'd re-render
      // the detail view for no observable reason.
      const prevJson = prev ? JSON.stringify(prev.messages) : "";
      const nextJson = JSON.stringify(messages);
      if (prevJson !== nextJson) {
        log("backgroundRefresh UPDATED", threadId);
        notify(threadId);
      } else {
        log("backgroundRefresh no-change", threadId);
      }
      return messages;
    })
    .catch(() => {
      inflight.delete(threadId);
      return [];
    });
  inflight.set(threadId, p);
  return p;
}

// Rate-limited bulk warm — Gmail's per-user-per-second quota is 250 units
// and threads.get is 10 units, so 6-in-flight is well under the limit.
export function warmThreads(threadIds: string[], concurrency = 6) {
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

  if (!threadId) {
    return { messages: undefined, isFromCache: false, isLoading: false };
  }
  const hit = cache.get(threadId);
  if (hit) {
    log("useThreadCache RENDER HIT", threadId);
    return { messages: hit.messages, isFromCache: true, isLoading: false };
  }
  // Kick off the fetch synchronously during render for cold opens so the
  // hook returns isLoading=true on the first paint. Doing this in useEffect
  // left isLoading=false for one render, which made callers show the
  // "Email not found" empty state before the fetch even started.
  // ensureThread dedupes, so this is safe to call on every render — it'll
  // only start one network request per thread.
  if (!inflight.has(threadId)) {
    void ensureThread(threadId);
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
    flush: () => flushToStorage(),
    clearStorage: () => {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
        console.log("[thread-cache] localStorage cleared");
      } catch {}
    },
  };
}
