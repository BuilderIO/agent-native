// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import type {
  ContentDatabaseItem,
  ContentDatabaseNavigationItem,
  ContentDatabaseNavigationPageResponse,
  Document,
} from "@shared/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { SidebarRowsHint } from "@/lib/sidebar-layout-hint";

const useFilesNavigationPage = vi.hoisted(() => vi.fn());

vi.mock("@/lib/files-navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/files-navigation")>()),
  useFilesNavigationPage,
}));

import {
  navigationItemAsDatabaseItem,
  PagedContentFilesSidebarView,
} from "./sidebar";

function navigationItem(
  id: string,
  parentId: string | null = null,
  hasChildren = false,
): ContentDatabaseNavigationItem {
  return {
    membershipId: `membership-${id}`,
    membershipPosition: Number(id.replace(/\D/g, "")) || 0,
    documentId: id,
    parentId,
    title: `Page ${id}`,
    icon: null,
    type: "page",
    hasChildren,
    spaceId: "space",
    sourceKind: null,
    isFavorite: false,
    canEdit: true,
    canManage: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function page(
  items: ContentDatabaseNavigationItem[],
  nextCursor: string | null = null,
): ContentDatabaseNavigationPageResponse {
  return {
    items,
    pagination: {
      limit: 20,
      hasMore: nextCursor !== null,
      nextCursor,
    },
  };
}

function Harness({
  activeDocumentId,
  activePathDocuments,
  onDeleteItem,
  onToggleFavorite,
  initiallyExpanded = [],
  branchPlaceholders,
  onBranchShown,
}: {
  activeDocumentId?: string;
  activePathDocuments?: Document[];
  onDeleteItem?: (item: ContentDatabaseItem) => void;
  onToggleFavorite?: (item: ContentDatabaseItem) => void;
  initiallyExpanded?: string[];
  branchPlaceholders?: Record<string, SidebarRowsHint>;
  onBranchShown?: (documentId: string, shown: SidebarRowsHint) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(initiallyExpanded),
  );
  const [queryClient] = useState(() => new QueryClient());
  return (
    <AgentNativeI18nProvider
      initialLocale="en-US"
      persistPreference={false}
      catalog={{
        sourceLocale: "en-US",
        messages: {
          sidebar: {
            expandItem: "Expand {{title}}",
            collapseItem: "Collapse {{title}}",
          },
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TooltipProvider>
            <PagedContentFilesSidebarView
              databaseId="files"
              activeDocumentId={activeDocumentId}
              expandedDocumentIds={expanded}
              onDocumentExpandedChange={(id, open) =>
                setExpanded((current) => {
                  const next = new Set(current);
                  if (open) next.add(id);
                  else next.delete(id);
                  return next;
                })
              }
              documentMetadata={new Map()}
              activePathDocuments={activePathDocuments}
              onCreateChildPage={() => {}}
              onDeleteItem={onDeleteItem}
              onToggleFavorite={onToggleFavorite}
              navigationLabel="Files"
              untitledLabel="Untitled"
              branchPlaceholders={branchPlaceholders}
              onBranchShown={onBranchShown}
            />
          </TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </AgentNativeI18nProvider>
  );
}

async function renderHarness(props: Parameters<typeof Harness>[0] = {}) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<Harness {...props} />));
  return { container, root };
}

describe("PagedContentFilesSidebarView", () => {
  beforeEach(() => {
    useFilesNavigationPage.mockReset();
  });

  it("shows 20 roots and appends the 21st through the opaque cursor", async () => {
    useFilesNavigationPage.mockImplementation((args) => ({
      data: args.navigation.cursor
        ? page([navigationItem("root-21")])
        : page(
            Array.from({ length: 20 }, (_, index) =>
              navigationItem(`root-${index + 1}`),
            ),
            "root-cursor",
          ),
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    }));
    const { container, root } = await renderHarness();

    expect(container.querySelectorAll("a")).toHaveLength(20);
    expect(container.textContent).toContain("Show more");
    const showMore = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Show more");
    expect(showMore?.style.gridTemplateColumns).toBe(
      "0px 1.75rem minmax(0, 1fr)",
    );
    expect(showMore?.className).toContain("h-7");
    expect(showMore?.className).not.toContain("min-h-[38px]");
    expect(showMore?.className).toContain("hover:bg-transparent");
    expect(showMore?.className).toContain("font-medium");
    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Show more")
        ?.click(),
    );
    expect(container.querySelectorAll("a")).toHaveLength(21);
    expect(container.textContent).toContain("Page root-21");
    expect(useFilesNavigationPage).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 20,
        navigation: expect.objectContaining({ cursor: "root-cursor" }),
      }),
      expect.any(Set),
    );
    expect(
      container.querySelector("[data-radix-scroll-area-viewport]"),
    ).toBeNull();

    await act(async () => root.unmount());
  });

  it("composes overlapping server pages into 25 unique sequential roots", async () => {
    const roots = Array.from({ length: 25 }, (_, index) =>
      navigationItem(`root-${String(index + 1).padStart(2, "0")}`),
    );
    useFilesNavigationPage.mockImplementation((args) => ({
      data: args.navigation.cursor
        ? page([...roots.slice(10, 20), ...roots.slice(20)])
        : page(roots.slice(0, 20), "root-cursor"),
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    }));
    const { container, root } = await renderHarness();

    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Show more")
        ?.click(),
    );

    const ids = Array.from(container.querySelectorAll<HTMLAnchorElement>("a"))
      .map((link) => link.getAttribute("href"))
      .filter((href): href is string => href !== null);
    expect(ids).toEqual(roots.map((item) => `/page/${item.documentId}`));
    expect(new Set(ids).size).toBe(25);
    expect(container.textContent).not.toContain("Show more");

    await act(async () => root.unmount());
  });

  it("lazy-loads 20 immediate children and uses server hasChildren", async () => {
    useFilesNavigationPage.mockImplementation((args) => {
      if (args.navigation.parentId === "root") {
        return {
          data: args.navigation.cursor
            ? page([navigationItem("child-21", "root")])
            : page(
                Array.from({ length: 20 }, (_, index) =>
                  navigationItem(`child-${index + 1}`, "root"),
                ),
                "child-cursor",
              ),
          isLoading: false,
          isError: false,
          isFetching: false,
          refetch: vi.fn(),
        };
      }
      return {
        data: page([navigationItem("root", null, true)]),
        isLoading: false,
        isError: false,
        isFetching: false,
        refetch: vi.fn(),
      };
    });
    const { container, root } = await renderHarness();

    expect(
      useFilesNavigationPage.mock.calls.every(
        ([args]) => args.navigation.parentId === null,
      ),
    ).toBe(true);
    const expand = container.querySelector<HTMLButtonElement>(
      '[aria-label="Expand Page root"]',
    );
    expect(expand).not.toBeNull();
    await act(async () => expand?.click());
    expect(useFilesNavigationPage).toHaveBeenCalledWith(
      expect.objectContaining({
        navigation: expect.objectContaining({ parentId: "root" }),
      }),
      new Set(["root"]),
    );
    expect(container.querySelectorAll('a[href^="/page/child-"]')).toHaveLength(
      20,
    );
    expect(container.textContent).toContain("Show more");
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent === "Show more",
      )?.style.gridTemplateColumns,
    ).toBe("18px 1.75rem minmax(0, 1fr)");
    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Show more")
        ?.click(),
    );
    expect(container.querySelectorAll('a[href^="/page/child-"]')).toHaveLength(
      21,
    );
    expect(container.textContent).toContain("Page child-21");

    await act(async () => root.unmount());
  });

  it("reloads a Show more page from a fresh cursor when its cursor expired", async () => {
    const roots = Array.from({ length: 20 }, (_, index) =>
      navigationItem(`root-${index + 1}`),
    );
    let issuedCursor = "expired-cursor";
    const refetchFirstPage = vi.fn(async () => {
      issuedCursor = "fresh-cursor";
      return { data: page(roots, issuedCursor) };
    });
    const expired = Object.assign(new Error("stale cursor"), {
      errorCode: "invalid_navigation_cursor",
    });
    useFilesNavigationPage.mockImplementation((args) =>
      args.navigation.cursor === "expired-cursor"
        ? {
            data: undefined,
            error: expired,
            isLoading: false,
            isError: true,
            isFetching: false,
            refetch: vi.fn(),
          }
        : {
            data: args.navigation.cursor
              ? page([navigationItem("root-21")])
              : page(roots, issuedCursor),
            isLoading: false,
            isError: false,
            isFetching: false,
            refetch: refetchFirstPage,
          },
    );
    const { container, root } = await renderHarness();

    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Show more")
        ?.click(),
    );
    expect(refetchFirstPage).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain("Retry");

    // React Query re-renders after a refetch; the mock needs a render pass.
    await act(async () => root.render(<Harness />));
    expect(container.textContent).toContain("Page root-21");
    expect(container.textContent).not.toContain("Retry");

    await act(async () => root.unmount());
  });

  it("reloads a branch automatically once, then offers Retry that reloads from the first page", async () => {
    const roots = Array.from({ length: 20 }, (_, index) =>
      navigationItem(`root-${index + 1}`),
    );
    let issued = 0;
    const refetchFirstPage = vi.fn(async () => {
      issued += 1;
      return { data: page(roots, `cursor-${issued}`) };
    });
    const refetchExpiredPage = vi.fn();
    const expired = Object.assign(new Error("stale cursor"), {
      errorCode: "invalid_navigation_cursor",
    });
    useFilesNavigationPage.mockImplementation((args) =>
      args.navigation.cursor
        ? {
            data: undefined,
            error: expired,
            isLoading: false,
            isError: true,
            isFetching: false,
            refetch: refetchExpiredPage,
          }
        : {
            data: page(roots, `cursor-${issued}`),
            isLoading: false,
            isError: false,
            isFetching: false,
            refetch: refetchFirstPage,
          },
    );
    const { container, root } = await renderHarness();

    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Show more")
        ?.click(),
    );
    expect(refetchFirstPage).toHaveBeenCalledOnce();

    // The reload issued a new cursor, and that one expires as well.
    await act(async () => root.render(<Harness />));
    expect(useFilesNavigationPage).toHaveBeenCalledWith(
      expect.objectContaining({
        navigation: expect.objectContaining({ cursor: "cursor-1" }),
      }),
      expect.any(Set),
    );
    expect(refetchFirstPage).toHaveBeenCalledOnce();
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry",
    );
    expect(retry).not.toBeUndefined();

    await act(async () => retry?.click());
    expect(refetchFirstPage).toHaveBeenCalledTimes(2);
    expect(refetchExpiredPage).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it("keeps failed pages recoverable with Retry", async () => {
    const refetch = vi.fn();
    useFilesNavigationPage.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch,
    });
    const { container, root } = await renderHarness();

    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry",
    );
    expect(retry).not.toBeUndefined();
    await act(async () => retry?.click());
    expect(refetch).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
  });

  it("enables authorized paged-row actions without active-path metadata", async () => {
    const onDeleteItem = vi.fn();
    const onToggleFavorite = vi.fn();
    useFilesNavigationPage.mockReturnValue({
      data: page([navigationItem("ordinary-row")]),
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    const { container, root } = await renderHarness({
      onDeleteItem,
      onToggleFavorite,
    });

    const menu = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="menu"]',
    );
    expect(menu).not.toBeNull();
    expect(onToggleFavorite).not.toHaveBeenCalled();
    expect(
      navigationItemAsDatabaseItem(navigationItem("ordinary-row"), undefined)
        .document.spaceId,
    ).toBe("space");

    await act(async () => root.unmount());
  });

  it("reveals an off-page active path without requesting preceding pages", async () => {
    useFilesNavigationPage.mockImplementation((args) => ({
      data:
        args.navigation.parentId === "off-page-root"
          ? page([])
          : page([navigationItem("first-root")], "next-root-page"),
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    }));
    const rootDocument = {
      id: "off-page-root",
      parentId: null,
      title: "Off-page root",
      content: "",
      icon: null,
      position: 99,
      isFavorite: false,
      hideFromSearch: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } satisfies Document;
    const activeDocument = {
      ...rootDocument,
      id: "active-child",
      parentId: rootDocument.id,
      title: "Active child",
    } satisfies Document;
    const { container, root } = await renderHarness({
      activeDocumentId: activeDocument.id,
      activePathDocuments: [rootDocument, activeDocument],
    });

    expect(container.textContent).toContain("Off-page root");
    const expand = container.querySelector<HTMLButtonElement>(
      '[aria-label="Expand Off-page root"]',
    );
    await act(async () => expand?.click());
    expect(container.textContent).toContain("Active child");
    expect(container.querySelector('[aria-current="page"]')).not.toBeNull();
    expect(
      useFilesNavigationPage.mock.calls.some(
        ([args]) => args.navigation.cursor === "next-root-page",
      ),
    ).toBe(false);

    await act(async () => root.unmount());
  });
  it("holds an open folder's last rows while its page loads, then reports what it drew", async () => {
    let childPage: ContentDatabaseNavigationPageResponse | undefined;
    useFilesNavigationPage.mockImplementation((args) =>
      args.navigation.parentId === "root"
        ? {
            data: childPage,
            isLoading: childPage === undefined,
            isError: false,
            isFetching: childPage === undefined,
            refetch: vi.fn(),
          }
        : {
            data: page([
              navigationItem("root", null, true),
              navigationItem("below"),
            ]),
            isLoading: false,
            isError: false,
            isFetching: false,
            refetch: vi.fn(),
          },
    );
    const onBranchShown = vi.fn();
    const props = {
      initiallyExpanded: ["root"],
      branchPlaceholders: { root: { rows: 4, more: true } },
      onBranchShown,
    };
    const { container, root } = await renderHarness(props);

    // Four rows and the Show more row, in the rows' own 28px boxes.
    expect(
      container.querySelectorAll('div[aria-hidden="true"].h-7'),
    ).toHaveLength(5);
    expect(onBranchShown).not.toHaveBeenCalled();

    childPage = page(
      Array.from({ length: 4 }, (_, index) =>
        navigationItem(`child-${index + 1}`, "root"),
      ),
      "child-cursor",
    );
    await act(async () => root.render(<Harness {...props} />));
    expect(
      container.querySelectorAll('div[aria-hidden="true"].h-7'),
    ).toHaveLength(0);
    expect(container.querySelectorAll('a[href^="/page/child-"]')).toHaveLength(
      4,
    );
    expect(onBranchShown).toHaveBeenCalledWith("root", { rows: 4, more: true });

    await act(async () => root.unmount());
  });

  it("reads open folders' pages with the root page", async () => {
    useFilesNavigationPage.mockImplementation((args) => ({
      data:
        args.navigation.parentId === null
          ? page([navigationItem("root", null, true)])
          : page([]),
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    }));
    const { root } = await renderHarness({ initiallyExpanded: ["root"] });

    expect(useFilesNavigationPage).toHaveBeenCalledWith(
      {
        databaseId: "files",
        limit: 20,
        navigation: { parentId: null, cursor: undefined },
      },
      new Set(["root"]),
    );

    await act(async () => root.unmount());
  });
});
