import { describe, expect, it, vi } from "vitest";

import {
  hasPendingLookbackRemovalWarning,
  pendingLookbackRemovalRetryIds,
  pendingLookbackRemovalStorageKey,
  persistPendingLookbackRemoval,
  recordLookbackRemovalRetryFailure,
  retryPendingLookbackRemovals,
  shouldProcessLookbackItem,
  type LookbackRemovalRetry,
  type LookbackRemovalStorage,
} from "./pending-lookback-removal";

function memoryStorage(): LookbackRemovalStorage & {
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe("pending lookback removal storage", () => {
  it("backs off failed removals and lets them retry when due", () => {
    const retries = new Map<string, LookbackRemovalRetry>();

    recordLookbackRemovalRetryFailure(retries, "context-1", 1_000);
    expect(pendingLookbackRemovalRetryIds(retries, 3_999)).toEqual(
      new Set(["context-1"]),
    );
    expect(pendingLookbackRemovalRetryIds(retries, 4_000).size).toBe(0);

    recordLookbackRemovalRetryFailure(retries, "context-1", 4_000);
    expect(pendingLookbackRemovalRetryIds(retries, 9_999)).toEqual(
      new Set(["context-1"]),
    );
    expect(pendingLookbackRemovalRetryIds(retries, 10_000).size).toBe(0);
  });

  it("scopes saved IDs by server origin and normalized account", () => {
    const key = pendingLookbackRemovalStorageKey(
      "https://clips.example.test/path",
      " Person@Example.Test ",
    );

    expect(key).toBe(
      pendingLookbackRemovalStorageKey(
        "https://clips.example.test/other-path",
        "person@example.test",
      ),
    );
    expect(key).not.toBe(
      pendingLookbackRemovalStorageKey(
        "https://clips.example.test",
        "other@example.test",
      ),
    );
    expect(key).not.toBe(
      pendingLookbackRemovalStorageKey(
        "https://clips.other.test",
        "person@example.test",
      ),
    );
  });

  it("does not retry another account's saved IDs", async () => {
    const storage = memoryStorage();
    const serverUrl = "https://clips.example.test";
    const otherAccount = "other@example.test";
    const originalKey = pendingLookbackRemovalStorageKey(
      serverUrl,
      "person@example.test",
    );
    if (!originalKey) throw new Error("Expected a scoped storage key.");
    persistPendingLookbackRemoval(
      storage,
      serverUrl,
      "person@example.test",
      "context-1",
    );
    const removeItem = vi.fn(async () => undefined);

    const state = await retryPendingLookbackRemovals({
      storage,
      serverUrl,
      account: otherAccount,
      target: { serverUrl, authToken: "other-account-token" },
      removeItem,
    });

    expect(removeItem).not.toHaveBeenCalled();
    expect(storage.getItem(originalKey)).toBe(JSON.stringify(["context-1"]));
    expect(state.pendingIds.size).toBe(0);
  });

  it("does not send an account's saved ID to another server origin", async () => {
    const storage = memoryStorage();
    const serverUrl = "https://clips.example.test";
    const key = pendingLookbackRemovalStorageKey(
      serverUrl,
      "person@example.test",
    );
    if (!key) throw new Error("Expected a scoped storage key.");
    persistPendingLookbackRemoval(
      storage,
      serverUrl,
      "person@example.test",
      "context-1",
    );
    const removeItem = vi.fn(async () => undefined);

    const state = await retryPendingLookbackRemovals({
      storage,
      serverUrl,
      account: "person@example.test",
      target: {
        serverUrl: "https://clips.other.test",
        authToken: "current-token",
      },
      removeItem,
    });

    expect(removeItem).not.toHaveBeenCalled();
    expect(storage.getItem(key)).toBe(JSON.stringify(["context-1"]));
    expect(state.status).toBe("unreadable");
    expect(shouldProcessLookbackItem("context-1", state)).toBe(false);
  });

  it("retries a persisted ID after restart with the current auth and clears it on success", async () => {
    const storage = memoryStorage();
    const serverUrl = "https://clips.example.test";
    const account = "person@example.test";
    const key = pendingLookbackRemovalStorageKey(serverUrl, account);
    if (!key) throw new Error("Expected a scoped storage key.");
    persistPendingLookbackRemoval(storage, serverUrl, account, "context-1");

    const removeItem = vi.fn(async (target: { authToken: string }) => {
      expect(storage.getItem(key)).toBe(JSON.stringify(["context-1"]));
      expect(target.authToken).toBe("current-token");
    });
    const state = await retryPendingLookbackRemovals({
      storage,
      serverUrl,
      account,
      target: { serverUrl, authToken: "current-token" },
      removeItem,
    });

    expect(removeItem).toHaveBeenCalledWith(
      { serverUrl, authToken: "current-token" },
      "context-1",
    );
    expect(storage.getItem(key)).toBeNull();
    expect(state).toEqual({
      status: "ready",
      pendingIds: new Set(),
      failed: false,
    });
  });

  it("preserves a new cleanup ID saved while another removal is in flight", async () => {
    const storage = memoryStorage();
    const serverUrl = "https://clips.example.test";
    const account = "person@example.test";
    const key = pendingLookbackRemovalStorageKey(serverUrl, account);
    if (!key) throw new Error("Expected a scoped storage key.");
    persistPendingLookbackRemoval(storage, serverUrl, account, "context-1");

    let finishRemoval!: () => void;
    const removalInFlight = new Promise<void>((resolve) => {
      finishRemoval = resolve;
    });
    const retry = retryPendingLookbackRemovals({
      storage,
      serverUrl,
      account,
      target: { serverUrl, authToken: "current-token" },
      removeItem: vi.fn(() => removalInFlight),
    });

    persistPendingLookbackRemoval(storage, serverUrl, account, "context-2");
    finishRemoval();
    const state = await retry;

    expect(storage.getItem(key)).toBe(JSON.stringify(["context-2"]));
    expect(state.pendingIds).toEqual(new Set(["context-2"]));

    const nextState = await retryPendingLookbackRemovals({
      storage,
      serverUrl,
      account,
      target: { serverUrl, authToken: "current-token" },
      removeItem: vi.fn(async () => undefined),
    });

    expect(storage.getItem(key)).toBeNull();
    expect(nextState.pendingIds.size).toBe(0);
  });

  it("retains failed IDs, restores the warning, and gates only their worker items", async () => {
    const storage = memoryStorage();
    const serverUrl = "https://clips.example.test";
    const account = "person@example.test";
    persistPendingLookbackRemoval(storage, serverUrl, account, "context-1");

    const state = await retryPendingLookbackRemovals({
      storage,
      serverUrl,
      account,
      target: { serverUrl, authToken: "current-token" },
      removeItem: vi.fn(async () => {
        throw new Error("network unavailable");
      }),
    });

    expect(state.status).toBe("ready");
    expect(state.pendingIds).toEqual(new Set(["context-1"]));
    expect(state.failed).toBe(true);
    expect(hasPendingLookbackRemovalWarning(state)).toBe(true);
    expect(shouldProcessLookbackItem("context-1", state)).toBe(false);
    expect(shouldProcessLookbackItem("context-2", state)).toBe(true);
  });

  it("clears an ID when removal reports the typed not-found result", async () => {
    const storage = memoryStorage();
    const serverUrl = "https://clips.example.test";
    const account = "person@example.test";
    const key = pendingLookbackRemovalStorageKey(serverUrl, account);
    if (!key) throw new Error("Expected a scoped storage key.");
    persistPendingLookbackRemoval(storage, serverUrl, account, "context-1");

    const state = await retryPendingLookbackRemovals({
      storage,
      serverUrl,
      account,
      target: { serverUrl, authToken: "current-token" },
      removeItem: vi.fn(async () => null),
    });

    expect(storage.getItem(key)).toBeNull();
    expect(state.pendingIds.size).toBe(0);
    expect(hasPendingLookbackRemovalWarning(state)).toBe(false);
  });

  it("does not remove items or process worker items when storage is unreadable", async () => {
    const storage: LookbackRemovalStorage = {
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {
        throw new Error("storage unavailable");
      },
      removeItem: () => {
        throw new Error("storage unavailable");
      },
    };
    const removeItem = vi.fn(async () => undefined);
    const state = await retryPendingLookbackRemovals({
      storage,
      serverUrl: "https://clips.example.test",
      account: "person@example.test",
      target: {
        serverUrl: "https://clips.example.test",
        authToken: "current-token",
      },
      removeItem,
    });

    expect(removeItem).not.toHaveBeenCalled();
    expect(state.status).toBe("unreadable");
    expect(hasPendingLookbackRemovalWarning(state)).toBe(true);
    expect(shouldProcessLookbackItem("context-1", state)).toBe(false);
  });

  it("does not clear malformed storage or remove its ID", async () => {
    const storage = memoryStorage();
    const serverUrl = "https://clips.example.test";
    const account = "person@example.test";
    const key = pendingLookbackRemovalStorageKey(serverUrl, account);
    if (!key) throw new Error("Expected a scoped storage key.");
    storage.values.set(key, "{broken");
    const removeItem = vi.fn(async () => undefined);

    const state = await retryPendingLookbackRemovals({
      storage,
      serverUrl,
      account,
      target: { serverUrl, authToken: "current-token" },
      removeItem,
    });

    expect(removeItem).not.toHaveBeenCalled();
    expect(storage.getItem(key)).toBe("{broken");
    expect(state.status).toBe("unreadable");
    expect(shouldProcessLookbackItem("context-1", state)).toBe(false);
  });

  it("keeps the stored ID when persisting or clearing storage fails", async () => {
    const storage = memoryStorage();
    const serverUrl = "https://clips.example.test";
    const account = "person@example.test";
    const key = pendingLookbackRemovalStorageKey(serverUrl, account);
    if (!key) throw new Error("Expected a scoped storage key.");

    const setFailure: LookbackRemovalStorage = {
      ...storage,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    expect(() =>
      persistPendingLookbackRemoval(
        setFailure,
        serverUrl,
        account,
        "context-1",
      ),
    ).toThrow("quota exceeded");

    persistPendingLookbackRemoval(storage, serverUrl, account, "context-1");
    const clearFailure: LookbackRemovalStorage = {
      ...storage,
      removeItem: () => {
        throw new Error("storage locked");
      },
    };
    const state = await retryPendingLookbackRemovals({
      storage: clearFailure,
      serverUrl,
      account,
      target: { serverUrl, authToken: "current-token" },
      removeItem: vi.fn(async () => undefined),
    });

    expect(state.status).toBe("unreadable");
    expect(state.pendingIds).toEqual(new Set(["context-1"]));
    expect(storage.getItem(key)).toBe(JSON.stringify(["context-1"]));
    expect(shouldProcessLookbackItem("context-1", state)).toBe(false);
  });
});
