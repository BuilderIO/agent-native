import { beforeEach } from "vitest";

const epochKey = "agent-native.action-query-cache.epoch";
const values = new Map<string, string>();
const localStorageShim = {
  get length() {
    return values.size;
  },
  key(index: number) {
    return [...values.keys()][index] ?? null;
  },
  getItem(key: string) {
    return values.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    values.set(key, value);
  },
  removeItem(key: string) {
    values.delete(key);
  },
  clear() {
    values.clear();
  },
} satisfies Storage;

beforeEach(() => {
  values.clear();
  values.set(epochKey, TEST_CACHE_EPOCH);
  const global = globalThis as typeof globalThis & { window?: Window };
  if (!global.window) {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: localStorageShim },
    });
    return;
  }
  Object.defineProperty(global.window, "localStorage", {
    configurable: true,
    value: localStorageShim,
  });
});

export const TEST_CACHE_EPOCH = "cache-test-epoch";

const CURRENT_CACHE_BUSTER = "action-query-cache-v1";
const CACHE_EPOCH_KEY = "agent-native.action-query-cache.epoch";

function currentTestEpoch(): string {
  try {
    return window.localStorage.getItem(CACHE_EPOCH_KEY) ?? TEST_CACHE_EPOCH;
  } catch {
    return TEST_CACHE_EPOCH;
  }
}

export function cacheBuster(buster = CURRENT_CACHE_BUSTER): string {
  if (buster === CURRENT_CACHE_BUSTER) {
    return `${CURRENT_CACHE_BUSTER}:${currentTestEpoch()}`;
  }
  return buster;
}
