import type { Document } from "@shared/api";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearDocumentCreateIntent,
  clearDocumentCreationConfirmed,
  clearDocumentCreationPending,
  DocumentCreateIntentStorageError,
  getDocumentCreationBaseline,
  isDocumentCreationConfirmed,
  isDocumentCreationPending,
  isDocumentCreateInFlight,
  markDocumentCreationConfirmed,
  markDocumentCreationPending,
  readDocumentCreateIntents,
  shouldCreateDocumentOptimistically,
  shouldAutoRetryDocumentCreate,
  writeDocumentCreateIntent,
  withDocumentCreateInFlight,
} from "./optimistic-document";

function document(): Document {
  return {
    id: "page-1",
    parentId: null,
    title: "",
    content: "",
    icon: null,
    position: 0,
    isFavorite: false,
    hideFromSearch: false,
    createdAt: "2026-07-23T18:00:00.000Z",
    updatedAt: "2026-07-23T18:00:00.000Z",
  };
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function quarantinedIntentValues(storage: Storage, key: string): string[] {
  const prefix = `${key}:quarantine:`;
  const values: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const candidate = storage.key(index);
    if (!candidate?.startsWith(prefix)) continue;
    const value = storage.getItem(candidate);
    if (value !== null) values.push(value);
  }
  return values;
}

