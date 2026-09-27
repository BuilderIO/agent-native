// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import type {
  ContentDatabaseItem,
  ContentDatabaseNavigationItem,
  ContentDatabaseNavigationPageResponse,
  Document,
} from "@shared/api";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const useActionQuery = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({ useActionQuery }));

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
}: {
  activeDocumentId?: string;
  activePathDocuments?: Document[];
  onDeleteItem?: (item: ContentDatabaseItem) => void;
  onToggleFavorite?: (item: ContentDatabaseItem) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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
      <MemoryRouter>
        <TooltipProvider>
          <PagedContentFilesSidebarView
            databaseId="files"
            sort="custom"
            viewId="default"
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
          />
        </TooltipProvider>
      </MemoryRouter>
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
    useActionQuery.mockReset();
  });

  it("shows 20 roots and appends the 21st through the opaque cursor", async () => {
    useActionQuery.mockImplementation((_name, args) => ({
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
    expect(useActionQuery).toHaveBeenCalledWith(
      "query-content-database-items",
      expect.objectContaining({
        limit: 20,
        navigation: expect.objectContaining({ cursor: "root-cursor" }),
      }),
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
    useActionQuery.mockImplementation((_name, args) => ({
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
    useActionQuery.mockImplementation((_name, args) => {
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
      useActionQuery.mock.calls.every(
        ([, args]) => args.navigation.parentId === null,
      ),
    ).toBe(true);
    const expand = container.querySelector<HTMLButtonElement>(
      '[aria-label="Expand Page root"]',
    );
    expect(expand).not.toBeNull();
    await act(async () => expand?.click());
    expect(useActionQuery).toHaveBeenCalledWith(
      "query-content-database-items",
      expect.objectContaining({
        navigation: expect.objectContaining({ parentId: "root" }),
      }),
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

  it("keeps failed pages recoverable with Retry", async () => {
    const refetch = vi.fn();
    useActionQuery.mockReturnValue({
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
    useActionQuery.mockReturnValue({
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
    useActionQuery.mockImplementation((_name, args) => ({
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
      useActionQuery.mock.calls.some(
        ([, args]) => args.navigation.cursor === "next-root-page",
      ),
    ).toBe(false);

    await act(async () => root.unmount());
  });
});
