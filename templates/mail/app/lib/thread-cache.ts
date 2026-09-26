
import { appApiPath } from "@agent-native/core/client/api-path";
import type { EmailMessage } from "@shared/types";
import { useEffect, useState } from "react";

import { beginProviderSnapshot } from "@/lib/provider-snapshot";
import { TAB_ID } from "@/lib/tab-id";

type CacheEntry = {
  messages: EmailMessage[];
  fetchedAt: number;
  providerSnapshotId?: number;
};

type ThreadFetchResult = {
  messages: EmailMessage[];
  providerSnapshotId: number;
};

type WarmTarget = string | { id: string; accountEmail?: string };

const STORAGE_KEY = "mail.threadCache.v1";
const STORAGE_TTL = 60 * 60 * 1000;
const STORAGE_MAX_ENTRIES = 50;
const STORAGE_MAX_BYTES = 3 * 1024 * 1024;
const BACKGROUND_RATE_LIMIT_COOLDOWN_MS = 90 * 1000;
const BACKGROUND_AUTH_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
const WARM_BATCH_LIMIT = 4;

type Globals = {
  __mailThreadCache?: Map<string, CacheEntry>;
  __mailThreadInflight?: Map<string, Promise<ThreadFetchResult>>;
  __mailThreadSubscribers?: Map<string, Set<() => void>>;
  __mailThreadVersions?: Map<string, number>;
};
const g = globalThis as Globals;
const cache = (g.__mailThreadCache ??= new Map());
const inflight: Map<
  string,
  Promise<ThreadFetchResult>
> = (g.__mailThreadInflight ??= new Map());
const subscribers = (g.__mailThreadSubscribers ??= new Map());
const versions = (g.__mailThreadVersions ??= new Map());
let backgroundCooldownUntil = 0;

function getVersion(threadId: string): number {
  return versions.get(threadId) ?? 0;
}

function clearOwnedInflight(
  threadId: string,
  request: Promise<ThreadFetchResult>,
) {
  if (inflight.get(threadId) === request) inflight.delete(threadId);
}

function notify(threadId: string) {
  const set = subscribers.get(threadId);
  if (!set) return;
  for (const fn of set) fn();
}

function normalizeTarget(target: WarmTarget): {
  id: string;
  accountEmail?: string;
} {
  return typeof target === "string" ? { id: target } : target;
}

function isRateLimitMessage(message: string): boolean {
  return /\b(?:429|quota|rate limit)\b/i.test(message);
}

function isAuthFailureStatus(status: number): boolean {
  return status === 401 || status === 403;
}

function retryDelayFromMessage(message: string): number {
  const match = message.match(/retry in\s+(\d+)s/i);
  if (!match) return BACKGROUND_RATE_LIMIT_COOLDOWN_MS;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return BACKGROUND_RATE_LIMIT_COOLDOWN_MS;
  }
  return Math.min(Math.max(seconds * 1000, 15_000), 5 * 60_000);
}

function noteFetchError(
  message: string,
  status?: number,
  retryAfterMs?: number,
) {
  if (status !== undefined && isAuthFailureStatus(status)) {
    backgroundCooldownUntil = Math.max(
      backgroundCooldownUntil,
      Date.now() + BACKGROUND_AUTH_FAILURE_COOLDOWN_MS,
    );
    return;
  }
  if (status === 429 || isRateLimitMessage(message)) {
    const delay =
      typeof retryAfterMs === "number" &&
      Number.isFinite(retryAfterMs) &&
      retryAfterMs > 0
        ? Math.min(Math.max(retryAfterMs, 15_000), 5 * 60_000)
        : retryDelayFromMessage(message);
    backgroundCooldownUntil = Math.max(
      backgroundCooldownUntil,
      Date.now() + delay,
    );
  }
}

function canRunBackgroundFetch() {
  return Date.now() >= backgroundCooldownUntil;
}

