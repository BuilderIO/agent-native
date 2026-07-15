import type {
  BuilderCmsModelSummary,
  ContentDatabaseResponse,
} from "@shared/api";
// @vitest-environment happy-dom
//
// Narrow regression test for the create-row and Builder-attach error toasts
// added on top of DatabaseView's `createRow` and the source Attach handler.
// Both used to swallow mutation rejections silently; they now show
// `toast.error(...)`. This test mounts the real, unmodified `DatabaseView`
// (the smallest exported surface that contains both handlers — the inner
// `DatabaseTable`/`DatabaseSettingsSourcePanel` components are not exported)
// with every hook mocked to keep the database "empty" (no items, no
// properties, no attached source) so none of the heavier row/property
// subtrees mount. It only exercises two flows:
//   1. Clicking "New" when `addItem.mutateAsync` rejects.
//   2. Drilling into Settings -> Sources -> Builder -> a space -> a model and
//      clicking "Attach" when `attachSource.mutateAsync` rejects, and
//      confirming the success-only `onNavReplace([])` did not also run (the
//      model leaf must still be showing, not the Sources root).
import type { QueryClient as QueryClientType } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastErrorMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const contentDatabaseQueryMock = vi.hoisted(() => vi.fn());

vi.mock("sonner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sonner")>();
  return {
    ...actual,
    toast: {
      ...actual.toast,
      error: toastErrorMock,
      success: toastSuccessMock,
    },
  };
});

// A single shared, stable stub for every mutation/query hook this render path
// touches but that neither test drives or asserts on. Reusing one object
// (rather than a fresh object per call) keeps its identity stable across
// re-renders so effects/memos that depend on it don't refire or loop.
const benignMutation = vi.hoisted(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue(undefined),
  isPending: false,
}));

const addItemMutation = vi.hoisted(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  isPending: false,
}));

const attachSourceMutation = vi.hoisted(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  isPending: false,
}));

const builderModel = vi.hoisted<BuilderCmsModelSummary>(() => ({
  id: "model-1",
  name: "article",
  displayName: "Article",
  kind: "data",
  fields: [],
}));

const builderCmsModelsQuery = vi.hoisted(() => ({
  data: { state: "live", models: [builderModel], fetchedAt: "", message: null },
  isLoading: false,
  isFetching: false,
  refetch: vi.fn(),
}));

// `@agent-native/core/client` is a large shared package (VisualEditor.tsx
// alone pulls in several Tiptap-extension exports at module scope). Mock only
// the hooks this render path actually needs to behave specially and keep
// everything else real via `importOriginal` so we don't have to hand-roll
// every export the transitive import graph happens to use.
vi.mock("@agent-native/core/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/client")>();
  return {
    ...actual,
    // Real `useT` needs a react-i18next provider we don't set up here.
    useT: () => (key: string) => key,
    useCodeMode: () => ({
      isCodeMode: false,
      canToggle: false,
      isLoading: false,
      setCodeMode: vi.fn(),
    }),
    useBuilderStatus: () => ({
      status: {
        configured: true,
        builderEnabled: true,
        connectUrl: "",
        appHost: "",
        apiHost: "",
        publicKeyConfigured: true,
        privateKeyConfigured: true,
        orgName: "Test Org",
        spaces: [{ id: "space-1", name: "Test Space" }],
      },
      loading: false,
      error: null,
      stale: false,
      refetch: vi.fn(),
    }),
    useBuilderConnectFlow: () => ({
      configured: true,
      envManaged: false,
      builderEnabled: true,
      orgName: "Test Org",
      connecting: false,
      error: null,
      hasFetchedStatus: true,
      start: vi.fn(),
    }),
  };
});

vi.mock("@/hooks/use-content-database", () => ({
  isContentDatabaseUnavailable: () => false,
  useContentDatabase: (documentId: string, limit: number) => {
    contentDatabaseQueryMock(documentId, limit);
    return {
      data: databaseResponse,
      isLoading: false,
      isFetching: limit !== databasePagination.limit,
    };
  },
  useAddDatabaseItem: () => addItemMutation,
  useAttachContentDatabaseSource: () => attachSourceMutation,
  useChangeContentDatabaseSourceRole: () => benignMutation,
  useRefreshContentDatabaseSource: () => benignMutation,
  useDisconnectContentDatabaseSource: () => benignMutation,
  useProcessBuilderBodyHydration: () => benignMutation,
  usePrepareBuilderSourceReview: () => benignMutation,
  usePreviewBuilderSourceReview: () => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useExecuteBuilderSourceExecution: () => benignMutation,
  useCancelPreparedBuilderSourceUpdate: () => benignMutation,
  useSetContentDatabaseSourceWriteMode: () => benignMutation,
  useContentDatabasePersonalView: () => ({ data: undefined, isLoading: false }),
  useUpdateContentDatabasePersonalView: () => benignMutation,
  useUpdateContentDatabaseView: () => benignMutation,
  useDeleteDatabaseItems: () => benignMutation,
  useDuplicateDatabaseItems: () => benignMutation,
  useMoveDatabaseItem: () => benignMutation,
  useBuilderCmsModels: () => builderCmsModelsQuery,
}));

vi.mock("@/hooks/use-document-properties", () => ({
  useSetDocumentProperty: () => benignMutation,
  useConfigureDocumentProperty: () => benignMutation,
}));

