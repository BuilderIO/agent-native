import type { Document } from "@shared/api";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  clearDocumentCreationConfirmed,
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
    const optimistic = markDocumentCreationPending(document());

    expect(isDocumentCreationPending(optimistic)).toBe(true);
    expect(isDocumentCreationPending({ ...optimistic })).toBe(true);
    expect(isDocumentCreationPending(document())).toBe(false);
  });

  it("marks a successful create response for immediate first paint", () => {
    const persisted = document();
    const confirmed = markDocumentCreationConfirmed(persisted);

    expect(confirmed).toBe(persisted);
    expect(isDocumentCreationConfirmed(confirmed)).toBe(true);
    expect(
      isDocumentCreationConfirmed(clearDocumentCreationConfirmed(confirmed)),
    ).toBe(false);
    expect(isDocumentCreationConfirmed(persisted)).toBe(false);
  });

  it("preserves create confirmation through query cache structural sharing", () => {
    const queryClient = new QueryClient();
    const queryKey = ["action", "get-document", { id: "page-1" }];
    queryClient.setQueryData(queryKey, markDocumentCreationPending(document()));
    queryClient.setQueryData(
      queryKey,
      markDocumentCreationConfirmed(document()),
    );

    const cached = queryClient.getQueryData<Document>(queryKey);
    expect(cached).toBeDefined();
    expect(isDocumentCreationConfirmed(cached!)).toBe(true);

    clearDocumentCreationConfirmed(cached!);
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
