import {
  readAppState,
  writeAppState,
  compareAndSetAppState,
} from "@agent-native/core/application-state";
import { getRequestRunContext } from "@agent-native/core/server/request-context";

import {
  appStateKeyForBrowserTab,
  normalizeBrowserTabId,
} from "../shared/app-state-tabs.js";

export function getCurrentRequestBrowserTabId(): string | null {
  return normalizeBrowserTabId(getRequestRunContext()?.browserTabId);
}

export function appStateKeyForCurrentTab(key: string): string {
  return appStateKeyForBrowserTab(key, getCurrentRequestBrowserTabId());
}

export async function readAppStateForCurrentTab(
  key: string,
  options?: { fallbackToGlobal?: boolean },
): Promise<Record<string, unknown> | null> {
  const tabKey = appStateKeyForCurrentTab(key);
  if (tabKey !== key) {
    const scoped = await readAppState(tabKey);
    if (scoped) return scoped;
    if (options?.fallbackToGlobal !== true) return null;
  }
  return readAppState(key);
}

export async function writeAppStateForCurrentTab(
  key: string,
  value: Record<string, unknown>,
): Promise<void> {
  await writeAppState(appStateKeyForCurrentTab(key), value);
}

export async function compareAndSetAppStateForCurrentTab(
  key: string,
  expectedValue: Record<string, unknown> | null,
  nextValue: Record<string, unknown> | null,
): Promise<boolean> {
  return compareAndSetAppState(
    appStateKeyForCurrentTab(key),
    expectedValue,
    nextValue,
  );
}
