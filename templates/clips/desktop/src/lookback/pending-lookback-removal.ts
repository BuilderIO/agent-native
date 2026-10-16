import { originForServer } from "../lib/desktop-auth-token";

const STORAGE_KEY_PREFIX = "clips:lookback-pending-removals:v1";

export interface LookbackRemovalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type PendingLookbackRemovalState =
  | { status: "ready"; pendingIds: Set<string>; failed: boolean }
  | { status: "unreadable"; pendingIds: Set<string>; failed: true };

export function pendingLookbackRemovalStorageKey(
  serverUrl: string,
  account: string | null | undefined,
): string | null {
  const normalizedAccount = account?.trim().toLowerCase();
  if (!normalizedAccount) return null;
  return `${STORAGE_KEY_PREFIX}:${encodeURIComponent(originForServer(serverUrl))}:${encodeURIComponent(normalizedAccount)}`;
}

export function sameLookbackRemovalScope(
  left: { serverUrl: string; account: string | null | undefined },
  right: { serverUrl: string; account: string | null | undefined },
): boolean {
  const leftKey = pendingLookbackRemovalStorageKey(
    left.serverUrl,
    left.account,
  );
  return (
    leftKey !== null &&
    leftKey === pendingLookbackRemovalStorageKey(right.serverUrl, right.account)
  );
}

function readIds(
  storage: LookbackRemovalStorage,
  key: string,
): { ok: true; ids: string[] } | { ok: false } {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { ok: false };
  }
  if (raw === null) return { ok: true, ids: [] };

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      parsed.some((id) => typeof id !== "string" || !id.trim())
    ) {
      return { ok: false };
    }
    return { ok: true, ids: [...new Set(parsed)] };
  } catch {
    return { ok: false };
  }
}

function writeIds(
  storage: LookbackRemovalStorage,
  key: string,
  ids: string[],
): void {
  if (ids.length === 0) storage.removeItem(key);
  else storage.setItem(key, JSON.stringify(ids));
}

export function persistPendingLookbackRemoval(
  storage: LookbackRemovalStorage,
  serverUrl: string,
  account: string | null | undefined,
  itemId: string,
): void {
  const key = pendingLookbackRemovalStorageKey(serverUrl, account);
  if (!key) throw new Error("A signed-in account is required for cleanup.");
  const state = readIds(storage, key);
  if (!state.ok) throw new Error("Pending cleanup storage is unreadable.");
  if (state.ids.includes(itemId)) return;
  writeIds(storage, key, [...state.ids, itemId]);
}

export function readPendingLookbackRemovals(
  storage: LookbackRemovalStorage,
  serverUrl: string,
  account: string | null | undefined,
): PendingLookbackRemovalState {
  const key = pendingLookbackRemovalStorageKey(serverUrl, account);
  if (!key)
    return { status: "unreadable", pendingIds: new Set(), failed: true };
  const state = readIds(storage, key);
  if (!state.ok) {
    return { status: "unreadable", pendingIds: new Set(), failed: true };
  }
  return {
    status: "ready",
    pendingIds: new Set(state.ids),
    failed: false,
  };
}

export async function retryPendingLookbackRemovals(input: {
  storage: LookbackRemovalStorage;
  serverUrl: string;
  account: string | null | undefined;
  target: { serverUrl: string; authToken: string };
  skipIds?: ReadonlySet<string>;
  removeItem: (
    target: { serverUrl: string; authToken: string },
    itemId: string,
  ) => Promise<unknown>;
}): Promise<PendingLookbackRemovalState> {
  const key = pendingLookbackRemovalStorageKey(input.serverUrl, input.account);
  if (
    !key ||
    originForServer(input.target.serverUrl) !== originForServer(input.serverUrl)
  ) {
    return { status: "unreadable", pendingIds: new Set(), failed: true };
  }

  const initial = readPendingLookbackRemovals(
    input.storage,
    input.serverUrl,
    input.account,
  );
  if (initial.status === "unreadable") return initial;

  const initialIds = [...initial.pendingIds];
  let ids = [...initialIds];
  let failed = false;
  for (const itemId of initialIds) {
    if (input.skipIds?.has(itemId)) continue;
    try {
      await input.removeItem(input.target, itemId);
    } catch {
      failed = true;
      continue;
    }

    const remaining = ids.filter((id) => id !== itemId);
    try {
      writeIds(input.storage, key, remaining);
      ids = remaining;
    } catch {
      return {
        status: "unreadable",
        pendingIds: new Set(ids),
        failed: true,
      };
    }
  }

  return {
    status: "ready",
    pendingIds: new Set(ids),
    failed: failed || ids.length > 0,
  };
}

export function shouldProcessLookbackItem(
  itemId: string,
  state: PendingLookbackRemovalState,
): boolean {
  return state.status === "ready" && !state.pendingIds.has(itemId);
}

export function hasPendingLookbackRemovalWarning(
  state: PendingLookbackRemovalState,
): boolean {
  return state.status === "unreadable" || state.pendingIds.size > 0;
}
