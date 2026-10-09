// @vitest-environment happy-dom

import type { Document } from "@shared/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DocumentCreateIntentStorageError,
  isDocumentCreationConfirmed,
  isDocumentCreationPending,
  readDocumentCreateIntents,
} from "@/lib/optimistic-document";

const mocks = vi.hoisted(() => {
  const getQueryData = vi.fn();
  const invalidateQueries = vi.fn();
  const removeQueries = vi.fn();
  const setQueryData = vi.fn();
  const toastError = vi.fn(() => "create-error-toast");
  const toastDismiss = vi.fn();
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
    location: {
      pathname: "/page/existing-page",
      search: "?view=table",
      hash: "#details",
    },
    queryClient,
    removeCreatedDocumentNavigation: vi.fn(),
    removeQueries,
    rollbackOptimisticCreatedDocument: vi.fn(),
    seedCreatedDocumentNavigation: vi.fn(),
    setQueryData,
    toastDismiss,
    toastError,
  };
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mocks.queryClient,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useSession: () => ({
    session: { email: "writer@example.test", orgId: "org" },
  }),
}));

vi.mock("react-router", () => ({
  useLocation: () => mocks.location,
  useNavigate: () => mocks.navigate,
}));

vi.mock("sonner", () => ({
  toast: { dismiss: mocks.toastDismiss, error: mocks.toastError },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
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

function createTestLockManager() {
  return {
    request<T>(
      _name: string,
      _options: { mode: "exclusive" },
      callback: (lock: unknown) => T | Promise<T>,
    ) {
      return Promise.resolve(callback({}));
    },
  };
}

describe("useCreatePage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("navigator", { locks: createTestLockManager() });
    window.localStorage.clear();
    mocks.location.pathname = "/page/existing-page";
    mocks.location.search = "?view=table";
    mocks.location.hash = "#details";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
    window.localStorage.clear();
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

    expect(optimisticDocument).toMatchObject({
      accessRole: "owner",
      canEdit: true,
      canManage: true,
    });
    expect(mocks.navigate).toHaveBeenCalledWith(`/page/${documentId}`, {
      flushSync: true,
    });
    expect(
      isDocumentCreationPending(mocks.queryClient as never, optimisticDocument),
    ).toBe(true);
    expect(
      readDocumentCreateIntents({
        accountId: "writer@example.test",
        orgId: "org",
      }),
    ).toEqual([
      expect.objectContaining({
        id: documentId,
        createdAt: expect.any(String),
      }),
    ]);

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
      window.history.replaceState({}, "", `/content/page/${documentId}`);
      mocks.location.pathname = `/page/${documentId}`;
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
    expect(
      readDocumentCreateIntents({
        accountId: "writer@example.test",
        orgId: "org",
      }),
    ).toEqual([]);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["action", "get-document"],
      predicate: expect.any(Function),
    });
  });

  it.each(["unavailable", "full", "corrupt"] as const)(
    "attempts server creation when create-intent storage is %s",
    async (storageFailure) => {
      const id = `storage-${storageFailure}-page`;
      const persistedDocument: Document = {
        id,
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
      mocks.createDocument.mockResolvedValue(persistedDocument);

      const actorStorageKey =
        "content-document-create-intent-v1:writer%40example.test:org";
      let restoreStorage: (() => void) | undefined;
      if (storageFailure === "unavailable") {
        const localStorageDescriptor = Object.getOwnPropertyDescriptor(
          window,
          "localStorage",
        );
        Object.defineProperty(window, "localStorage", {
          configurable: true,
          get() {
            throw new DOMException("Storage is blocked.", "SecurityError");
          },
        });
        restoreStorage = () => {
          if (localStorageDescriptor) {
            Object.defineProperty(
              window,
              "localStorage",
              localStorageDescriptor,
            );
          } else {
            Reflect.deleteProperty(window, "localStorage");
          }
        };
      } else if (storageFailure === "full") {
        const storage = window.localStorage;
        const localStorageDescriptor = Object.getOwnPropertyDescriptor(
          window,
          "localStorage",
        );
        const failingStorage = new Proxy(storage, {
          get(target, property) {
            if (property === "setItem") {
              return () => {
                throw new DOMException(
                  "Storage is full.",
                  "QuotaExceededError",
                );
              };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        Object.defineProperty(window, "localStorage", {
          configurable: true,
          get: () => failingStorage,
        });
        restoreStorage = () => {
          if (localStorageDescriptor) {
            Object.defineProperty(
              window,
              "localStorage",
              localStorageDescriptor,
            );
          } else {
            Reflect.deleteProperty(window, "localStorage");
          }
        };
      } else {
        window.localStorage.setItem(
          actorStorageKey,
          JSON.stringify([{ id: "unreadable-record" }]),
        );
      }

      const storageErrorLog = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const storageRepairLog = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      mocks.location.pathname = `/page/${id}`;
      let createPage!: (
        parentId?: string,
        requestedId?: string,
      ) => Promise<string>;
      function Probe() {
        createPage = useCreatePage();
        return null;
      }

      try {
        await act(async () => root.render(<Probe />));
        await act(async () => {
          await expect(createPage(undefined, id)).resolves.toBe(id);
        });
        if (storageFailure === "corrupt") {
          expect(storageRepairLog).toHaveBeenCalledWith(
            "Quarantined malformed pending Content page creation data.",
            expect.any(DocumentCreateIntentStorageError),
          );
        } else {
          expect(storageErrorLog).toHaveBeenCalledWith(
            expect.stringContaining("attempting server creation anyway"),
            expect.any(DocumentCreateIntentStorageError),
          );
        }
      } finally {
        restoreStorage?.();
        storageErrorLog.mockRestore();
        storageRepairLog.mockRestore();
      }

      expect(mocks.createDocument).toHaveBeenCalledExactlyOnceWith({
        id,
        title: "",
        parentId: undefined,
        spaceId: undefined,
      });
      const documentWrites = mocks.setQueryData.mock.calls.filter(
        ([key]) =>
          Array.isArray(key) &&
          key[0] === "action" &&
          key[1] === "get-document" &&
          key[2]?.id === id,
      );
      const confirmed = documentWrites[documentWrites.length - 1]?.[1] as
        | Document
        | undefined;
      expect(confirmed).toBe(persistedDocument);
      expect(
        isDocumentCreationConfirmed(mocks.queryClient as never, confirmed!),
      ).toBe(true);
      if (storageFailure === "corrupt") {
        expect(
          readDocumentCreateIntents({
            accountId: "writer@example.test",
            orgId: "org",
          }),
        ).toEqual([]);
      }
    },
  );

  it("keeps server creation failures distinct when intent storage also fails", async () => {
    const id = "storage-and-server-failure-page";
    const createError = new Error("server create failed");
    const storage = window.localStorage;
    const localStorageDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "localStorage",
    );
    const failingStorage = new Proxy(storage, {
      get(target, property) {
        if (property === "setItem") {
          return () => {
            throw new DOMException("Storage is full.", "QuotaExceededError");
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => failingStorage,
    });
    const storageErrorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.location.pathname = `/page/${id}`;
    mocks.createDocument.mockRejectedValue(createError);

    let createPage!: (
      parentId?: string,
      requestedId?: string,
    ) => Promise<string>;
    function Probe() {
      createPage = useCreatePage();
      return null;
    }

    try {
      await act(async () => root.render(<Probe />));
      await act(async () => {
        await expect(createPage(undefined, id)).rejects.toBe(createError);
      });
      expect(storageErrorLog).toHaveBeenCalledWith(
        expect.stringContaining("attempting server creation anyway"),
        expect.any(DocumentCreateIntentStorageError),
      );
    } finally {
      if (localStorageDescriptor) {
        Object.defineProperty(window, "localStorage", localStorageDescriptor);
      } else {
        Reflect.deleteProperty(window, "localStorage");
      }
      storageErrorLog.mockRestore();
    }

    expect(mocks.createDocument).toHaveBeenCalledExactlyOnceWith({
      id,
      title: "",
      parentId: undefined,
      spaceId: undefined,
    });
    expect(mocks.toastError).toHaveBeenCalledWith(
      "sidebar.failedCreatePage",
      expect.objectContaining({ description: createError.message }),
    );
    const optimistic = mocks.setQueryData.mock.calls.find(
      ([key]) =>
        Array.isArray(key) &&
        key[0] === "action" &&
        key[1] === "get-document" &&
        key[2]?.id === id,
    )?.[1] as Document | undefined;
    expect(optimistic).toBeDefined();
    expect(
      isDocumentCreationConfirmed(mocks.queryClient as never, optimistic!),
    ).toBe(false);
  });

  it("keeps a navigated optimistic page reachable and retries creation with the same ID", async () => {
    const previous = {
      documents: [{ id: "existing-page" }],
      pagination: { totalItems: 1 },
    };
    mocks.getQueryData.mockReturnValue(previous);
    mocks.createDocument
      .mockRejectedValueOnce(new Error("create failed"))
      .mockResolvedValueOnce({
        id: "slash-page-id",
        parentId: "parent-page",
        title: "",
        content: "",
        icon: null,
        position: 9999,
        isFavorite: false,
        hideFromSearch: false,
        visibility: "private",
        createdAt: "2026-07-23T18:00:00.000Z",
        updatedAt: "2026-07-23T18:00:01.000Z",
      } satisfies Document);

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

    const listWrite = mocks.setQueryData.mock.calls.find(
      ([key]) =>
        Array.isArray(key) &&
        key[0] === "action" &&
        key[1] === "list-documents",
    );
    const optimisticUpdater = listWrite?.[1] as (
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
    expect(mocks.rollbackOptimisticCreatedDocument).not.toHaveBeenCalled();
    expect(mocks.removeQueries).not.toHaveBeenCalled();
    expect(mocks.seedCreatedDocumentNavigation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "slash-page-id", parentId: "parent-page" }),
      null,
    );
    expect(mocks.removeCreatedDocumentNavigation).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(
      "/page/slash-page-id",
      {
        flushSync: true,
      },
    );
    expect(
      readDocumentCreateIntents({
        accountId: "writer@example.test",
        orgId: "org",
      }),
    ).toEqual([
      expect.objectContaining({
        id: "slash-page-id",
        parentId: "parent-page",
      }),
    ]);

    const [toastMessage, toastOptions] = mocks.toastError.mock
      .calls[0] as unknown as [
      string,
      {
        action: { label: string; onClick: () => Promise<void> };
        description?: string;
        duration: number;
      },
    ];
    expect(toastMessage).toBe("sidebar.failedCreatePage");
    expect(toastOptions.description).toBe("create failed");
    expect(toastOptions.duration).toBe(Number.POSITIVE_INFINITY);
    expect(toastOptions.action.label).toBe("database.retry");

    await act(async () => {
      window.history.replaceState({}, "", "/content/page/slash-page-id");
      mocks.location.pathname = "/page/slash-page-id";
      await toastOptions.action.onClick();
    });

    expect(mocks.createDocument).toHaveBeenCalledTimes(2);
    expect(mocks.createDocument.mock.calls.map(([input]) => input.id)).toEqual([
      "slash-page-id",
      "slash-page-id",
    ]);
    expect(mocks.toastDismiss).toHaveBeenCalledWith("create-error-toast");
    const documentWrites = mocks.setQueryData.mock.calls.filter(
      ([key]) =>
        Array.isArray(key) &&
        key[0] === "action" &&
        key[1] === "get-document" &&
        key[2]?.id === "slash-page-id",
    );
    const confirmedWrite = documentWrites[documentWrites.length - 1];
    const confirmedDocument = confirmedWrite?.[1] as Document | undefined;
    expect(confirmedDocument).toBeDefined();
    expect(
      isDocumentCreationPending(mocks.queryClient as never, confirmedDocument!),
    ).toBe(false);
    expect(
      isDocumentCreationConfirmed(
        mocks.queryClient as never,
        confirmedDocument!,
      ),
    ).toBe(true);
    expect(
      readDocumentCreateIntents({
        accountId: "writer@example.test",
        orgId: "org",
      }),
    ).toEqual([]);
  });

  it("removes an optimistic list when no prior list snapshot existed", async () => {
    mocks.getQueryData.mockReturnValue(undefined);
    mocks.createDocument.mockRejectedValue(new Error("create failed"));

    let createPage!: () => Promise<string>;
    function Probe() {
      createPage = useCreatePage({ navigate: false });
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
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