describe("optimistic document creation", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("persists create intents only when explicitly written and scopes them to the actor", () => {
    const actor = { accountId: " Writer@Example.com ", orgId: " org-1 " };
    const otherActor = { accountId: "writer@example.com", orgId: "org-2" };
    const intent = {
      id: "page-1",
      parentId: "parent-1",
      spaceId: "space-1",
      filesDatabaseId: "files-db-1",
      createdAt: "2026-10-08T12:00:00.000Z",
    };

    expect(readDocumentCreateIntents(actor)).toEqual([]);
    expect(window.localStorage.length).toBe(0);

    writeDocumentCreateIntent(actor, intent);

    expect(readDocumentCreateIntents(actor)).toEqual([intent]);
    expect(readDocumentCreateIntents(otherActor)).toEqual([]);
    expect(window.localStorage.length).toBe(1);
  });

  it("does not automatically retry a create after a recorded failure", () => {
    expect(shouldAutoRetryDocumentCreate({})).toBe(true);
    expect(shouldAutoRetryDocumentCreate({ status: "pending" })).toBe(true);
    expect(shouldAutoRetryDocumentCreate({ status: "failed" })).toBe(false);

    const actor = { accountId: "writer@example.com", orgId: null };
    const failedIntent = {
      id: "page-failed",
      parentId: "missing-parent",
      spaceId: null,
      createdAt: "2026-10-08T12:00:00.000Z",
      status: "failed" as const,
    };
    writeDocumentCreateIntent(actor, failedIntent);

    expect(readDocumentCreateIntents(actor)).toEqual([failedIntent]);
  });

  it("keeps concurrent creates in flight until each request settles", async () => {
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    const first = withDocumentCreateInFlight(
      "page-in-flight",
      () => new Promise<void>((resolve) => (finishFirst = resolve)),
    );
    const second = withDocumentCreateInFlight(
      "page-in-flight",
      () => new Promise<void>((resolve) => (finishSecond = resolve)),
    );

    expect(isDocumentCreateInFlight("page-in-flight")).toBe(true);
    finishFirst();
    await first;
    expect(isDocumentCreateInFlight("page-in-flight")).toBe(true);
    finishSecond();
    await second;
    expect(isDocumentCreateInFlight("page-in-flight")).toBe(false);
  });

  it("replaces an intent by ID and clears it without disturbing other intents", () => {
    const actor = { accountId: "writer@example.com", orgId: null };
    const first = {
      id: "page-1",
      parentId: null,
      spaceId: null,
      createdAt: "2026-10-08T12:00:00.000Z",
    };
    const second = {
      id: "page-2",
      parentId: "parent-1",
      spaceId: "space-1",
      createdAt: "2026-10-08T12:01:00.000Z",
    };

    writeDocumentCreateIntent(actor, first);
    writeDocumentCreateIntent(actor, second);
    writeDocumentCreateIntent(actor, { ...first, parentId: "parent-2" });

    expect(readDocumentCreateIntents(actor)).toEqual([
      { ...first, parentId: "parent-2" },
      second,
    ]);
    expect(clearDocumentCreateIntent(actor, first.id)).toBe(true);
    expect(readDocumentCreateIntents(actor)).toEqual([second]);
    expect(clearDocumentCreateIntent(actor, second.id)).toBe(true);
    expect(readDocumentCreateIntents(actor)).toEqual([]);
    expect(window.localStorage.length).toBe(0);
    expect(clearDocumentCreateIntent(actor, second.id)).toBe(false);
  });

  it("writes concurrent page intents to independent storage keys", () => {
    const actor = { accountId: "writer@example.com", orgId: null };
    const intents = [
      {
        id: "concurrent-page-1",
        parentId: null,
        spaceId: null,
        createdAt: "2026-10-08T12:00:00.000Z",
      },
      {
        id: "concurrent-page-2",
        parentId: null,
        spaceId: null,
        createdAt: "2026-10-08T12:01:00.000Z",
      },
    ];
    const storage = window.localStorage;
    const originalGetItem = storage.getItem;
    storage.getItem = () => {
      throw new DOMException("A stale tab read.", "InvalidStateError");
    };

    try {
      writeDocumentCreateIntent(actor, intents[0]);
      writeDocumentCreateIntent(actor, intents[1]);
    } finally {
      storage.getItem = originalGetItem;
    }

    expect(readDocumentCreateIntents(actor)).toEqual(intents);
  });

  it("quarantines malformed records and preserves valid pending intents", () => {
    const actor = { accountId: "writer@example.com", orgId: null };
    const key = "content-document-create-intent-v1:writer%40example.com:";
    const validIntent = {
      id: "recoverable-page",
      parentId: null,
      spaceId: null,
      createdAt: "2026-10-08T12:00:00.000Z",
    };
    const raw = JSON.stringify([validIntent, { id: "malformed-page" }]);
    const storageWarning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    window.localStorage.setItem(key, raw);

    try {
      expect(readDocumentCreateIntents(actor)).toEqual([validIntent]);
      expect(window.localStorage.getItem(key)).toBeNull();
      expect(
        window.localStorage.getItem(
          `${key}:intent:${encodeURIComponent(validIntent.id)}`,
        ),
      ).toBe(JSON.stringify(validIntent));
      expect(quarantinedIntentValues(window.localStorage, key)).toEqual([raw]);

      const nextIntent = {
        id: "new-page",
        parentId: "parent-page",
        spaceId: null,
        createdAt: "2026-10-08T12:01:00.000Z",
      };
      writeDocumentCreateIntent(actor, nextIntent);

      expect(readDocumentCreateIntents(actor)).toEqual([
        validIntent,
        nextIntent,
      ]);
      expect(quarantinedIntentValues(window.localStorage, key)).toEqual([raw]);
      expect(storageWarning).toHaveBeenCalledWith(
        "Quarantined malformed pending Content page creation data.",
        expect.any(DocumentCreateIntentStorageError),
      );
    } finally {
      storageWarning.mockRestore();
    }
  });

  it("quarantines unparsable raw data and allows later create intent writes", () => {
    const actor = { accountId: "writer@example.com", orgId: null };
    const key = "content-document-create-intent-v1:writer%40example.com:";
    const raw = "{truncated-json";
    const storageWarning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    window.localStorage.setItem(key, raw);

    try {
      expect(readDocumentCreateIntents(actor)).toEqual([]);
      expect(window.localStorage.getItem(key)).toBeNull();
      expect(quarantinedIntentValues(window.localStorage, key)).toEqual([raw]);

      const nextIntent = {
        id: "new-page",
        parentId: null,
        spaceId: null,
        createdAt: "2026-10-08T12:01:00.000Z",
      };
      writeDocumentCreateIntent(actor, nextIntent);
      expect(readDocumentCreateIntents(actor)).toEqual([nextIntent]);
      expect(quarantinedIntentValues(window.localStorage, key)).toEqual([raw]);
    } finally {
      storageWarning.mockRestore();
    }
  });

  it("keeps the malformed active value when it cannot be quarantined", () => {
    const actor = { accountId: "writer@example.com", orgId: null };
    const key = "content-document-create-intent-v1:writer%40example.com:";
    const raw = "{truncated-json";
    const storage = window.localStorage;
    const originalSetItem = storage.setItem;
    storage.setItem = (storageKey, value) => {
      if (storageKey.startsWith(`${key}:quarantine:`)) {
        throw new DOMException("Storage is full.", "QuotaExceededError");
      }
      originalSetItem.call(storage, storageKey, value);
    };
    storage.setItem(key, raw);

    try {
      let storageError: unknown;
      try {
        readDocumentCreateIntents(actor);
      } catch (error) {
        storageError = error;
      }
      expect(storageError).toBeInstanceOf(DocumentCreateIntentStorageError);
      expect(storageError).toMatchObject({ code: "write_failed" });
      expect(storage.getItem(key)).toBe(raw);
      expect(quarantinedIntentValues(storage, key)).toEqual([]);
    } finally {
      storage.setItem = originalSetItem;
    }
  });

  it("marks only the optimistic cache record as pending", () => {
    const queryClient = new QueryClient();
    const otherQueryClient = new QueryClient();
    const optimistic = markDocumentCreationPending(queryClient, document());

    expect(isDocumentCreationPending(queryClient, optimistic)).toBe(true);
    expect(isDocumentCreationPending(queryClient, { ...optimistic })).toBe(
      true,
    );
    expect(isDocumentCreationPending(otherQueryClient, optimistic)).toBe(false);
    queryClient.clear();
    otherQueryClient.clear();
  });

  it("clears only the creation state that has settled", () => {
    const queryClient = new QueryClient();
    const pending = markDocumentCreationPending(queryClient, document());

    clearDocumentCreationConfirmed(queryClient, pending);
    expect(isDocumentCreationPending(queryClient, pending)).toBe(true);

    clearDocumentCreationPending(queryClient, pending);
    expect(isDocumentCreationPending(queryClient, pending)).toBe(false);
    expect(isDocumentCreationConfirmed(queryClient, pending)).toBe(false);

    queryClient.clear();
  });

  it("preserves pending create state through query cache structural sharing", () => {
    const queryClient = new QueryClient();
    const queryKey = ["action", "get-document", { id: "page-1" }];
    const optimistic = markDocumentCreationPending(queryClient, document());
    queryClient.setQueryData(queryKey, optimistic);
    queryClient.setQueryData(queryKey, { ...optimistic, title: "Untitled" });

    const cached = queryClient.getQueryData<Document>(queryKey);
    expect(cached).toBeDefined();
    expect(isDocumentCreationPending(queryClient, cached!)).toBe(true);

    queryClient.clear();
  });

  it("marks a successful create response for immediate first paint", () => {
    const queryClient = new QueryClient();
    const persisted = document();
    const confirmed = markDocumentCreationConfirmed(queryClient, persisted);

    expect(confirmed).toBe(persisted);
    expect(isDocumentCreationConfirmed(queryClient, confirmed)).toBe(true);
    expect(getDocumentCreationBaseline(queryClient, confirmed)).toBe(persisted);
    const cleared = clearDocumentCreationConfirmed(queryClient, confirmed);
    expect(cleared).toBe(confirmed);
    expect(isDocumentCreationConfirmed(queryClient, cleared)).toBe(false);
    expect(getDocumentCreationBaseline(queryClient, cleared)).toBeUndefined();
    expect(isDocumentCreationConfirmed(queryClient, persisted)).toBe(false);
    queryClient.clear();
  });

  it("preserves create confirmation through query cache structural sharing", () => {
    const queryClient = new QueryClient();
    const queryKey = ["action", "get-document", { id: "page-1" }];
    const created = document();
    queryClient.setQueryData(
      queryKey,
      markDocumentCreationPending(queryClient, document()),
    );
    queryClient.setQueryData(
      queryKey,
      markDocumentCreationConfirmed(queryClient, created),
    );

    const cached = queryClient.getQueryData<Document>(queryKey);
    expect(cached).toBeDefined();
    expect(isDocumentCreationConfirmed(queryClient, cached!)).toBe(true);
    expect(isDocumentCreationPending(queryClient, cached!)).toBe(false);
    expect(getDocumentCreationBaseline(queryClient, cached!)).toBe(created);

    clearDocumentCreationConfirmed(queryClient, cached!);
    expect(getDocumentCreationBaseline(queryClient, cached!)).toBeUndefined();
    queryClient.clear();
  });

  it("clears create confirmation without replacing a failed query result", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const queryKey = ["action", "get-document", { id: "page-1" }];
    const created = markDocumentCreationConfirmed(queryClient, document());
    queryClient.setQueryData(queryKey, created);

    await expect(
      queryClient.fetchQuery({
        queryKey,
        queryFn: async () => {
          throw Object.assign(new Error("forbidden"), { status: 403 });
        },
        retry: false,
      }),
    ).rejects.toThrow("forbidden");

    const cached = queryClient.getQueryData<Document>(queryKey);
    expect(cached).toBe(created);
    clearDocumentCreationConfirmed(queryClient, cached!);
    expect(queryClient.getQueryData(queryKey)).toBe(cached);
    expect(queryClient.getQueryState(queryKey)?.status).toBe("error");
    expect(queryClient.getQueryState(queryKey)?.error).toMatchObject({
      status: 403,
    });

    queryClient.clear();
  });

  it("clears create confirmation when its cached page is removed", () => {
    const queryClient = new QueryClient();
    const queryKey = ["action", "get-document", { id: "page-1" }];
    const created = markDocumentCreationConfirmed(queryClient, document());
    queryClient.setQueryData(queryKey, created);

    queryClient.removeQueries({ queryKey });

    expect(isDocumentCreationConfirmed(queryClient, created)).toBe(false);
    expect(getDocumentCreationBaseline(queryClient, created)).toBeUndefined();
    queryClient.clear();
  });

  it("keeps database-backed workspace creation optimistic when local files coexist", () => {
    expect(
      shouldCreateDocumentOptimistically({
        localFileMode: true,
        filesDatabaseId: "files-db-1",
      }),
    ).toBe(true);
    expect(shouldCreateDocumentOptimistically({ localFileMode: true })).toBe(
      false,
    );
    expect(shouldCreateDocumentOptimistically({ localFileMode: false })).toBe(
      true,
    );
  });
});
