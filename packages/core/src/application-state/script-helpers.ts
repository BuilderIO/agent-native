
import {
  getAmbientUserEmail,
  getRequestAuthCapability,
  getRequestRunContext,
} from "../server/request-context.js";
import {
  appStateGet,
  appStatePut,
  appStateDelete,
  appStateCompareAndSet,
  appStateCompareAndSetMany,
  appStateList,
  appStateDeleteByPrefix,
  type AppStateCompareAndSetOperation,
} from "./store.js";

async function resolveSessionId(): Promise<string> {
  try {
    const { getRequestUserEmail } =
      await import("../server/request-context.js");
    const ctxEmail = getRequestUserEmail();
    if (ctxEmail) return ctxEmail;
  } catch {
    // request-context not available — fall through to env var
  }

  const capability = getRequestAuthCapability();
  if (capability) return `capability:${capability}`;

  const email = getAmbientUserEmail();
  if (email) return email;

  throw new Error(
    "Application state access requires an authenticated request context or AGENT_USER_EMAIL env var",
  );
}

export async function readAppState(
  key: string,
): Promise<Record<string, unknown> | null> {
  return readUnscopedAppState(requestScopedAppStateKey(key));
}

export async function writeAppState(
  key: string,
  value: Record<string, unknown>,
): Promise<void> {
  const sessionId = await resolveSessionId();
  return appStatePut(sessionId, requestScopedAppStateKey(key), value, {
    requestSource: "agent",
  });
}

export async function deleteAppState(key: string): Promise<boolean> {
  const sessionId = await resolveSessionId();
  return appStateDelete(sessionId, requestScopedAppStateKey(key), {
    requestSource: "agent",
  });
}

export async function compareAndSetAppState(
  key: string,
  expectedValue: Record<string, unknown> | null,
  nextValue: Record<string, unknown> | null,
): Promise<boolean> {
  const sessionId = await resolveSessionId();
  return appStateCompareAndSet(
    sessionId,
    requestScopedAppStateKey(key),
    expectedValue,
    nextValue,
    { requestSource: "agent" },
  );
}

export async function compareAndSetManyAppState(
  operations: readonly AppStateCompareAndSetOperation[],
): Promise<boolean> {
  const sessionId = await resolveSessionId();
  return appStateCompareAndSetMany(
    sessionId,
    operations.map((operation) => ({
      ...operation,
      key: requestScopedAppStateKey(operation.key),
    })),
    { requestSource: "agent" },
  );
}

export async function listAppState(
  prefix: string,
): Promise<Array<{ key: string; value: Record<string, unknown> }>> {
  const sessionId = await resolveSessionId();
  return appStateList(sessionId, prefix);
}

export async function deleteAppStateByPrefix(prefix: string): Promise<number> {
  const sessionId = await resolveSessionId();
  return appStateDeleteByPrefix(sessionId, prefix, {
    requestSource: "agent",
  });
}

const SAFE_TAB_ID_RE = /^[A-Za-z0-9_-]{1,96}$/;
const TAB_SCOPED_AMBIENT_KEYS = new Set([
  "navigation",
  "navigate",
  "__url__",
  "__set_url__",
]);

/**
 * Exported so server code that reads a browser-tab id off a request header
 * (e.g. action-routes.ts) shares this exact validation instead of a copy —
 * only a tab-id-shaped value is ever trusted to scope app state.
 */
export function normalizeBrowserTabId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return SAFE_TAB_ID_RE.test(trimmed) ? trimmed : null;
}

/**
 * Browser tab id for the current request, if the client sent one. Used to
 * scope ambient navigation state so a chat from one tab
 * reads that tab's state instead of whichever tab wrote the global key last.
 */
export function getCurrentRequestBrowserTabId(): string | null {
  try {
    return normalizeBrowserTabId(getRequestRunContext()?.browserTabId);
  } catch {
    return null;
  }
}

export function appStateKeyForBrowserTab(
  key: string,
  browserTabId: unknown,
): string {
  const normalized = normalizeBrowserTabId(browserTabId);
  return normalized ? `${key}:${normalized}` : key;
}

function requestScopedAppStateKey(key: string): string {
  if (!TAB_SCOPED_AMBIENT_KEYS.has(key)) return key;
  return appStateKeyForBrowserTab(key, getCurrentRequestBrowserTabId());
}

async function readUnscopedAppState(
  key: string,
): Promise<Record<string, unknown> | null> {
  const sessionId = await resolveSessionId();
  return appStateGet(sessionId, key);
}

export async function readAppStateForCurrentTab(
  key: string,
  options?: { fallbackToGlobal?: boolean },
): Promise<Record<string, unknown> | null> {
  const browserTabId = getCurrentRequestBrowserTabId();
  const tabKey = appStateKeyForBrowserTab(key, browserTabId);
  if (tabKey !== key) {
    const scoped = await readAppState(tabKey);
    if (scoped) return scoped;
    if (options?.fallbackToGlobal !== true) return null;
  }
  return readUnscopedAppState(key);
}

export async function writeAppStateForCurrentTab(
  key: string,
  value: Record<string, unknown>,
): Promise<void> {
  const tabKey = appStateKeyForBrowserTab(key, getCurrentRequestBrowserTabId());
  return writeAppState(tabKey, value);
}
