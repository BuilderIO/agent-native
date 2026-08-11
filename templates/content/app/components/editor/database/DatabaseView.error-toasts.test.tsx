import type {
  BuilderCmsModelSummary,
  ContentDatabaseItem,
  ContentDatabaseResponse,
  ContentDatabaseSource,
  ContentDatabaseTableQuery,
} from "@shared/api";
// @vitest-environment happy-dom
//
// Mount the real DatabaseView with an empty mocked database so UI regressions
// can cover its composed controls and mutation error paths without heavier row
// and property subtrees.
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

const changeSourceRoleMutation = vi.hoisted(() => ({
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

const secondBuilderModel = vi.hoisted<BuilderCmsModelSummary>(() => ({
  id: "model-2",
  name: "author",
  displayName: "Author model",
  kind: "data",
  fields: [],
}));

const builderCmsModelsQuery = vi.hoisted(() => ({
  data: {
    state: "live",
    models: [builderModel, secondBuilderModel],
    fetchedAt: "",
    message: null,
  },
  isLoading: false,
  isFetching: false,
  refetch: vi.fn(),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  useCodeMode: () => ({
    isCodeMode: false,
    canToggle: false,
    isLoading: false,
    setCodeMode: vi.fn(),
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/settings", () => ({
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
}));

vi.mock("@/hooks/use-content-database", () => ({
  isContentDatabaseUnavailable: () => false,
  useContentDatabase: (
    documentId: string,
    limit: number,
    tableQuery?: ContentDatabaseTableQuery,
  ) => {
    contentDatabaseQueryMock(documentId, limit, tableQuery);
    return {
      data: databaseResponse,
      isLoading: false,
      isFetching: limit !== databasePagination.limit || Boolean(tableQuery),
    };
  },
  useAddDatabaseItem: () => addItemMutation,
  useAddContentDatabaseSourceFieldProperty: () => benignMutation,
  useAttachContentDatabaseSource: () => attachSourceMutation,
  useBuilderCmsAttachPreview: () => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  writeBuilderAttachPreviewToCache: vi.fn(),
  useChangeContentDatabaseSourceRole: () => changeSourceRoleMutation,
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
  useRemoveDatabaseItems: () => benignMutation,
  useDuplicateDatabaseItem: () => benignMutation,
  useDuplicateDatabaseItems: () => benignMutation,
  useMoveDatabaseItem: () => benignMutation,
  useBuilderCmsModels: () => builderCmsModelsQuery,
  useMaterializeBuilderRequiredFields: () => benignMutation,
  useSuggestSourceJoinKey: () => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-document-properties", () => ({
  useSetDocumentProperty: () => benignMutation,
  useConfigureDocumentProperty: () => benignMutation,
}));

vi.mock("@/hooks/use-content-spaces", () => ({
  useContentSpaces: () => ({
    data: { spaces: [] },
    isLoading: false,
  }),
  useDeleteContentSpace: () => benignMutation,
}));

vi.mock("@/hooks/use-documents", () => ({
  useDocument: () => ({ data: fakeDocument }),
  seedDatabaseItemDocumentCaches: vi.fn(),
  useDeleteDocument: () => benignMutation,
  useUpdateDocument: () => benignMutation,
}));

import { AppToolkitProvider } from "@/components/ui/toolkit-provider";
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
    systemRole: null,
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
  canEdit: true,
  canManage: true,
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

describe("DatabaseView UI regressions", () => {
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
    changeSourceRoleMutation.mutateAsync
      .mockReset()
      .mockResolvedValue(databaseResponse);
    benignMutation.mutateAsync.mockReset().mockResolvedValue(undefined);
    databaseResponse.items = [];
    databaseResponse.properties = [];
    databaseResponse.source = null;
    databaseResponse.sources = [];
    databaseResponse.database.viewConfig = defaultDatabaseViewConfig();
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
          <AppToolkitProvider>
            <MemoryRouter>
              <DatabaseView
                databaseId="database-1"
                databaseDocumentId="document-1"
              />
            </MemoryRouter>
          </AppToolkitProvider>
        </QueryClientProvider>,
      );
    });
  }

  it("opens the main toolbar Sort and Filter menus with pointer and keyboard activation", async () => {
    await renderDatabaseView();

    const sortButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Sort"]',
    );
    const filterButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Filter"]',
    );
    expect(sortButton).toBeTruthy();
    expect(filterButton).toBeTruthy();
    expect(sortButton?.getAttribute("aria-haspopup")).toBe("menu");
    expect(filterButton?.getAttribute("aria-haspopup")).toBe("menu");

    await act(async () => {
      sortButton?.focus();
      sortButton?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
      await Promise.resolve();
    });

    expect(sortButton?.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector("[role=menu]")).toBeTruthy();

    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
      await Promise.resolve();
    });

    expect(sortButton?.getAttribute("aria-expanded")).toBe("false");

    await act(async () => {
      filterButton?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
      await Promise.resolve();
    });

    expect(filterButton?.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector("[role=menu]")).toBeTruthy();
  });

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

  it("keeps search page-bounded and hides the partial no-match state", async () => {
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

    expect(contentDatabaseQueryMock).toHaveBeenCalledWith(
      "document-1",
      100,
      expect.objectContaining({ search: "Quiet Comet" }),
    );
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

  it("shows a toast and keeps the source picker retryable when adding another item source fails", async () => {
    const connectedSource = {
      id: "source-1",
      databaseId: "database-1",
      sourceType: "builder-cms",
      sourceName: "Existing articles",
      sourceTable: "existing-article",
      syncState: "idle",
      freshness: "fresh",
      lastRefreshedAt: null,
      lastSourceUpdatedAt: null,
      lastError: null,
      capabilities: {
        canRefresh: true,
        canCreateChangeSets: false,
        canWriteFields: false,
        canWriteBody: false,
        canPush: false,
        canPull: true,
        canPublish: false,
        canDelete: false,
        canStageLocalRevision: false,
        liveWritesEnabled: false,
        readOnlyRefresh: true,
      },
      metadata: { primaryKey: "id", titleField: "title" },
      fields: [],
      rows: [],
      changeSets: [],
    } as ContentDatabaseSource;
    databaseResponse.source = connectedSource;
    databaseResponse.sources = [connectedSource];
    attachSourceMutation.mutateAsync.mockRejectedValue(
      new Error("second attach failed"),
    );
    await renderDatabaseView();

    await act(async () => {
      findButtonByText(container, "Add property")?.click();
    });
    await act(async () => {
      findButtonByText(
        document.body,
        "editor.properties.connectASource",
      )?.click();
    });
    await act(async () => {
      findButtonByText(container, "Builder")?.click();
    });
    await act(async () => {
      findButtonByText(container, "Test Space")?.click();
    });
    await act(async () => {
      findButtonByText(container, "Article")?.click();
    });
    await act(async () => {
      findButtonByText(
        container,
        messagesByLocale["en-US"].database.addMoreItemsToThisList,
      )?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(attachSourceMutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledWith(
      failedToAttachSource,
      expect.objectContaining({ description: "second attach failed" }),
    );
    expect(container.textContent).toContain("Article");
    expect(
      document.body.querySelector(
        'input[aria-label="editor.properties.searchPropertyTypes"]',
      ),
    ).toBeNull();
  });

  it("opens Sources from Add property and keeps Add property closed when canceled", async () => {
    await renderDatabaseView();

    await act(async () => {
      findButtonByText(container, "Add property")?.click();
    });
    const connectSource = findButtonByText(
      document.body,
      "editor.properties.connectASource",
    );
    expect(connectSource).toBeTruthy();

    await act(async () => {
      connectSource?.click();
    });
    expect(container.textContent).toContain("Sources");
    expect(
      document.body.querySelector(
        'input[aria-label="editor.properties.searchPropertyTypes"]',
      ),
    ).toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          `[aria-label="${messagesByLocale["en-US"].database.closeDatabaseSettings}"]`,
        )
        ?.click();
    });
    expect(container.textContent).not.toContain("Connected sources");
    expect(
      document.body.querySelector(
        'input[aria-label="editor.properties.searchPropertyTypes"]',
      ),
    ).toBeNull();
  });

  it("opens Sources with Enter when Connect a source is the only search result", async () => {
    await renderDatabaseView();

    await act(async () => {
      findButtonByText(container, "Add property")?.click();
    });
    const searchInput = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="editor.properties.searchPropertyTypes"]',
    );
    expect(searchInput).toBeTruthy();

    await act(async () => {
      if (!searchInput) return;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(searchInput, "source");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      searchInput.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Sources");
    expect(
      document.body.querySelector(
        'input[aria-label="editor.properties.searchPropertyTypes"]',
      ),
    ).toBeNull();
  });

  it.each(["calendar", "board", "timeline"] as const)(
    "offers the source handoff from the %s view Add property entry",
    async (viewType) => {
      const viewConfig = defaultDatabaseViewConfig();
      viewConfig.views[0] = { ...viewConfig.views[0], type: viewType };
      databaseResponse.database.viewConfig = viewConfig;
      attachSourceMutation.mutateAsync.mockResolvedValue(databaseResponse);
      await renderDatabaseView();

      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label="editor.properties.addProperty"]',
          )
          ?.click();
      });
      await act(async () => {
        findButtonByText(
          document.body,
          "editor.properties.connectASource",
        )?.click();
      });

      expect(container.textContent).toContain("Sources");
      await act(async () => {
        findButtonByText(container, "Builder")?.click();
      });
      await act(async () => {
        findButtonByText(container, "Test Space")?.click();
      });
      await act(async () => {
        findButtonByText(container, "Article")?.click();
      });
      await act(async () => {
        findButtonByText(container, "Attach")?.click();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(
        document.body.querySelector(
          'input[aria-label="editor.properties.searchPropertyTypes"]',
        ),
      ).toBeTruthy();
    },
  );

  it("clears the Add property handoff when backing out of Sources", async () => {
    attachSourceMutation.mutateAsync.mockResolvedValue(databaseResponse);
    await renderDatabaseView();

    await act(async () => {
      findButtonByText(container, "Add property")?.click();
    });
    await act(async () => {
      findButtonByText(
        document.body,
        "editor.properties.connectASource",
      )?.click();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Back"]')
        ?.click();
    });

    await act(async () => {
      findButtonByText(container, "Sources")?.click();
    });
    await act(async () => {
      findButtonByText(container, "Builder")?.click();
    });
    await act(async () => {
      findButtonByText(container, "Test Space")?.click();
    });
    await act(async () => {
      findButtonByText(container, "Article")?.click();
    });
    await act(async () => {
      findButtonByText(container, "Attach")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(attachSourceMutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(
      document.body.querySelector(
        'input[aria-label="editor.properties.searchPropertyTypes"]',
      ),
    ).toBeNull();
  });

  it("returns from each successful source connection with Add property reopened", async () => {
    const connectedSource: ContentDatabaseSource = {
      id: "source-1",
      databaseId: "database-1",
      sourceType: "builder-cms",
      sourceName: "Articles",
      sourceTable: "article",
      syncState: "idle",
      freshness: "fresh",
      lastRefreshedAt: null,
      lastSourceUpdatedAt: null,
      lastError: null,
      capabilities: {
        canRefresh: true,
        canCreateChangeSets: false,
        canWriteFields: false,
        canWriteBody: false,
        canPush: false,
        canPull: true,
        canPublish: false,
        canDelete: false,
        canStageLocalRevision: false,
        liveWritesEnabled: false,
        readOnlyRefresh: true,
      },
      metadata: { primaryKey: "id", titleField: "title" },
      fields: [
        {
          id: "source-field-author",
          propertyId: null,
          propertyName: null,
          localFieldKey: "property:author",
          sourceFieldKey: "data.author",
          sourceFieldLabel: "Author",
          sourceFieldType: "text",
          mappingType: "property",
          writeOwner: "source",
          readOnly: true,
          provenance: "builder-cms:article",
          freshness: "fresh",
          lastSyncedAt: null,
        },
      ],
      rows: [],
      changeSets: [],
    };
    attachSourceMutation.mutateAsync.mockImplementation(async () => {
      databaseResponse.source = connectedSource;
      databaseResponse.sources = [connectedSource];
      return databaseResponse;
    });
    await renderDatabaseView();

    await act(async () => {
      findButtonByText(container, "Add property")?.click();
    });
    await act(async () => {
      findButtonByText(
        document.body,
        "editor.properties.connectASource",
      )?.click();
    });
    await act(async () => {
      findButtonByText(container, "Builder")?.click();
    });
    await act(async () => {
      findButtonByText(container, "Test Space")?.click();
    });
    await act(async () => {
      findButtonByText(container, "Article")?.click();
    });

    await act(async () => {
      findButtonByText(container, "Attach")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(attachSourceMutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(
      document.body.querySelector(
        'input[aria-label="editor.properties.searchPropertyTypes"]',
      ),
    ).toBeTruthy();
    expect(document.body.textContent).toContain("editor.properties.fromSource");
    expect(document.body.textContent).toContain("Author");
    expect(container.textContent).not.toContain("Connected sources");

    await act(async () => {
      findButtonByText(
        document.body,
        "editor.properties.connectASource",
      )?.click();
    });
    await act(async () => {
      findButtonByText(container, "Builder")?.click();
    });
    await act(async () => {
      findButtonByText(container, "Test Space")?.click();
    });
    await act(async () => {
      findButtonByText(container, "Author model")?.click();
    });
    await act(async () => {
      findButtonByText(
        container,
        messagesByLocale["en-US"].database.addMoreItemsToThisList,
      )?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(attachSourceMutation.mutateAsync).toHaveBeenCalledTimes(2);
    expect(
      document.body.querySelector(
        'input[aria-label="editor.properties.searchPropertyTypes"]',
      ),
    ).toBeTruthy();
  });

  it("returns to Add property after changing an attached source role", async () => {
    const secondarySource = {
      id: "source-2",
      databaseId: "database-1",
      sourceType: "builder-cms",
      sourceName: "Authors",
      sourceTable: "author",
      syncState: "idle",
      freshness: "fresh",
      lastRefreshedAt: null,
      lastSourceUpdatedAt: null,
      lastError: null,
      capabilities: {
        canRefresh: true,
        canCreateChangeSets: false,
        canWriteFields: false,
        canWriteBody: false,
        canPush: false,
        canPull: true,
        canPublish: false,
        canDelete: false,
        canStageLocalRevision: false,
        liveWritesEnabled: false,
        readOnlyRefresh: true,
      },
      metadata: {
        primaryKey: "id",
        titleField: "name",
        federation: {
          role: "secondary",
          keyField: "name",
          normalizationFormula: "lower(trim(value))",
          join: {
            kind: "identity",
            collection: null,
            localExpr: "{canonical}",
            remoteKeyField: "name",
            normalizationFormula: "lower(trim(value))",
          },
          canonicalKey: { propertyId: null, label: "Author", type: "text" },
        },
      },
      fields: [],
      rows: [],
      changeSets: [],
    } as ContentDatabaseSource;
    databaseResponse.sources = [secondarySource];
    changeSourceRoleMutation.mutateAsync.mockRejectedValueOnce(
      new Error("role change failed"),
    );
    await renderDatabaseView();

    await act(async () => {
      findButtonByText(container, "Add property")?.click();
    });
    await act(async () => {
      findButtonByText(
        document.body,
        "editor.properties.connectASource",
      )?.click();
    });
    await act(async () => {
      findButtonByText(container, "Authors")?.click();
    });
    await act(async () => {
      findButtonByText(
        container,
        messagesByLocale["en-US"].database.addAsItems,
      )?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toastErrorMock).toHaveBeenCalledWith(
      failedToAttachSource,
      expect.objectContaining({ description: "role change failed" }),
    );
    expect(container.textContent).toContain("Authors");
    expect(
      document.body.querySelector(
        'input[aria-label="editor.properties.searchPropertyTypes"]',
      ),
    ).toBeNull();

    changeSourceRoleMutation.mutateAsync.mockResolvedValue(databaseResponse);
    await act(async () => {
      findButtonByText(
        container,
        messagesByLocale["en-US"].database.addAsItems,
      )?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(changeSourceRoleMutation.mutateAsync).toHaveBeenCalledWith({
      documentId: "document-1",
      sourceId: "source-2",
      relationshipMode: "items",
      join: undefined,
    });
    expect(
      document.body.querySelector(
        'input[aria-label="editor.properties.searchPropertyTypes"]',
      ),
    ).toBeTruthy();
    expect(container.textContent).not.toContain("Connected sources");
  });

  it("removes the confirmed selection snapshot without clearing newer selections", async () => {
    const row = (id: string, title: string): ContentDatabaseItem => ({
      id: `item-${id}`,
      databaseId: "database-1",
      document: {
        id: `document-${id}`,
        parentId: "document-1",
        title,
        content: "",
        icon: null,
        position: 0,
        isFavorite: false,
        hideFromSearch: false,
        accessRole: "viewer",
        canView: true,
        canEdit: false,
        canManage: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      position: 0,
      properties: [],
      bodyHydration: {
        status: "hydrated",
        attemptedAt: null,
        error: null,
        version: null,
      },
    });
    databaseResponse.items = [row("a", "Alpha"), row("b", "Beta")];
    await renderDatabaseView();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Select Alpha"]')
        ?.click();
    });
    await act(async () => {
      findButtonByText(container, "Remove")?.click();
    });
    expect(document.querySelector('[role="alertdialog"]')).toBeTruthy();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Select Beta"]')
        ?.click();
    });
    const confirmRemove = [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[role="alertdialog"] button',
      ),
    ].find((button) => button.textContent?.trim() === "Remove");
    expect(confirmRemove).toBeTruthy();

    await act(async () => {
      confirmRemove?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(benignMutation.mutateAsync).toHaveBeenCalledWith({
      documentId: "document-1",
      itemIds: ["item-a"],
    });
    expect(container.textContent).toContain("1 selected");
    expect(
      container.querySelector<HTMLButtonElement>(
        '[aria-label="Deselect Beta"]',
      ),
    ).toBeTruthy();
  });
});
