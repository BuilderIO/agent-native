// @vitest-environment happy-dom

import type { Document } from "@shared/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isDatabaseChoicePending } from "@/lib/optimistic-document";

const mocks = vi.hoisted(() => ({
  createDocument: vi.fn(),
  getQueryData: vi.fn(),
  invalidateQueries: vi.fn(),
  navigate: vi.fn(),
  removeQueries: vi.fn(),
  setQueryData: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    getQueryData: mocks.getQueryData,
    invalidateQueries: mocks.invalidateQueries,
    removeQueries: mocks.removeQueries,
    setQueryData: mocks.setQueryData,
  }),
}));

vi.mock("react-router", () => ({
  useLocation: () => ({ pathname: "/page/existing-page" }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("@/hooks/use-content-spaces", () => ({
  useContentSpaces: () => ({ data: { spaces: [] } }),
}));

vi.mock("@/hooks/use-documents", () => ({
  restoreListDocumentsSnapshot: (queryClient: any, snapshot: unknown) => {
    if (snapshot === undefined) {
      queryClient.removeQueries({
        queryKey: ["action", "list-documents", undefined],
      });
      return;
    }
    queryClient.setQueryData(["action", "list-documents", undefined], snapshot);
  },
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
    container.remove();
  });

  it("keeps database conversion blocked until optimistic page persistence resolves", async () => {
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
    expect(isDatabaseChoicePending(optimisticDocument, false)).toBe(true);

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
    expect(documentWrites[documentWrites.length - 1]?.[1]).toBe(
      persistedDocument,
    );
    expect(isDatabaseChoicePending(persistedDocument, false)).toBe(false);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["action", "get-document"],
      predicate: expect.any(Function),
    });
  });

  it("preserves list metadata and restores the exact snapshot when creation fails", async () => {
    const previous = {
      documents: [{ id: "existing-page" }],
      pagination: { totalItems: 1 },
    };
    mocks.getQueryData.mockReturnValue(previous);
    mocks.createDocument.mockRejectedValue(new Error("create failed"));

    let createPage!: () => Promise<string>;
    function Probe() {
      createPage = useCreatePage();
      return null;
    }

    await act(async () => {
      root.render(<Probe />);
    });

    await act(async () => {
      await expect(createPage()).rejects.toThrow("create failed");
    });

    const optimisticUpdater = mocks.setQueryData.mock.calls[0]?.[1] as (
      old: typeof previous,
    ) => typeof previous;
    const optimistic = optimisticUpdater(previous);
    expect(optimistic.pagination).toBe(previous.pagination);
    expect(optimistic.documents).toHaveLength(2);
    expect(mocks.setQueryData).toHaveBeenCalledWith(
      ["action", "list-documents", undefined],
      previous,
    );
    expect(mocks.removeQueries).toHaveBeenCalledWith({
      queryKey: ["action", "get-document"],
      predicate: expect.any(Function),
    });
    expect(mocks.navigate).toHaveBeenLastCalledWith("/page/existing-page", {
      replace: true,
      flushSync: true,
    });
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

    expect(mocks.removeQueries).toHaveBeenCalledWith({
      queryKey: ["action", "list-documents", undefined],
    });
  });
});
