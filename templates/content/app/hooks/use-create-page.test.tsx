// @vitest-environment happy-dom

import type { Document } from "@shared/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isDatabaseChoicePending } from "@/lib/optimistic-document";

const mocks = vi.hoisted(() => ({
  createDocument: vi.fn(),
  invalidateQueries: vi.fn(),
  navigate: vi.fn(),
  removeQueries: vi.fn(),
  setQueryData: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
    removeQueries: mocks.removeQueries,
    setQueryData: mocks.setQueryData,
  }),
}));

vi.mock("react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("@/hooks/use-content-spaces", () => ({
  useContentSpaces: () => ({ data: { spaces: [] } }),
}));

vi.mock("@/hooks/use-documents", () => ({
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
      queryKey: ["action", "get-document", { id: documentId }],
    });
  });
});
