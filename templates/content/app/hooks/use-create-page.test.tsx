// @vitest-environment happy-dom

import type { Document } from "@shared/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isDocumentCreationConfirmed,
  isDocumentCreationPending,
} from "@/lib/optimistic-document";

const mocks = vi.hoisted(() => {
  const getQueryData = vi.fn();
  const invalidateQueries = vi.fn();
  const removeQueries = vi.fn();
  const setQueryData = vi.fn();
  const queryClient = {
    getQueryCache: () => ({ findAll: () => [], subscribe: () => () => {} }),
    getQueryData,
    invalidateQueries,
    removeQueries,
    setQueryData,
  };
  return {
    createDocument: vi.fn(),
    getQueryData,
    invalidateQueries,
    navigate: vi.fn(),
    queryClient,
    removeCreatedDocumentNavigation: vi.fn(),
    removeQueries,
    rollbackOptimisticCreatedDocument: vi.fn(),
    seedCreatedDocumentNavigation: vi.fn(),
    setQueryData,
  };
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mocks.queryClient,
}));

vi.mock("react-router", () => ({
  useLocation: () => ({
    pathname: "/page/existing-page",
    search: "?view=table",
    hash: "#details",
  }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("@/hooks/use-content-spaces", () => ({
  useContentSpaces: () => ({ data: { spaces: [] } }),
}));

vi.mock("@/hooks/use-documents", () => ({
  removeCreatedDocumentNavigation: mocks.removeCreatedDocumentNavigation,
  rollbackOptimisticCreatedDocument: mocks.rollbackOptimisticCreatedDocument,
  seedCreatedDocumentNavigation: mocks.seedCreatedDocumentNavigation,
  useCreateDocument: () => ({ mutateAsync: mocks.createDocument }),
}));

vi.mock("@/hooks/use-local-storage", () => ({
  useLocalStorage: () => [null],
}));

vi.mock("@/components/sidebar/select-content-space", () => ({
  SELECTED_CONTENT_SPACE_STORAGE_KEY: "content-selected-space-id",
  contentSpaceForStoredSelection: () => null,
  contentSpaceIdForCreate: () => undefined,
}));

import { useCreatePage } from "./use-create-page";

describe("useCreatePage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    window.history.replaceState({}, "", "/");
    container.remove();
  });

  it("keeps an optimistic page editable and marks the create response for immediate use", async () => {
    let resolveCreation!: (document: Document) => void;
    mocks.createDocument.mockReturnValue(
      new Promise<Document>((resolve) => {
        resolveCreation = resolve;
      }),
    );

    let createPage!: () => Promise<string>;
    function Probe() {
      createPage = useCreatePage({ awaitPersist: false });
      return null;
    }

    await act(async () => {
      root.render(<Probe />);
    });

    let documentId = "";
    await act(async () => {
      documentId = await createPage();
    });

    const optimisticCacheWrite = mocks.setQueryData.mock.calls.find(
      ([key]) =>
        Array.isArray(key) &&
        key[0] === "action" &&
        key[1] === "get-document" &&
        key[2]?.id === documentId,
    );
    const optimisticDocument = optimisticCacheWrite?.[1] as Document;

    expect(mocks.navigate).toHaveBeenCalledWith(`/page/${documentId}`, {
      flushSync: true,
    });
    expect(
      isDocumentCreationPending(mocks.queryClient as never, optimisticDocument),
    ).toBe(true);

    const persistedDocument: Document = {
      id: documentId,
      parentId: null,
      title: "",
      content: "",
      icon: null,
      position: 9999,
      isFavorite: false,
      hideFromSearch: false,
      visibility: "private",
      createdAt: "2026-07-23T18:00:00.000Z",
      updatedAt: "2026-07-23T18:00:01.000Z",
    };

    await act(async () => {
      window.history.replaceState({}, "", `/page/${documentId}`);
      resolveCreation(persistedDocument);
      await Promise.resolve();
    });

    const documentWrites = mocks.setQueryData.mock.calls.filter(
      ([key]) =>
        Array.isArray(key) &&
        key[0] === "action" &&
        key[1] === "get-document" &&
        key[2]?.id === documentId,
    );
    const confirmedDocument = documentWrites[documentWrites.length - 1]?.[1] as
      | Document
      | undefined;
    if (!confirmedDocument) throw new Error("Create response was not cached");
    expect(confirmedDocument).toBe(persistedDocument);
    expect(
      isDocumentCreationPending(mocks.queryClient as never, confirmedDocument),
    ).toBe(false);
    expect(
      isDocumentCreationConfirmed(
        mocks.queryClient as never,
        confirmedDocument,
      ),
    ).toBe(true);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["action", "get-document"],
      predicate: expect.any(Function),
    });
  });

  it("preserves list metadata and rolls back only its optimistic page on failure", async () => {
    const previous = {
      documents: [{ id: "existing-page" }],
      pagination: { totalItems: 1 },
    };
    mocks.getQueryData.mockReturnValue(previous);
    mocks.createDocument.mockRejectedValue(new Error("create failed"));

    let createPage!: (
      parentId?: string,
      requestedId?: string,
    ) => Promise<string>;
    function Probe() {
      createPage = useCreatePage();
      return null;
    }

    await act(async () => {
      root.render(<Probe />);
    });

    await act(async () => {
      await expect(createPage("parent-page", "slash-page-id")).rejects.toThrow(
        "create failed",
      );
    });

    const optimisticUpdater = mocks.setQueryData.mock.calls[0]?.[1] as (
      old: typeof previous,
    ) => typeof previous;
    const optimistic = optimisticUpdater(previous);
    expect(optimistic.pagination).toBe(previous.pagination);
    expect(optimistic.documents).toHaveLength(2);
    expect(optimistic.documents[1]?.id).toBe("slash-page-id");
    expect(mocks.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "slash-page-id",
        parentId: "parent-page",
      }),
    );
    expect(mocks.rollbackOptimisticCreatedDocument).toHaveBeenCalledWith(
      expect.anything(),
      optimistic.documents[1]?.id,
      true,
    );
    expect(mocks.removeQueries).toHaveBeenCalledWith({
      queryKey: ["action", "get-document"],
      predicate: expect.any(Function),
    });
    expect(mocks.seedCreatedDocumentNavigation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "slash-page-id", parentId: "parent-page" }),
      null,
    );
    expect(mocks.removeCreatedDocumentNavigation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "slash-page-id", parentId: "parent-page" }),
    );
    expect(mocks.navigate).toHaveBeenLastCalledWith(
      "/page/existing-page?view=table#details",
      {
        replace: true,
        flushSync: true,
      },
    );
  });

  it("removes an optimistic list when no prior list snapshot existed", async () => {
    mocks.getQueryData.mockReturnValue(undefined);
    mocks.createDocument.mockRejectedValue(new Error("create failed"));

    let createPage!: () => Promise<string>;
    function Probe() {
      createPage = useCreatePage();
      return null;
    }
    await act(async () => root.render(<Probe />));
    await act(async () => {
      await expect(createPage()).rejects.toThrow("create failed");
    });

    expect(mocks.rollbackOptimisticCreatedDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      false,
    );
  });
});
