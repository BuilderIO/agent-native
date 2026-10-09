import type { Document } from "@shared/api";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  clearDocumentCreationConfirmed,
  clearDocumentCreationPending,
  isDocumentCreationConfirmed,
  isDocumentCreationPending,
  markDocumentCreationConfirmed,
  markDocumentCreationPending,
  shouldCreateDocumentOptimistically,
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

describe("optimistic document creation", () => {
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
    const cleared = clearDocumentCreationConfirmed(queryClient, confirmed);
    expect(cleared).toBe(confirmed);
    expect(isDocumentCreationConfirmed(queryClient, cleared)).toBe(false);
    expect(isDocumentCreationConfirmed(queryClient, persisted)).toBe(false);
    queryClient.clear();
  });

  it("preserves create confirmation through query cache structural sharing", () => {
    const queryClient = new QueryClient();
    const queryKey = ["action", "get-document", { id: "page-1" }];
    queryClient.setQueryData(
      queryKey,
      markDocumentCreationPending(queryClient, document()),
    );
    queryClient.setQueryData(
      queryKey,
      markDocumentCreationConfirmed(queryClient, document()),
    );

    const cached = queryClient.getQueryData<Document>(queryKey);
    expect(cached).toBeDefined();
    expect(isDocumentCreationConfirmed(queryClient, cached!)).toBe(true);
    expect(isDocumentCreationPending(queryClient, cached!)).toBe(false);

    clearDocumentCreationConfirmed(queryClient, cached!);
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
