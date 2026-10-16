import { describe, expect, it, vi } from "vitest";

import { ClipsActionError } from "../lib/clips-action";
import {
  hasPendingLookbackCleanupIntentWarning,
  pendingLookbackCleanupIntentStorageKey,
  persistPendingLookbackCleanupIntent,
  readPendingLookbackCleanupIntents,
  retryPendingLookbackCleanupIntents,
} from "./pending-lookback-cleanup-intent";
import {
  pendingLookbackRemovalStorageKey,
  readPendingLookbackRemovals,
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

const serverUrl = "https://clips.example.test";
const account = "person@example.test";
const request = {
  recordingId: "recording-1",
  seconds: 300,
  endedAt: "2026-10-15T12:00:00.000Z",
  deviceId: "device-1",
  includeMicrophone: true,
  includeSystemAudio: false,
};

describe("pending lookback cleanup intents", () => {
  it("scopes intents to the server origin and account", () => {
    const storage = memoryStorage();
    const key = pendingLookbackCleanupIntentStorageKey(serverUrl, account);
    if (!key) throw new Error("Expected a scoped storage key.");
    persistPendingLookbackCleanupIntent(storage, serverUrl, account, request);

    expect(
      pendingLookbackCleanupIntentStorageKey(
        `${serverUrl}/another-path`,
        "PERSON@example.test",
      ),
    ).toBe(key);
    expect(
      pendingLookbackCleanupIntentStorageKey(serverUrl, "other@example.test"),
    ).not.toBe(key);
    expect(storage.getItem(key)).toContain('"recordingId":"recording-1"');
  });

  it("reissues the idempotent request and queues its ID before clearing intent", async () => {
    const events: string[] = [];
    const values = new Map<string, string>();
    const intentKey = pendingLookbackCleanupIntentStorageKey(
      serverUrl,
      account,
    );
    const removalKey = pendingLookbackRemovalStorageKey(serverUrl, account);
    if (!intentKey || !removalKey)
      throw new Error("Expected scoped storage keys.");
    const storage: LookbackRemovalStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        if (key === intentKey) events.push("persist-intent");
        if (key === removalKey) events.push("persist-removal");
        values.set(key, value);
      },
      removeItem: (key) => {
        if (key === intentKey) events.push("clear-intent");
        values.delete(key);
      },
    };
    persistPendingLookbackCleanupIntent(storage, serverUrl, account, request);
    events.length = 0;
    const requestItem = vi.fn(async () => {
      events.push("request");
      return { id: "context-1" };
    });

    const state = await retryPendingLookbackCleanupIntents({
      storage,
      serverUrl,
      account,
      target: { serverUrl, authToken: "current-token" },
      requestItem,
    });

    expect(requestItem).toHaveBeenCalledWith(
      { serverUrl, authToken: "current-token" },
      request,
    );
    expect(events).toEqual([
      "request",
      "persist-intent",
      "persist-removal",
      "clear-intent",
    ]);
    expect(storage.getItem(removalKey)).toBe(JSON.stringify(["context-1"]));
    expect(storage.getItem(intentKey)).toBeNull();
    expect(state.pendingRecordingIds.size).toBe(0);
    expect(hasPendingLookbackCleanupIntentWarning(state)).toBe(false);
  });

  it("reuses a known context ID after a crash without creating another request", async () => {
    const storage = memoryStorage();
    persistPendingLookbackCleanupIntent(
      storage,
      serverUrl,
      account,
      request,
      "context-1",
    );
    const requestItem = vi.fn();

    const state = await retryPendingLookbackCleanupIntents({
      storage,
      serverUrl,
      account,
      target: { serverUrl, authToken: "current-token" },
      requestItem,
    });

    expect(requestItem).not.toHaveBeenCalled();
    expect(
      readPendingLookbackRemovals(storage, serverUrl, account).pendingIds,
    ).toEqual(new Set(["context-1"]));
    expect(state.pendingRecordingIds.size).toBe(0);
  });

  it("recovers at most one missing context ID per poll", async () => {
    const storage = memoryStorage();
    persistPendingLookbackCleanupIntent(storage, serverUrl, account, request);
    persistPendingLookbackCleanupIntent(storage, serverUrl, account, {
      ...request,
      recordingId: "recording-2",
    });
    const requestItem = vi
      .fn()
      .mockResolvedValueOnce({ id: "context-1" })
      .mockResolvedValueOnce({ id: "context-2" });

    const firstPoll = await retryPendingLookbackCleanupIntents({
      storage,
      serverUrl,
      account,
      target: { serverUrl, authToken: "current-token" },
      requestItem,
    });

    expect(requestItem).toHaveBeenCalledOnce();
    expect(firstPoll.pendingRecordingIds).toEqual(new Set(["recording-2"]));

    const secondPoll = await retryPendingLookbackCleanupIntents({
      storage,
      serverUrl,
      account,
      target: { serverUrl, authToken: "current-token" },
      requestItem,
    });

    expect(requestItem).toHaveBeenCalledTimes(2);
    expect(secondPoll.pendingRecordingIds.size).toBe(0);
  });

  it("keeps the intent and warning when request recovery fails", async () => {
    const storage = memoryStorage();
    persistPendingLookbackCleanupIntent(storage, serverUrl, account, request);
    const requestItem = vi.fn(async () => {
      throw new Error("network unavailable");
    });

    const state = await retryPendingLookbackCleanupIntents({
      storage,
      serverUrl,
      account,
      target: { serverUrl, authToken: "current-token" },
      requestItem,
    });

    expect(state.pendingRecordingIds).toEqual(new Set(["recording-1"]));
    expect(hasPendingLookbackCleanupIntentWarning(state)).toBe(true);
  });

  it.each([
    ["recording_context_invalid_window", 400],
    ["recording_unavailable", 404],
  ])(
    "clears cleanup intent after terminal request recovery error %s",
    async (code, status) => {
      const storage = memoryStorage();
      persistPendingLookbackCleanupIntent(storage, serverUrl, account, request);
      const intentKey = pendingLookbackCleanupIntentStorageKey(
        serverUrl,
        account,
      );
      if (!intentKey) throw new Error("Expected a scoped storage key.");
      const retryKey = `${intentKey}:recording-1`;
      const retries = new Map<string, { attempts: number; retryAt: number }>([
        [retryKey, { attempts: 1, retryAt: 1_000 }],
      ]);
      const requestItem = vi.fn(async () => {
        throw new ClipsActionError("terminal request error", status, code);
      });

      const state = await retryPendingLookbackCleanupIntents({
        storage,
        serverUrl,
        account,
        target: { serverUrl, authToken: "current-token" },
        retries,
        requestItem,
      });

      expect(requestItem).toHaveBeenCalledOnce();
      expect(state.pendingRecordingIds.size).toBe(0);
      expect(hasPendingLookbackCleanupIntentWarning(state)).toBe(false);
      expect(retries.size).toBe(0);
    },
  );

  it("keeps access-denied intent for a later retry", async () => {
    const storage = memoryStorage();
    persistPendingLookbackCleanupIntent(storage, serverUrl, account, request);
    const requestItem = vi.fn(async () => {
      throw new ClipsActionError("forbidden", 403, "recording_forbidden");
    });

    const state = await retryPendingLookbackCleanupIntents({
      storage,
      serverUrl,
      account,
      target: { serverUrl, authToken: "current-token" },
      requestItem,
      now: () => 5_000,
    });

    expect(state.pendingRecordingIds).toEqual(new Set(["recording-1"]));
    expect(hasPendingLookbackCleanupIntentWarning(state)).toBe(true);
  });

  it("persists exponential backoff after failed request recovery", async () => {
    const storage = memoryStorage();
    const key = pendingLookbackCleanupIntentStorageKey(serverUrl, account);
    if (!key) throw new Error("Expected a scoped storage key.");
    persistPendingLookbackCleanupIntent(storage, serverUrl, account, request);
    let now = 1_000;
    const requestItem = vi.fn(async () => {
      now += 4_000;
      throw new Error("network unavailable");
    });
    const retries = new Map<string, { attempts: number; retryAt: number }>();

    await retryPendingLookbackCleanupIntents({
      storage,
      serverUrl,
      account,
      target: { serverUrl, authToken: "current-token" },
      retries,
      now: () => now,
      requestItem,
    });

    expect(requestItem).toHaveBeenCalledOnce();
    expect(JSON.parse(storage.getItem(key) ?? "[]")).toMatchObject([
      { retryAttempts: 1, retryAt: 8_000 },
    ]);

    now = 7_999;
    await retryPendingLookbackCleanupIntents({
      storage,
      serverUrl,
      account,
      target: { serverUrl, authToken: "current-token" },
      retries,
      now: () => now,
      requestItem,
    });
    expect(requestItem).toHaveBeenCalledOnce();

    now = 8_000;
    await retryPendingLookbackCleanupIntents({
      storage,
      serverUrl,
      account,
      target: { serverUrl, authToken: "current-token" },
      retries,
      now: () => now,
      requestItem,
    });
    expect(requestItem).toHaveBeenCalledTimes(2);
    expect(JSON.parse(storage.getItem(key) ?? "[]")).toMatchObject([
      { retryAttempts: 2, retryAt: 18_000 },
    ]);
  });

  it("keeps the recovered ID in the intent when the removal queue cannot be saved", async () => {
    const values = new Map<string, string>();
    const intentKey = pendingLookbackCleanupIntentStorageKey(
      serverUrl,
      account,
    );
    const removalKey = pendingLookbackRemovalStorageKey(serverUrl, account);
    if (!intentKey || !removalKey)
      throw new Error("Expected scoped storage keys.");
    let failQueueWrite = true;
    const storage: LookbackRemovalStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        if (failQueueWrite && key === removalKey) {
          throw new Error("storage unavailable");
        }
        values.set(key, value);
      },
      removeItem: (key) => values.delete(key),
    };
    persistPendingLookbackCleanupIntent(storage, serverUrl, account, request);
    const requestItem = vi.fn(async () => ({ id: "context-1" }));

    const failed = await retryPendingLookbackCleanupIntents({
      storage,
      serverUrl,
      account,
      target: { serverUrl, authToken: "current-token" },
      now: () => 1_000,
      requestItem,
    });
    expect(failed.pendingRecordingIds).toEqual(new Set(["recording-1"]));
    expect(values.get(intentKey)).toContain('"itemId":"context-1"');

    failQueueWrite = false;
    const recovered = await retryPendingLookbackCleanupIntents({
      storage,
      serverUrl,
      account,
      target: { serverUrl, authToken: "current-token" },
      now: () => 4_000,
      requestItem,
    });

    expect(requestItem).toHaveBeenCalledOnce();
    expect(recovered.pendingRecordingIds.size).toBe(0);
    expect(values.get(removalKey)).toBe(JSON.stringify(["context-1"]));
    expect(values.get(intentKey)).toBeUndefined();
  });

  it("leaves live requests alone until their in-memory response settles", async () => {
    const storage = memoryStorage();
    persistPendingLookbackCleanupIntent(storage, serverUrl, account, request);
    const requestItem = vi.fn();

    const state = await retryPendingLookbackCleanupIntents({
      storage,
      serverUrl,
      account,
      target: { serverUrl, authToken: "current-token" },
      skipRecordingIds: new Set([request.recordingId]),
      requestItem,
    });

    expect(requestItem).not.toHaveBeenCalled();
    expect(state.pendingRecordingIds).toEqual(new Set([request.recordingId]));
  });

  it("does not recover intents against another server", async () => {
    const storage = memoryStorage();
    persistPendingLookbackCleanupIntent(storage, serverUrl, account, request);
    const requestItem = vi.fn();

    const state = await retryPendingLookbackCleanupIntents({
      storage,
      serverUrl,
      account,
      target: {
        serverUrl: "https://clips.other.test",
        authToken: "current-token",
      },
      requestItem,
    });

    expect(requestItem).not.toHaveBeenCalled();
    expect(state.status).toBe("unreadable");
    expect(hasPendingLookbackCleanupIntentWarning(state)).toBe(true);
  });

  it("treats malformed intent storage as unreadable instead of empty", () => {
    const storage = memoryStorage();
    const key = pendingLookbackCleanupIntentStorageKey(serverUrl, account);
    if (!key) throw new Error("Expected a scoped storage key.");
    storage.values.set(key, "{broken");

    const state = readPendingLookbackCleanupIntents(
      storage,
      serverUrl,
      account,
    );

    expect(state.status).toBe("unreadable");
    expect(hasPendingLookbackCleanupIntentWarning(state)).toBe(true);
  });
});
