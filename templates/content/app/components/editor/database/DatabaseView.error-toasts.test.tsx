import type {
  BuilderCmsModelSummary,
  ContentDatabasePersonalViewResponse,
  ContentDatabaseResponse,
} from "@shared/api";
import { CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION } from "@shared/api";
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
const keepaliveActionMock = vi.hoisted(() => vi.fn());
const personalViewQuery = vi.hoisted<{
  data: ContentDatabasePersonalViewResponse | undefined;
  isLoading: boolean;
}>(() => ({ data: undefined, isLoading: false }));
const personalViewMutation = vi.hoisted(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue(undefined),
  isPending: false,
}));
const updateViewMutation = vi.hoisted(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue(undefined),
  isPending: false,
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/client/hooks")>();
  return {
    ...actual,
    tryCallActionKeepalive: keepaliveActionMock,
  };
});

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
  useContentDatabasePersonalView: () => personalViewQuery,
  useUpdateContentDatabasePersonalView: () => personalViewMutation,
  useUpdateContentDatabaseView: () => updateViewMutation,
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
    keepaliveActionMock.mockReset();
    keepaliveActionMock.mockReturnValue({
      accepted: true,
      bodyBytes: 1,
      completion: Promise.resolve({
        databaseId: "database-1",
        overrides: null,
      }),
    });
    personalViewQuery.data = undefined;
    personalViewQuery.isLoading = false;
    personalViewMutation.isPending = false;
    personalViewMutation.mutate.mockReset();
    updateViewMutation.mutate.mockReset();
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
    vi.useRealTimers();
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
    const sortPickerInput =
      document.querySelector<HTMLInputElement>("[role=menu] input");
    expect(sortPickerInput).toBeTruthy();

    await act(async () => {
      sortPickerInput?.focus();
      sortPickerInput?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
      await Promise.resolve();
    });

    expect(sortButton?.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(sortButton);

    await act(async () => {
      filterButton?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
      await Promise.resolve();
    });

    expect(filterButton?.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector("[role=menu]")).toBeTruthy();

    const filterPickerInput =
      document.querySelector<HTMLInputElement>("[role=menu] input");
    expect(filterPickerInput).toBeTruthy();
    await act(async () => {
      filterPickerInput?.focus();
      filterPickerInput?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
      await Promise.resolve();
    });

    expect(filterButton?.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(filterButton);
  });

  it("does not expose shared database state before personal overrides hydrate", async () => {
    personalViewQuery.isLoading = true;
    await renderDatabaseView();

    expect(container.querySelector('button[aria-label="Filter"]')).toBeNull();

    personalViewQuery.data = {
      databaseId: "database-1",
      overrides: {
        version: CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION,
        activeViewId: databaseViewConfig.activeViewId,
        views: databaseViewConfig.views.map((view) => ({
          id: view.id,
          sorts: [],
          filters:
            view.id === databaseViewConfig.activeViewId
              ? [
                  {
                    key: "name",
                    label: "Name",
                    operator: "contains" as const,
                    value: "Personal only",
                  },
                ]
              : [],
          filterMode: "and" as const,
        })),
      },
    };
    personalViewQuery.isLoading = false;
    await renderDatabaseView();
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('button[aria-label="1 active filters"]'),
    ).toBeTruthy();
    expect(personalViewMutation.mutate).not.toHaveBeenCalled();
    expect(updateViewMutation.mutate).not.toHaveBeenCalled();
  });

  it("opens both toolbar menus with Enter, Space, and ArrowDown", async () => {
    await renderDatabaseView();

    for (const label of ["Sort", "Filter"]) {
      for (const key of ["Enter", " ", "ArrowDown"]) {
        const button = container.querySelector<HTMLButtonElement>(
          `button[aria-label="${label}"]`,
        );
        expect(button).toBeTruthy();

        await act(async () => {
          button?.focus();
          button?.dispatchEvent(
            new KeyboardEvent("keydown", { bubbles: true, key }),
          );
          await Promise.resolve();
        });

        expect(button?.getAttribute("aria-expanded")).toBe("true");
        const pickerInput =
          document.querySelector<HTMLInputElement>("[role=menu] input");
        expect(pickerInput).toBeTruthy();
        await act(async () => {
          pickerInput?.focus();
          pickerInput?.dispatchEvent(
            new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
          );
          await Promise.resolve();
        });

        expect(button?.getAttribute("aria-expanded")).toBe("false");
        expect(document.activeElement).toBe(button);
      }
    }
  });

  it("persists exactly one personal override after filter selection", async () => {
    vi.useFakeTimers();
    await renderDatabaseView();
    const filterButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Filter"]',
    );

    await act(async () => {
      filterButton?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
      await Promise.resolve();
    });
    const nameItem = [
      ...document.querySelectorAll<HTMLElement>("[role=menuitem]"),
    ].find((item) => item.textContent?.trim() === "Name");
    expect(nameItem).toBeTruthy();

    await act(async () => {
      nameItem?.click();
      await Promise.resolve();
    });
    await renderDatabaseView();
    const filterValueInput = document.querySelector<HTMLInputElement>(
      'input[placeholder="Value"]',
    );
    expect(filterValueInput).toBeTruthy();
    await act(async () => {
      if (!filterValueInput) return;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(filterValueInput, "Personal only");
      filterValueInput.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    personalViewQuery.data = {
      databaseId: "database-1",
      overrides: {
        version: CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION,
        activeViewId: databaseViewConfig.activeViewId,
        views: databaseViewConfig.views.map((view) => ({
          id: view.id,
          sorts: [],
          filters: [],
          filterMode: "and" as const,
        })),
      },
    };
    await renderDatabaseView();

    expect(
      container.querySelector('button[aria-label="1 active filters"]'),
    ).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    expect(personalViewMutation.mutate).toHaveBeenCalledTimes(1);
    expect(personalViewMutation.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseId: "database-1",
        overrides: expect.objectContaining({
          activeViewId: databaseViewConfig.activeViewId,
          views: expect.arrayContaining([
            expect.objectContaining({
              id: databaseViewConfig.activeViewId,
              filters: [
                expect.objectContaining({
                  key: "name",
                  value: "Personal only",
                }),
              ],
            }),
          ]),
        }),
      }),
      expect.any(Object),
    );
    expect(keepaliveActionMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("protects a pending personal override during reload with one keepalive", async () => {
    vi.useFakeTimers();
    await renderDatabaseView();
    const filterButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Filter"]',
    );

    await act(async () => {
      filterButton?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
      await Promise.resolve();
    });
    const nameItem = [
      ...document.querySelectorAll<HTMLElement>("[role=menuitem]"),
    ].find((item) => item.textContent?.trim() === "Name");
    expect(nameItem).toBeTruthy();

    await act(async () => {
      nameItem?.click();
      await Promise.resolve();
    });
    window.dispatchEvent(new Event("pagehide"));

    expect(keepaliveActionMock).toHaveBeenCalledTimes(1);
    expect(keepaliveActionMock).toHaveBeenCalledWith(
      "update-content-database-personal-view",
      expect.objectContaining({ databaseId: "database-1" }),
    );
    expect(personalViewMutation.mutate).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    expect(personalViewMutation.mutate).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("serializes a newer personal override behind an active save", async () => {
    vi.useFakeTimers();
    personalViewMutation.isPending = true;
    await renderDatabaseView();
    const filterButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Filter"]',
    );

    await act(async () => {
      filterButton?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
      await Promise.resolve();
    });
    const nameItem = [
      ...document.querySelectorAll<HTMLElement>("[role=menuitem]"),
    ].find((item) => item.textContent?.trim() === "Name");
    expect(nameItem).toBeTruthy();

    await act(async () => {
      nameItem?.click();
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(personalViewMutation.mutate).not.toHaveBeenCalled();

    personalViewMutation.isPending = false;
    await renderDatabaseView();
    await act(async () => {
      vi.advanceTimersByTime(50);
      await Promise.resolve();
    });

    expect(personalViewMutation.mutate).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
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