vi.mock("@/hooks/use-documents", () => ({
  useDocument: () => ({ data: fakeDocument }),
  seedDatabaseItemDocumentCaches: vi.fn(),
  useDeleteDocument: () => benignMutation,
  useUpdateDocument: () => benignMutation,
}));

import { messagesByLocale } from "@/i18n-data";

import { DatabaseView, defaultDatabaseViewConfig } from "./DatabaseView";

const databaseViewConfig = defaultDatabaseViewConfig();

const databasePagination: NonNullable<ContentDatabaseResponse["pagination"]> = {
  offset: 0,
  limit: 100,
  totalItems: 0,
  returnedItems: 0,
  hasMore: false,
};

const databaseResponse: ContentDatabaseResponse = {
  database: {
    id: "database-1",
    documentId: "document-1",
    title: "Test database",
    viewConfig: databaseViewConfig,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  properties: [],
  items: [],
  source: null,
  sources: [],
  pagination: databasePagination,
};

const fakeDocument = {
  id: "document-1",
  parentId: null,
  title: "Test database",
  content: "",
  icon: null,
  position: 0,
  isFavorite: false,
  hideFromSearch: false,
  database: databaseResponse.database,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const failedToCreateRow = messagesByLocale["en-US"].database.failedToCreateRow;
const failedToAttachSource =
  messagesByLocale["en-US"].database.failedToAttachSource;

// `DatabaseSettingsRow` renders a label plus an optional trailing value in a
// second `<span>` right next to it with no separator (e.g. "Sources" +
// "None" both land in the button's textContent as "SourcesNone"), so fall
// back to a prefix match for those rows once an exact match comes up empty.
function findButtonByText(container: HTMLElement, text: string) {
  const buttons = [...container.querySelectorAll("button")];
  return (
    buttons.find((button) => button.textContent?.trim() === text) ??
    buttons.find((button) => button.textContent?.trim().startsWith(text))
  );
}

describe("DatabaseView error toasts", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClientType;

  beforeEach(async () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
    contentDatabaseQueryMock.mockReset();
    addItemMutation.mutateAsync.mockReset();
    attachSourceMutation.mutateAsync.mockReset();
    databasePagination.totalItems = 0;
    databasePagination.hasMore = false;

    // DatabaseTable fire-and-forgets a `fetch(...).catch(() => {})` navigation
    // state PUT on every relevant render; stub it out so the test doesn't make
    // a real network call (and doesn't print connection-refused noise).
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
    );

    const { QueryClient } = await import("@tanstack/react-query");
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  async function renderDatabaseView() {
    const { QueryClientProvider } = await import("@tanstack/react-query");
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <DatabaseView
              databaseId="database-1"
              databaseDocumentId="document-1"
            />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
  }

  it("shows a toast and does not create a row when addItem.mutateAsync rejects", async () => {
    addItemMutation.mutateAsync.mockRejectedValue(new Error("network down"));
    await renderDatabaseView();

    const newButton = findButtonByText(container, "New");
    expect(newButton).toBeTruthy();

    await act(async () => {
      newButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      // Flush the rejected mutateAsync + catch handler.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(addItemMutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledWith(
      failedToCreateRow,
      expect.objectContaining({ description: "network down" }),
    );
  });

  it("requests the whole bounded search window and hides the partial no-match state", async () => {
    databasePagination.totalItems = 571;
    databasePagination.hasMore = true;
    await renderDatabaseView();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Search"]')
        ?.click();
    });
    const searchInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Search"]',
    );
    expect(searchInput).toBeTruthy();

    await act(async () => {
      if (!searchInput) return;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(searchInput, "Quiet Comet");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(contentDatabaseQueryMock).toHaveBeenCalledWith("document-1", 571);
    expect(container.textContent).toContain(
      messagesByLocale["en-US"].database.loadingDatabase,
    );
    expect(container.textContent).not.toContain(
      messagesByLocale["en-US"].database.noRowsMatchThisView,
    );
  });

  it("shows a toast and stays on the model leaf when the Builder attach rejects", async () => {
    attachSourceMutation.mutateAsync.mockRejectedValue(
      new Error("attach failed"),
    );
    await renderDatabaseView();

    const settingsButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Database settings"]',
    );
    expect(settingsButton).toBeTruthy();
    await act(async () => {
      settingsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const sourcesRow = findButtonByText(container, "Sources");
    expect(sourcesRow).toBeTruthy();
    await act(async () => {
      sourcesRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const builderRow = findButtonByText(container, "Builder");
    expect(builderRow).toBeTruthy();
    await act(async () => {
      builderRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const spaceRow = findButtonByText(container, "Test Space");
    expect(spaceRow).toBeTruthy();
    await act(async () => {
      spaceRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const modelRow = findButtonByText(container, "Article");
    expect(modelRow).toBeTruthy();
    await act(async () => {
      modelRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const attachButton = findButtonByText(container, "Attach");
    expect(attachButton).toBeTruthy();

    await act(async () => {
      attachButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(attachSourceMutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledWith(
      failedToAttachSource,
      expect.objectContaining({ description: "attach failed" }),
    );

    // The success-only follow-up (`onNavReplace([])`) must not have run: the
    // nav stack should still be on the model leaf (its Attach button and the
    // model's display name are still showing), not reset back to the Sources
    // root.
    expect(findButtonByText(container, "Attach")).toBeTruthy();
    expect(container.textContent).toContain("Article");
  });
});
