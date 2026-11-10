import {
  getAmbientUserEmail,
  getRequestAuthCapability,
  getRequestRunContext,
  type BrowserTabTargetSlot,
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
  const scoped = await requestScopedAppStateKey(key);
  // No tab to read from: a call that asked for one gets nothing rather than
  // the account-wide row, which no tab keeps current.
  if (scoped.unavailable) return null;
  return readUnscopedAppState(scoped.key);
}

export async function writeAppState(
  key: string,
  value: Record<string, unknown>,
): Promise<void> {
  const sessionId = await resolveSessionId();
  const { key: scopedKey } = await requestScopedAppStateKey(key);
  return appStatePut(sessionId, scopedKey, value, {
    requestSource: "agent",
  });
}

export async function deleteAppState(key: string): Promise<boolean> {
  const sessionId = await resolveSessionId();
  const { key: scopedKey } = await requestScopedAppStateKey(key);
  return appStateDelete(sessionId, scopedKey, {
    requestSource: "agent",
  });
}

export async function compareAndSetAppState(
  key: string,
  expectedValue: Record<string, unknown> | null,
  nextValue: Record<string, unknown> | null,
): Promise<boolean> {
  const sessionId = await resolveSessionId();
  const { key: scopedKey } = await requestScopedAppStateKey(key);
  return appStateCompareAndSet(sessionId, scopedKey, expectedValue, nextValue, {
    requestSource: "agent",
  });
}

export async function compareAndSetManyAppState(
  operations: readonly AppStateCompareAndSetOperation[],
): Promise<boolean> {
  const sessionId = await resolveSessionId();
  const scopedOperations = await Promise.all(
    operations.map(async (operation) => ({
      ...operation,
      key: (await requestScopedAppStateKey(operation.key)).key,
    })),
  );
  return appStateCompareAndSetMany(sessionId, scopedOperations, {
    requestSource: "agent",
  });
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
  "settings-view",
  "pending-selection-context",
]);

export function normalizeBrowserTabId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return SAFE_TAB_ID_RE.test(trimmed) ? trimmed : null;
}

/** The browser tab the current request came from, if any. */
export function getCurrentRequestBrowserTabId(): string | null {
  try {
    return normalizeBrowserTabId(getRequestRunContext()?.browserTabId);
  } catch {
    return null;
  }
}

/**
 * The tab whose tab-scoped app state the current request reads and writes:
 * the tab it came from or, for an MCP call from no tab, the tab of this app
 * the user used last. `unavailable` when the call looked for a tab and none
 * was used recently. Requests that have neither (scripts, jobs, the CLI) get
 * no tab and keep the account-wide rows.
 */
export async function resolveCurrentRequestStateTab(): Promise<{
  tabId: string | null;
  unavailable: boolean;
}> {
  const browserTabId = getCurrentRequestBrowserTabId();
  if (browserTabId) return { tabId: browserTabId, unavailable: false };
  let slot: BrowserTabTargetSlot | undefined;
  try {
    slot = getRequestRunContext()?.browserTabTarget;
  } catch {
    slot = undefined;
  }
  if (!slot) return { tabId: null, unavailable: false };
  const target = await slot.resolve();
  if (target.kind === "last-used") {
    const tabId = normalizeBrowserTabId(target.tabId);
    if (tabId) return { tabId, unavailable: false };
  }
  return { tabId: null, unavailable: true };
}

export function appStateKeyForBrowserTab(
  key: string,
  browserTabId: unknown,
): string {
  const normalized = normalizeBrowserTabId(browserTabId);
  return normalized ? `${key}:${normalized}` : key;
}

async function requestScopedAppStateKey(
  key: string,
): Promise<{ key: string; unavailable: boolean }> {
  if (!TAB_SCOPED_AMBIENT_KEYS.has(key)) return { key, unavailable: false };
  const tab = await resolveCurrentRequestStateTab();
  return {
    key: appStateKeyForBrowserTab(key, tab.tabId),
    unavailable: tab.unavailable,
  };
}

async function readUnscopedAppState(
  key: string,
): Promise<Record<string, unknown> | null> {
  const sessionId = await resolveSessionId();
  return appStateGet(sessionId, key);
}

/**
 * Reads `key` for the current request's tab (see
 * resolveCurrentRequestStateTab), falling back to the account-wide row only
 * when `fallbackToGlobal` is true. A request with no tab at all reads the
 * account-wide row. An MCP call that found no recently used tab reads it
 * only when it opted in, and never for the ambient keys: no tab keeps those
 * rows current.
 */
export async function readAppStateForCurrentTab(
  key: string,
  options?: { fallbackToGlobal?: boolean },
): Promise<Record<string, unknown> | null> {
  const tab = await resolveCurrentRequestStateTab();
  const tabKey = appStateKeyForBrowserTab(key, tab.tabId);
  const fallbackToGlobal = options?.fallbackToGlobal === true;
  if (tabKey !== key) {
    const scoped = await readAppState(tabKey);
    if (scoped) return scoped;
    if (!fallbackToGlobal) return null;
  }
  if (
    tab.unavailable &&
    (!fallbackToGlobal || TAB_SCOPED_AMBIENT_KEYS.has(key))
  )
    return null;
  return readUnscopedAppState(key);
}

/**
 * Writes `key` for the current request's tab (see
 * resolveCurrentRequestStateTab). With no tab, it writes the account-wide
 * row, as it always has: an MCP caller learns from the call's result that no
 * tab was found.
 */
export async function writeAppStateForCurrentTab(
  key: string,
  value: Record<string, unknown>,
): Promise<void> {
  const tab = await resolveCurrentRequestStateTab();
  const tabKey = appStateKeyForBrowserTab(key, tab.tabId);
  if (tabKey !== key) return writeAppState(tabKey, value);
  const sessionId = await resolveSessionId();
  return appStatePut(sessionId, key, value, { requestSource: "agent" });
}