async function fetchThread(
  threadId: string,
  accountEmail?: string,
): Promise<ThreadFetchResult> {
  const providerSnapshotId = beginProviderSnapshot();
  const params = new URLSearchParams();
  if (accountEmail) params.set("accountEmail", accountEmail);
  const suffix = params.toString() ? `?${params}` : "";
  const res = await fetch(
    appApiPath(`/api/threads/${threadId}/messages${suffix}`),
    {
      headers: {
        "Content-Type": "application/json",
        "X-Request-Source": TAB_ID,
      },
      cache: "no-store",
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.error || `Request failed (${res.status})`;
    const retryAfter = Number(res.headers.get("Retry-After"));
    const retryAfterMs =
      Number.isFinite(retryAfter) &&
      Number.isInteger(retryAfter) &&
      retryAfter > 0
        ? retryAfter * 1000
        : undefined;
    noteFetchError(message, res.status, retryAfterMs);
    const error = new Error(message);
    (error as Error & { status?: number; retryAfterMs?: number }).status =
      res.status;
    (error as Error & { status?: number; retryAfterMs?: number }).retryAfterMs =
      retryAfterMs;
    throw error;
  }
  return { messages: await res.json(), providerSnapshotId };
}


let flushTimer: ReturnType<typeof setTimeout> | null = null;

function loadFromStorage() {
  if (typeof window === "undefined") return;
  if (cache.size > 0) return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
    const now = Date.now();
    for (const [id, entry] of Object.entries(parsed)) {
      if (!entry || now - entry.fetchedAt > STORAGE_TTL) continue;
      cache.set(id, { ...entry, providerSnapshotId: undefined });
    }
  } catch {
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
  cache.set(threadId, {
    messages,
    fetchedAt: Date.now(),
    providerSnapshotId: cache.get(threadId)?.providerSnapshotId,
  });
  notify(threadId);
  scheduleFlush();
}

export function supersedeCachedThreadFetch(threadId: string) {
  const superseded = inflight.delete(threadId);
  versions.set(threadId, getVersion(threadId) + 1);
  return superseded;
}

export function invalidateCachedThread(threadId: string) {
  cache.delete(threadId);
  inflight.delete(threadId);
  versions.set(threadId, getVersion(threadId) + 1);
  notify(threadId);
  scheduleFlush();
}

const STALE_AFTER = 60 * 1000;

export function ensureThread(
  threadId: string,
  accountEmail?: string,
): Promise<EmailMessage[]> {
  const cached = cache.get(threadId);
  if (cached) {
    if (
      Date.now() - cached.fetchedAt > STALE_AFTER &&
      !inflight.get(threadId) &&
      canRunBackgroundFetch()
    ) {
      void backgroundRefresh(threadId, accountEmail);
    }
    return Promise.resolve(cached.messages);
  }
  const existing = inflight.get(threadId);
  if (existing) return existing.then(({ messages }) => messages);
  const startedVersion = getVersion(threadId);
  const p = fetchThread(threadId, accountEmail)
    .then((result) => {
      if (getVersion(threadId) !== startedVersion) {
        clearOwnedInflight(threadId, p);
        return result;
      }
      cache.set(threadId, {
        messages: result.messages,
        fetchedAt: Date.now(),
        providerSnapshotId: result.providerSnapshotId,
      });
      clearOwnedInflight(threadId, p);
      notify(threadId);
      scheduleFlush();
      return result;
    })
    .catch((err) => {
      clearOwnedInflight(threadId, p);
      throw err;
    });
  inflight.set(threadId, p);
  return p.then(({ messages }) => messages);
}

function backgroundRefresh(
  threadId: string,
  accountEmail?: string,
): Promise<ThreadFetchResult> {
  if (!canRunBackgroundFetch())
    return Promise.resolve({
      messages: cache.get(threadId)?.messages ?? [],
      providerSnapshotId: 0,
    });
  const startedVersion = getVersion(threadId);
  const p = fetchThread(threadId, accountEmail)
    .then((result) => {
      if (getVersion(threadId) !== startedVersion) {
        clearOwnedInflight(threadId, p);
        return result;
      }
      const prev = cache.get(threadId);
      cache.set(threadId, {
        messages: result.messages,
        fetchedAt: Date.now(),
        providerSnapshotId: result.providerSnapshotId,
      });
      clearOwnedInflight(threadId, p);
      scheduleFlush();
      const prevJson = prev ? JSON.stringify(prev.messages) : "";
      const nextJson = JSON.stringify(result.messages);
      if (
        prevJson !== nextJson ||
        prev?.providerSnapshotId !== result.providerSnapshotId
      )
        notify(threadId);
      return result;
    })
    .catch(() => {
      clearOwnedInflight(threadId, p);
      return { messages: [], providerSnapshotId: 0 };
    });
  inflight.set(threadId, p);
  return p;
}

export function refreshCachedThread(threadId: string, accountEmail?: string) {
  return backgroundRefresh(threadId, accountEmail);
}

export function warmThreads(targets: WarmTarget[], concurrency = 2) {
  if (!canRunBackgroundFetch()) return;
  const queue = targets
    .map(normalizeTarget)
    .filter((target) => !cache.has(target.id) && !inflight.has(target.id))
    .slice(0, WARM_BATCH_LIMIT);
  if (queue.length === 0) return;
  let active = 0;
  const pump = () => {
    while (active < concurrency && queue.length > 0) {
      if (!canRunBackgroundFetch()) {
        queue.length = 0;
        return;
      }
      const target = queue.shift()!;
      active++;
      ensureThread(target.id, target.accountEmail)
        .catch(() => {})
        .finally(() => {
          active--;
          pump();
        });
    }
  };
  pump();
}

export function useThreadCache(
  threadId: string | undefined,
  placeholder?: EmailMessage[],
  accountEmail?: string,
): {
  messages: EmailMessage[] | undefined;
  providerSnapshotId: number;
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
    return {
      messages: undefined,
      providerSnapshotId: 0,
      isFromCache: false,
      isLoading: false,
    };
  }
  const hit = cache.get(threadId);
  if (hit) {
    return {
      messages: hit.messages,
      providerSnapshotId: hit.providerSnapshotId ?? 0,
      isFromCache: true,
      isLoading: false,
    };
  }
  if (!inflight.has(threadId)) {
    void ensureThread(threadId, accountEmail).catch(() => {});
  }
  return {
    messages: placeholder,
    providerSnapshotId: 0,
    isFromCache: false,
    isLoading: inflight.has(threadId),
  };
}

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

loadFromStorage();
