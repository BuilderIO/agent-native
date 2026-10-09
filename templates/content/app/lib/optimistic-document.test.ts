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
  markDocumentCreationConfirmed,
  markDocumentCreationPending,
  readDocumentCreateIntents,
  shouldCreateDocumentOptimistically,
  writeDocumentCreateIntent,
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
      second,
      { ...first, parentId: "parent-2" },
    ]);
    expect(clearDocumentCreateIntent(actor, first.id)).toBe(true);
    expect(readDocumentCreateIntents(actor)).toEqual([second]);
    expect(clearDocumentCreateIntent(actor, second.id)).toBe(true);
    expect(readDocumentCreateIntents(actor)).toEqual([]);
    expect(window.localStorage.length).toBe(0);
    expect(clearDocumentCreateIntent(actor, second.id)).toBe(false);
  });

  it("rejects malformed create intent records instead of treating them as absent", () => {
    const actor = { accountId: "writer@example.com", orgId: null };
    const key = "content-document-create-intent-v1:writer%40example.com:";
    window.localStorage.setItem(key, JSON.stringify([{ id: "page-1" }]));

    expect(() => readDocumentCreateIntents(actor)).toThrow(
      DocumentCreateIntentStorageError,
    );
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
