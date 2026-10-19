import {
  getAmbientUserEmail,
  getRequestAuthCapability,
  getRequestRunContext,
} from "../server/request-context.js";
import {
  appStateGet,
  appStateGetMany,
  appStatePut,
  appStateDelete,
  appStateCompareAndSet,
  appStateCompareAndSetMany,
  appStateList,
  appStateDeleteByPrefix,
  type AppStateCompareAndSetOperation,
} from "./store.js";
import {
  buildTurnScreenSnapshot,
  FRAMEWORK_SCREEN_STATE_KEYS,
  noteScreenStatePrefixDelete,
  noteScreenStateWrite,
  readPinnedScreenState,
  TURN_SCREEN_RELEASED_KEY,
  type TurnScreenSnapshot,
} from "./turn-screen.js";

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
  const scopedKey = requestScopedAppStateKey(key);
  await appStatePut(sessionId, scopedKey, value, {
    requestSource: "agent",
  });
  await recordScreenStateWrite(sessionId, scopedKey);
}

export async function deleteAppState(key: string): Promise<boolean> {
  const sessionId = await resolveSessionId();
  const scopedKey = requestScopedAppStateKey(key);
  const deleted = await appStateDelete(sessionId, scopedKey, {
    requestSource: "agent",
  });
  if (deleted) await recordScreenStateWrite(sessionId, scopedKey);
  return deleted;
}

export async function compareAndSetAppState(
  key: string,
  expectedValue: Record<string, unknown> | null,
  nextValue: Record<string, unknown> | null,
): Promise<boolean> {
  const sessionId = await resolveSessionId();
  const scopedKey = requestScopedAppStateKey(key);
  const swapped = await appStateCompareAndSet(
    sessionId,
    scopedKey,
    expectedValue,
    nextValue,
    { requestSource: "agent" },
  );
  if (swapped) await recordScreenStateWrite(sessionId, scopedKey);
  return swapped;
}

export async function compareAndSetManyAppState(
  operations: readonly AppStateCompareAndSetOperation[],
): Promise<boolean> {
  const sessionId = await resolveSessionId();
  const scoped = operations.map((operation) => ({
    ...operation,
    key: requestScopedAppStateKey(operation.key),
  }));
  const swapped = await appStateCompareAndSetMany(sessionId, scoped, {
    requestSource: "agent",
  });
  if (swapped) {
    for (const operation of scoped) {
      await recordScreenStateWrite(sessionId, operation.key);
    }
  }
  return swapped;
}

export async function listAppState(
  prefix: string,
): Promise<Array<{ key: string; value: Record<string, unknown> }>> {
  const sessionId = await resolveSessionId();
  return appStateList(sessionId, prefix);
}

export async function deleteAppStateByPrefix(prefix: string): Promise<number> {
  const sessionId = await resolveSessionId();
  const deleted = await appStateDeleteByPrefix(sessionId, prefix, {
    requestSource: "agent",
  });
  if (deleted > 0) {
    await recordScreenStateRelease(
      sessionId,
      noteScreenStatePrefixDelete(prefix),
    );
  }
  return deleted;
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
  const pinned = readPinnedScreenState(key);
  if (pinned) return pinned.value;
  const sessionId = await resolveSessionId();
  return appStateGet(sessionId, key);
}

function turnScreenReleasedKey(browserTabId: string): string {
  return appStateKeyForBrowserTab(TURN_SCREEN_RELEASED_KEY, browserTabId);
}

async function recordScreenStateWrite(
  sessionId: string,
  key: string,
): Promise<void> {
  await recordScreenStateRelease(sessionId, noteScreenStateWrite(key));
}

async function recordScreenStateRelease(
  sessionId: string,
  released: TurnScreenSnapshot | undefined,
): Promise<void> {
  if (!released) return;
  await appStatePut(
    sessionId,
    turnScreenReleasedKey(released.browserTabId),
    { capturedAt: released.capturedAt },
    { requestSource: "agent" },
  );
}

/** Whether an earlier segment of this turn already moved the screen itself. */
export async function wasTurnScreenReleased(
  snapshot: TurnScreenSnapshot,
): Promise<boolean> {
  const sessionId = await resolveSessionId();
  const record = await appStateGet(
    sessionId,
    turnScreenReleasedKey(snapshot.browserTabId),
  );
  return record?.capturedAt === snapshot.capturedAt;
}

/** The tab's framework screen state, for turns whose message did not carry one. */
export async function captureTurnScreenSnapshot(
  browserTabId: string,
): Promise<TurnScreenSnapshot> {
  const sessionId = await resolveSessionId();
  const stored = await appStateGetMany(
    sessionId,
    FRAMEWORK_SCREEN_STATE_KEYS.map((key) =>
      appStateKeyForBrowserTab(key, browserTabId),
    ),
  );
  return buildTurnScreenSnapshot(
    browserTabId,
    Object.fromEntries(
      FRAMEWORK_SCREEN_STATE_KEYS.map((key) => [
        key,
        stored[appStateKeyForBrowserTab(key, browserTabId)] ?? null,
      ]),
    ),
  );
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
