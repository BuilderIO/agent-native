// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import type {
  ContentDatabaseItem,
  ContentDatabaseNavigationItem,
  ContentDatabaseNavigationPageResponse,
  Document,
} from "@shared/api";
import {
  defaultScheduler,
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import {
  SidebarPageActionsProvider,
  type SidebarPageActions,
} from "@/components/sidebar/SidebarRowActions";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  MOVE_DOCUMENT_MUTATION_KEY,
  type MoveDocumentContext,
} from "@/hooks/use-pending-moves";
import { DELETE_DOCUMENT_MUTATION_KEY } from "@/hooks/use-pending-trash";
import { type FilesRowMove, keepMovedFilesRow } from "@/lib/files-navigation";
import type { SidebarRowsHint } from "@/lib/sidebar-layout-hint";

const useFilesNavigationPage = vi.hoisted(() => vi.fn());

vi.mock("@/lib/files-navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/files-navigation")>()),
  useFilesNavigationPage,
}));

import {
  navigationItemAsDatabaseItem,
  PagedContentFilesSidebarView,
  type ActivePathDocument,
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
  pageActions = null,
  documentMetadata = new Map(),
  queryClient: providedQueryClient,
}: {
  pageActions?: SidebarPageActions | null;
  documentMetadata?: ReadonlyMap<string, Document>;
  activeDocumentId?: string;
  activePathDocuments?: ActivePathDocument[];
  onDeleteItem?: (item: ContentDatabaseItem) => void;
  onToggleFavorite?: (item: ContentDatabaseItem) => void;
  initiallyExpanded?: string[];
  branchPlaceholders?: Record<string, SidebarRowsHint>;
  onBranchShown?: (documentId: string, shown: SidebarRowsHint) => void;
  queryClient?: QueryClient;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(initiallyExpanded),
  );
  const [queryClient] = useState(
    () => providedQueryClient ?? new QueryClient(),
  );
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
            <SidebarPageActionsProvider value={pageActions}>
              <PagedContentFilesSidebarView
                databaseId="files"
                {...(activeDocumentId === undefined
                  ? {}
                  : { activeDocumentId })}
                {...(activePathDocuments ? { activePathDocuments } : {})}
                {...(onDeleteItem ? { onDeleteItem } : {})}
                {...(onToggleFavorite ? { onToggleFavorite } : {})}
                {...(branchPlaceholders ? { branchPlaceholders } : {})}
                {...(onBranchShown ? { onBranchShown } : {})}
                expandedDocumentIds={expanded}
                onDocumentExpandedChange={(id, open) =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (open) next.add(id);
                    else next.delete(id);
                    return next;
                  })
                }
                documentMetadata={documentMetadata}
                onCreateChildPage={() => {}}
                navigationLabel="Files"
                untitledLabel="Untitled"
              />
            </SidebarPageActionsProvider>
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
  it("hides pages on their way to Trash and shows them again when the move fails", async () => {
    useFilesNavigationPage.mockImplementation(() => ({
      data: page([navigationItem("first-root"), navigationItem("second-root")]),
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    }));
    const openRoot = {
      id: "open-root",
      parentId: null,
      title: "Open root",
      content: "",
      icon: null,
      position: 99,
      isFavorite: false,
      hideFromSearch: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } satisfies Document;
    const queryClient = new QueryClient();
    let failMove: (error: Error) => void = () => {};
    const move = new Promise<never>((_resolve, reject) => {
      failMove = reject;
    });
    const trash = (id: string) =>
      queryClient
        .getMutationCache()
        .build(queryClient, {
          mutationKey: DELETE_DOCUMENT_MUTATION_KEY,
          mutationFn: (_variables: { id: string }) => move,
        })
        .execute({ id })
        .catch(() => {});
    const { container, root } = await renderHarness({
      activeDocumentId: openRoot.id,
      activePathDocuments: [openRoot],
      queryClient,
    });
    const shown = () =>
      Array.from(container.querySelectorAll("a"), (link) =>
        link.getAttribute("href"),
      );
    expect(shown()).toEqual([
      "/page/first-root",
      "/page/second-root",
      "/page/open-root",
    ]);

    let moves: Promise<unknown>[] = [];
    await act(async () => {
      moves = [trash("second-root"), trash("open-root")];
      // TanStack Query tells subscribers about the move on a timer.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(shown()).toEqual(["/page/first-root"]);

    await act(async () => {
      failMove(new Error("Trash is unavailable"));
      await Promise.all(moves);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(shown()).toEqual([
      "/page/first-root",
      "/page/second-root",
      "/page/open-root",
    ]);

    await act(async () => root.unmount());
  });

  it("draws a page under its new parent while its move is pending and back where it was when the move fails", async () => {
    const branches: Partial<Record<string, ContentDatabaseNavigationItem[]>> = {
      root: [
        navigationItem("folder"),
        navigationItem("page-a"),
        navigationItem("page-b"),
      ],
      folder: [],
    };
    useFilesNavigationPage.mockImplementation((args) => ({
      data: page(branches[args.navigation.parentId ?? "root"] ?? []),
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    }));
    const queryClient = new QueryClient();
    let failMove: (error: Error) => void = () => {};
    const moveAnswer = new Promise<never>((_resolve, reject) => {
      failMove = reject;
    });
    const { container, root } = await renderHarness({
      initiallyExpanded: ["folder"],
      queryClient,
    });
    // Each link with how many rows it sits inside.
    const shown = () => {
      const rows = Array.from(container.querySelectorAll("a"), (link) => {
        let depth = 0;
        for (let node: Element | null = link; node; node = node.parentElement)
          if (node.classList.contains("gap-0.5")) depth += 1;
        return [link.getAttribute("href"), depth] as const;
      });
      const top = Math.min(...rows.map(([, depth]) => depth));
      return rows.map(([href, depth]) => [href, depth - top]);
    };
    expect(shown()).toEqual([
      ["/page/folder", 0],
      ["/page/page-a", 0],
      ["/page/page-b", 0],
    ]);

    let moving: Promise<unknown> = Promise.resolve();
    await act(async () => {
      moving = queryClient
        .getMutationCache()
        .build(queryClient, {
          mutationKey: MOVE_DOCUMENT_MUTATION_KEY,
          mutationFn: (_variables: { id: string; parentId: string }) =>
            moveAnswer,
          onMutate: (): MoveDocumentContext => ({
            move: {
              documentId: "page-b",
              databaseId: "files",
              parentId: "folder",
              from: { databaseId: "files", parentId: null },
              item: { ...navigationItem("page-b"), parentId: "folder" },
            },
          }),
        })
        .execute({ id: "page-b", parentId: "folder" })
        .catch(() => {});
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(shown()).toEqual([
      ["/page/folder", 0],
      ["/page/page-b", 1],
      ["/page/page-a", 0],
    ]);

    await act(async () => {
      failMove(new Error("Move is unavailable"));
      await moving;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(shown()).toEqual([
      ["/page/folder", 0],
      ["/page/page-a", 0],
      ["/page/page-b", 0],
    ]);

    await act(async () => root.unmount());
  });

  it("draws the open page once after its move ends, while the path the sidebar passes down still names its old parent", async () => {
    notifyManager.setScheduler((callback) => callback());
    onTestFinished(() => notifyManager.setScheduler(defaultScheduler));
    const branches: Partial<Record<string, ContentDatabaseNavigationItem[]>> = {
      root: [navigationItem("folder"), navigationItem("page-a")],
      folder: [],
    };
    useFilesNavigationPage.mockImplementation((args) => ({
      data: page(branches[args.navigation.parentId ?? "root"] ?? []),
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    }));
    const openPage = {
      id: "open-page",
      parentId: null,
      title: "Open page",
      content: "",
      icon: null,
      position: 99,
      isFavorite: false,
      hideFromSearch: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } satisfies Document;
    const pathKey = [
      "action",
      "get-content-navigation-context",
      { id: openPage.id },
    ];
    const queryClient = new QueryClient();
    queryClient.setQueryData(pathKey, {
      path: [{ id: openPage.id, parentId: null }],
    });
    const props = {
      activeDocumentId: openPage.id,
      activePathDocuments: [openPage],
      initiallyExpanded: ["folder"],
      queryClient,
    };
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<Harness {...props} />));
    const shown = () => {
      const rows = Array.from(container.querySelectorAll("a"), (link) => {
        let depth = 0;
        for (let node: Element | null = link; node; node = node.parentElement)
          if (node.classList.contains("gap-0.5")) depth += 1;
        return [link.getAttribute("href"), depth] as const;
      });
      const top = Math.min(...rows.map(([, depth]) => depth));
      return rows.map(([href, depth]) => [href, depth - top]);
    };
    expect(shown()).toEqual([
      ["/page/folder", 0],
      ["/page/page-a", 0],
      ["/page/open-page", 0],
    ]);

    let answerMove: () => void = () => {};
    const moveAnswer = new Promise<void>((resolve) => {
      answerMove = resolve;
    });
    let sent: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      sent = resolve;
    });
    let moving: Promise<unknown> = Promise.resolve();
    await act(async () => {
      moving = queryClient
        .getMutationCache()
        .build(queryClient, {
          mutationKey: MOVE_DOCUMENT_MUTATION_KEY,
          mutationFn: (_variables: { id: string; parentId: string }) => {
            sent();
            return moveAnswer;
          },
          onMutate: (): MoveDocumentContext => ({
            move: {
              documentId: openPage.id,
              databaseId: "files",
              parentId: "folder",
              from: { databaseId: "files", parentId: null },
              item: { ...navigationItem(openPage.id), parentId: "folder" },
            },
          }),
          onSettled: () => {
            branches.root = [
              { ...navigationItem("folder"), hasChildren: true },
              navigationItem("page-a"),
            ];
            branches.folder = [
              { ...navigationItem(openPage.id), parentId: "folder" },
            ];
            queryClient.setQueryData(pathKey, {
              path: [{ id: openPage.id, parentId: "folder" }],
            });
          },
        })
        .execute({ id: openPage.id, parentId: "folder" });
      await started;
    });
    expect(shown()).toEqual([
      ["/page/folder", 0],
      ["/page/open-page", 1],
      ["/page/page-a", 0],
    ]);

    await act(async () => {
      answerMove();
      await moving;
    });
    expect(shown()).toEqual([
      ["/page/folder", 0],
      ["/page/open-page", 1],
      ["/page/page-a", 0],
    ]);

    await act(async () =>
      root.render(
        <Harness
          {...props}
          activePathDocuments={[{ ...openPage, parentId: "folder" }]}
        />,
      ),
    );
    expect(shown()).toEqual([
      ["/page/folder", 0],
      ["/page/open-page", 1],
      ["/page/page-a", 0],
    ]);

    await act(async () => root.unmount());
  });

  it("draws a page moved into a folder that hasn't loaded below the folder's placeholder rows, through the move's answer", async () => {
    let rootRows = [navigationItem("folder"), navigationItem("page-b")];
    useFilesNavigationPage.mockImplementation((args) =>
      args.navigation.parentId === "folder"
        ? {
            data: undefined,
            isLoading: true,
            isError: false,
            isFetching: true,
            refetch: vi.fn(),
          }
        : {
            data: page(rootRows),
            isLoading: false,
            isError: false,
            isFetching: false,
            refetch: vi.fn(),
          },
    );
    const queryClient = new QueryClient();
    const { container, root } = await renderHarness({
      initiallyExpanded: ["folder"],
      queryClient,
    });
    // Each link with how many rows it sits inside.
    const shown = () =>
      Array.from(container.querySelectorAll("a"), (link) => {
        let depth = 0;
        for (let node: Element | null = link; node; node = node.parentElement)
          if (node.classList.contains("gap-0.5")) depth += 1;
        return [link.getAttribute("href"), depth] as const;
      });
    const topDepth = shown().shift()?.[1] ?? 0;
    expect(shown()).toEqual([
      ["/page/folder", topDepth],
      ["/page/page-b", topDepth],
    ]);

    let answerMove: () => void = () => {};
    const moveAnswer = new Promise<void>((resolve) => {
      answerMove = resolve;
    });
    let moving: Promise<unknown> = Promise.resolve();
    await act(async () => {
      moving = queryClient
        .getMutationCache()
        .build(queryClient, {
          mutationKey: MOVE_DOCUMENT_MUTATION_KEY,
          mutationFn: (_variables: { id: string; parentId: string }) =>
            moveAnswer,
          onMutate: (): MoveDocumentContext => ({
            move: {
              documentId: "page-b",
              databaseId: "files",
              parentId: "folder",
              from: { databaseId: "files", parentId: null },
              item: { ...navigationItem("page-b"), parentId: "folder" },
            },
          }),
          // As `useMoveDocument` does: the new branch keeps the page, and the
          // cached branch it left lists the folder with children, not the page.
          onSuccess: (_data, _variables, result) => {
            const move = (result as MoveDocumentContext | undefined)?.move;
            if (move) keepMovedFilesRow(queryClient, move);
            rootRows = [{ ...navigationItem("folder"), hasChildren: true }];
          },
        })
        .execute({ id: "page-b", parentId: "folder" });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    // The folder's children are still loading; the moved page shows under them.
    expect(shown()).toEqual([
      ["/page/folder", topDepth],
      ["/page/page-b", topDepth + 1],
    ]);

    await act(async () => {
      answerMove();
      await moving;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    // The move answered before the folder's read: the page stays under it.
    expect(shown()).toEqual([
      ["/page/folder", topDepth],
      ["/page/page-b", topDepth + 1],
    ]);

    await act(async () => root.unmount());
  });

  it("gives the open page's off-page row an expand arrow when its path entry has children", async () => {
    useFilesNavigationPage.mockImplementation((args) => ({
      data:
        args.navigation.parentId === "off-page-open"
          ? page([navigationItem("open-child", "off-page-open")])
          : page([navigationItem("first-root")], "next-root-page"),
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    }));
    const openDocument = {
      id: "off-page-open",
      parentId: null,
      title: "Off-page open",
      content: "",
      icon: null,
      position: 99,
      isFavorite: false,
      hideFromSearch: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } satisfies Document;

    const leaf = await renderHarness({
      activeDocumentId: openDocument.id,
      activePathDocuments: [{ ...openDocument, hasChildren: false }],
    });
    expect(leaf.container.textContent).toContain("Off-page open");
    expect(
      leaf.container.querySelector('[aria-label="Expand Off-page open"]'),
    ).toBeNull();
    await act(async () => leaf.root.unmount());

    const { container, root } = await renderHarness({
      activeDocumentId: openDocument.id,
      activePathDocuments: [{ ...openDocument, hasChildren: true }],
    });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Expand Off-page open"]')
        ?.click(),
    );
    expect(container.textContent).toContain("Page open-child");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Collapse Off-page open"]',
        )
        ?.click(),
    );
    expect(container.textContent).not.toContain("Page open-child");
    expect(
      container.querySelector('[aria-label="Expand Off-page open"]'),
    ).not.toBeNull();

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

  it("draws a grouped view's groups with flat rows and pages each group on its own", async () => {
    useFilesNavigationPage.mockImplementation((args) => ({
      data: args.navigation.group
        ? page([navigationItem("draft-3")])
        : {
            ...page([navigationItem("root-1", null, true)]),
            groups: [
              {
                id: "stage:draft",
                label: "Draft",
                unset: false,
                count: 3,
                page: page(
                  [
                    navigationItem("nested-1", "root-1", true),
                    navigationItem("draft-2"),
                  ],
                  "draft-cursor",
                ),
              },
              {
                id: "stage:__ungrouped__",
                label: "No Stage",
                unset: true,
                count: 1,
                page: page([navigationItem("root-1", null, true)]),
              },
            ],
          },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    }));
    const { container, root } = await renderHarness({
      initiallyExpanded: ["root-1"],
    });
    const links = () =>
      Array.from(container.querySelectorAll<HTMLAnchorElement>("a")).map(
        (link) => link.getAttribute("href"),
      );
    const button = (text: string) =>
      Array.from(container.querySelectorAll("button")).find(
        (candidate) => candidate.textContent === text,
      );

    expect(links()).toEqual([
      "/page/nested-1",
      "/page/draft-2",
      "/page/root-1",
    ]);
    expect(button("Draft3")).toBeDefined();
    expect(button("No Stage1")).toBeDefined();
    expect(
      container.querySelector('[aria-label="Expand Page root-1"]'),
    ).toBeNull();
    expect(
      container.querySelector('[aria-label="Collapse Page root-1"]'),
    ).toBeNull();

    await act(async () => button("Show more")?.click());
    expect(useFilesNavigationPage).toHaveBeenCalledWith(
      expect.objectContaining({
        navigation: {
          parentId: null,
          cursor: "draft-cursor",
          group: "stage:draft",
        },
      }),
      undefined,
    );
    expect(links()).toEqual([
      "/page/nested-1",
      "/page/draft-2",
      "/page/draft-3",
      "/page/root-1",
    ]);

    await act(async () => button("Draft3")?.click());
    expect(links()).toEqual(["/page/root-1"]);

    await act(async () => root.unmount());
  });

  it("shows the open page in each group that lists it, even past the group's first page", async () => {
    const openDocument = {
      id: "open-page",
      parentId: "root-1",
      title: "Open page",
      content: "",
      icon: null,
      position: 99,
      isFavorite: false,
      hideFromSearch: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } satisfies Document;
    useFilesNavigationPage.mockImplementation((args) => ({
      data: args.navigation.locate
        ? { ...page([]), locatedGroupIds: ["stage:draft"] }
        : args.navigation.group
          ? page([navigationItem("open-page"), navigationItem("draft-2")])
          : {
              ...page([navigationItem("root-1", null, true)]),
              groups: [
                {
                  id: "stage:draft",
                  label: "Draft",
                  unset: false,
                  count: 3,
                  page: page([navigationItem("draft-1")], "draft-cursor"),
                },
                {
                  id: "stage:live",
                  label: "Live",
                  unset: false,
                  count: 1,
                  page: page([navigationItem("live-1")]),
                },
              ],
            },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    }));
    const { container, root } = await renderHarness({
      activeDocumentId: openDocument.id,
      activePathDocuments: [openDocument],
    });
    const links = () =>
      Array.from(container.querySelectorAll<HTMLAnchorElement>("a")).map(
        (link) => link.getAttribute("href"),
      );

    expect(useFilesNavigationPage).toHaveBeenCalledWith(
      expect.objectContaining({
        navigation: { parentId: null, cursor: undefined, locate: "open-page" },
      }),
      undefined,
      { enabled: true },
    );
    expect(links()).toEqual([
      "/page/draft-1",
      "/page/open-page",
      "/page/live-1",
    ]);
    expect(
      container.querySelector('[aria-label="Expand Open page"]'),
    ).toBeNull();

    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Show more")
        ?.click(),
    );
    expect(links()).toEqual([
      "/page/draft-1",
      "/page/open-page",
      "/page/draft-2",
      "/page/live-1",
    ]);

    await act(async () => root.unmount());
  });

  it("shows an open page with several values in each of its groups, even when one group's first page lists it", async () => {
    const openDocument = {
      id: "open-page",
      parentId: null,
      title: "Open page",
      content: "",
      icon: null,
      position: 99,
      isFavorite: false,
      hideFromSearch: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } satisfies Document;
    useFilesNavigationPage.mockImplementation((args) => ({
      data: args.navigation.locate
        ? { ...page([]), locatedGroupIds: ["tags:red", "tags:blue"] }
        : {
            ...page([navigationItem("open-page")]),
            groups: [
              {
                id: "tags:red",
                label: "Red",
                unset: false,
                count: 2,
                page: page([
                  navigationItem("open-page"),
                  navigationItem("red-2"),
                ]),
              },
              {
                id: "tags:blue",
                label: "Blue",
                unset: false,
                count: 2,
                page: page([navigationItem("blue-1")], "blue-cursor"),
              },
            ],
          },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    }));
    const { container, root } = await renderHarness({
      activeDocumentId: openDocument.id,
      activePathDocuments: [openDocument],
    });

    expect(
      Array.from(container.querySelectorAll<HTMLAnchorElement>("a")).map(
        (link) => link.getAttribute("href"),
      ),
    ).toEqual([
      "/page/open-page",
      "/page/red-2",
      "/page/blue-1",
      "/page/open-page",
    ]);

    await act(async () => root.unmount());
  });

  it("takes a page moving to another space out of its groups, and shows one moving in in the no-value group", async () => {
    useFilesNavigationPage.mockImplementation(() => ({
      data: {
        ...page([navigationItem("none-1")]),
        groups: [
          {
            id: "stage:draft",
            label: "Draft",
            unset: false,
            count: 2,
            page: page([navigationItem("draft-1"), navigationItem("draft-2")]),
          },
          {
            id: "stage:__ungrouped__",
            label: "No Stage",
            unset: true,
            count: 1,
            page: page([navigationItem("none-1")]),
          },
        ],
      },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    }));
    const queryClient = new QueryClient();
    const { container, root } = await renderHarness({ queryClient });
    const links = () =>
      Array.from(container.querySelectorAll<HTMLAnchorElement>("a")).map(
        (link) => link.getAttribute("href"),
      );
    const failMoves: Array<(error: Error) => void> = [];
    const started: Promise<void>[] = [];
    const moving: Promise<unknown>[] = [];
    const startMove = (move: FilesRowMove) => {
      const answer = new Promise<never>((_resolve, reject) => {
        failMoves.push(reject);
      });
      let sent = () => {};
      started.push(
        new Promise<void>((resolve) => {
          sent = resolve;
        }),
      );
      moving.push(
        queryClient
          .getMutationCache()
          .build(queryClient, {
            mutationKey: MOVE_DOCUMENT_MUTATION_KEY,
            mutationFn: (_variables: {
              id: string;
              parentId: string | null;
            }) => {
              sent();
              return answer;
            },
            onMutate: (): MoveDocumentContext => ({ move }),
          })
          .execute({ id: move.documentId, parentId: move.parentId })
          .catch(() => {}),
      );
    };

    notifyManager.setScheduler((callback) => callback());
    onTestFinished(() => notifyManager.setScheduler(defaultScheduler));

    await act(async () => {
      startMove({
        documentId: "draft-1",
        databaseId: "files",
        parentId: "none-1",
        from: { databaseId: "files", parentId: null },
        item: { ...navigationItem("draft-1"), parentId: "none-1" },
      });
      startMove({
        documentId: "draft-2",
        databaseId: "other-files",
        parentId: null,
        from: { databaseId: "files", parentId: null },
        item: navigationItem("draft-2"),
      });
      startMove({
        documentId: "arriving",
        databaseId: "files",
        parentId: null,
        from: { databaseId: "other-files", parentId: null },
        item: navigationItem("arriving"),
      });
      await Promise.all(started);
    });
    expect(links()).toEqual([
      "/page/draft-1",
      "/page/none-1",
      "/page/arriving",
    ]);

    await act(async () => {
      for (const fail of failMoves) fail(new Error("Move is unavailable"));
      await Promise.all(moving);
    });
    expect(links()).toEqual(["/page/draft-1", "/page/draft-2", "/page/none-1"]);

    await act(async () => root.unmount());
  });

  describe("a linked local folder", () => {
    const notes = "local-source-directory:vault:notes";

    function folderItem(
      id: string,
      title: string,
      parentId: string | null = null,
    ): ContentDatabaseNavigationItem {
      return {
        ...navigationItem(id, parentId, true),
        membershipId: id,
        title,
        type: "folder",
        sourceKind: "folder",
        canEdit: false,
        canManage: false,
      };
    }

    function serveFolderTree() {
      useFilesNavigationPage.mockImplementation((args) => ({
        data:
          args.navigation.parentId === notes
            ? page([navigationItem("today", notes)])
            : page([folderItem(notes, "notes"), navigationItem("readme")]),
        isLoading: false,
        isError: false,
        isFetching: false,
        refetch: vi.fn(),
      }));
    }

    const pageActions: SidebarPageActions = {
      renamePage: vi.fn(async () => {}),
      duplicatePage: vi.fn(),
      movePage: vi.fn(),
    };

    const menuItems = () =>
      Array.from(document.body.querySelectorAll('[role="menuitem"]')).map(
        (item) => item.textContent,
      );

    async function openMenuOf(container: HTMLElement, documentId: string) {
      const row = container
        .querySelector(`a[href="/page/${documentId}"]`)
        ?.closest(".group");
      const trigger = row?.querySelector<HTMLButtonElement>(
        'button[aria-haspopup="menu"]:not([data-sidebar-add-child])',
      );
      expect(trigger).toBeTruthy();
      await act(async () => {
        trigger?.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            pointerType: "mouse",
          }),
        );
        trigger?.click();
      });
    }

    it("draws as a folder that opens to its files, never as a page", async () => {
      serveFolderTree();
      const { container, root } = await renderHarness({
        onDeleteItem: vi.fn(),
        onToggleFavorite: vi.fn(),
      });

      const folder = container.querySelector<HTMLButtonElement>(
        '[aria-label="Expand notes"]',
      );
      expect(folder?.tagName).toBe("BUTTON");
      expect(folder?.getAttribute("aria-expanded")).toBe("false");
      expect(container.querySelector(`a[href="/page/${notes}"]`)).toBeNull();
      expect(
        folder?.closest(".group")?.querySelector('[aria-haspopup="menu"]'),
      ).toBeNull();
      expect(container.querySelector('a[href="/page/today"]')).toBeNull();

      await act(async () => folder?.click());

      expect(folder?.getAttribute("aria-expanded")).toBe("true");
      expect(container.querySelector('a[href="/page/today"]')).not.toBeNull();
      expect(useFilesNavigationPage).toHaveBeenCalledWith(
        expect.objectContaining({
          navigation: expect.objectContaining({ parentId: notes }),
        }),
        new Set([notes]),
      );

      await act(async () => root.unmount());
    });

    it("offers no Move for a page inside it, so its file never looks moved", async () => {
      serveFolderTree();
      const inside = await renderHarness({
        pageActions,
        onDeleteItem: vi.fn(),
        onToggleFavorite: vi.fn(),
        initiallyExpanded: [notes],
      });
      await openMenuOf(inside.container, "today");
      expect(menuItems()).toContain("Rename");
      expect(menuItems()).not.toContain("Move to");
      await act(async () => inside.root.unmount());

      const top = await renderHarness({
        pageActions,
        onDeleteItem: vi.fn(),
        onToggleFavorite: vi.fn(),
      });
      await openMenuOf(top.container, "readme");
      expect(menuItems()).toContain("Move to");
      await act(async () => top.root.unmount());
    });

    it("keeps linked subfolder files immovable in grouped pages, including previously reparented files", async () => {
      const linked = {
        ...navigationItem("linked"),
        sourceKind: "file",
        canMove: false,
      };
      const moved = {
        ...navigationItem("moved", "ordinary-parent"),
        sourceKind: "file",
        canMove: false,
      };
      useFilesNavigationPage.mockImplementation((args) => ({
        data: args.navigation.group
          ? page([moved, navigationItem("ordinary")])
          : {
              ...page([]),
              groups: [
                {
                  id: "stage:draft",
                  label: "Draft",
                  unset: false,
                  count: 3,
                  page: page([linked], "next"),
                },
              ],
            },
        isLoading: false,
        isError: false,
        isFetching: false,
        refetch: vi.fn(),
      }));
      const { container, root } = await renderHarness({
        pageActions,
        onDeleteItem: vi.fn(),
      });
      await openMenuOf(container, "linked");
      expect(menuItems()).not.toContain("Move to");
      await act(async () =>
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
      );
      await act(async () =>
        Array.from(container.querySelectorAll("button"))
          .find((button) => button.textContent === "Show more")
          ?.click(),
      );
      await openMenuOf(container, "moved");
      expect(menuItems()).not.toContain("Move to");
      await act(async () =>
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
      );
      await openMenuOf(container, "ordinary");
      expect(menuItems()).toContain("Move to");
      await act(async () => root.unmount());
    });

    it.each([
      [
        "nested linked without metadata",
        "notes/linked.md",
        false,
        false,
        false,
      ],
      ["nested linked with metadata", "notes/linked.md", false, false, true],
      [
        "top-level linked without metadata",
        "readme.md",
        undefined,
        true,
        false,
      ],
      ["top-level linked with metadata", "readme.md", undefined, false, true],
      [
        "nested unlinked without metadata",
        "notes/unlinked.md",
        undefined,
        true,
        false,
      ],
      [
        "nested unlinked with metadata",
        "notes/unlinked.md",
        undefined,
        false,
        true,
      ],
    ])(
      "uses the server's move eligibility for a grouped active reveal: %s",
      async (_label, path, canMove, movable, withMetadata) => {
        useFilesNavigationPage.mockImplementation((args) => ({
          data: args.navigation.locate
            ? { ...page([]), locatedGroupIds: ["stage:draft"] }
            : {
                ...page([]),
                groups: [
                  {
                    id: "stage:draft",
                    label: "Draft",
                    unset: false,
                    count: 1,
                    page: page([], "next"),
                  },
                ],
              },
          isLoading: false,
          isError: false,
          isFetching: false,
          refetch: vi.fn(),
        }));
        const activeDocument: ActivePathDocument & { canMove?: boolean } = {
          id: "revealed",
          parentId: "ordinary-parent",
          title: "Revealed",
          content: "",
          icon: null,
          position: 0,
          isFavorite: false,
          hideFromSearch: false,
          canEdit: true,
          canManage: true,
          databaseMembership: {
            databaseId: "files",
            databaseDocumentId: "files-document",
            databaseTitle: null,
            position: null,
          },
          ...(canMove === false ? { canMove } : {}),
          source: {
            mode: "local-files",
            kind: "file",
            path,
            rootPath: "vault",
          },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        };
        const { container, root } = await renderHarness({
          activeDocumentId: activeDocument.id,
          activePathDocuments: [activeDocument],
          ...(withMetadata
            ? {
                documentMetadata: new Map([
                  [activeDocument.id, activeDocument],
                ]),
              }
            : {}),
          pageActions,
          onDeleteItem: vi.fn(),
        });
        await openMenuOf(container, activeDocument.id);
        expect(menuItems().includes("Move to")).toBe(movable);
        await act(async () => root.unmount());
      },
    );

    it("keeps local-file menu behavior when full metadata is available", async () => {
      serveFolderTree();
      const metadata: Document = {
        id: "readme",
        parentId: null,
        title: "Readme",
        content: "",
        icon: null,
        position: 0,
        isFavorite: false,
        hideFromSearch: false,
        canEdit: true,
        canManage: true,
        source: {
          mode: "local-files",
          kind: "file",
          path: "README.md",
          rootPath: "vault",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      const { container, root } = await renderHarness({
        pageActions,
        onDeleteItem: vi.fn(),
        documentMetadata: new Map([["readme", metadata]]),
      });
      await openMenuOf(container, "readme");
      expect(menuItems()).not.toContain("Move to");
      expect(menuItems()).not.toContain("Rename");
      await act(async () => root.unmount());
    });

    it("reveals the open page inside its folder when the folder isn't on the loaded page", async () => {
      useFilesNavigationPage.mockImplementation((args) => ({
        data:
          args.navigation.parentId === notes
            ? page([])
            : page([navigationItem("first-root")], "next-root-page"),
        isLoading: false,
        isError: false,
        isFetching: false,
        refetch: vi.fn(),
      }));
      const folderDocument = {
        id: notes,
        parentId: null,
        title: "notes",
        content: "",
        icon: null,
        position: 0,
        isFavorite: false,
        hideFromSearch: false,
        canEdit: false,
        canManage: false,
        source: { mode: "local-files", kind: "folder" },
        hasChildren: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      } satisfies ActivePathDocument;
      const { source: _folderSource, ...pageFields } = folderDocument;
      const activeDocument = {
        ...pageFields,
        id: "today",
        parentId: notes,
        title: "Today",
        canEdit: true,
        canManage: true,
        hasChildren: false,
      } satisfies ActivePathDocument;
      const { container, root } = await renderHarness({
        activeDocumentId: activeDocument.id,
        activePathDocuments: [folderDocument, activeDocument],
        initiallyExpanded: [notes],
      });

      expect(
        container.querySelector('[aria-label="Collapse notes"]')?.tagName,
      ).toBe("BUTTON");
      expect(container.querySelector(`a[href="/page/${notes}"]`)).toBeNull();
      const links = Array.from(
        container.querySelectorAll<HTMLAnchorElement>("a"),
      ).map((link) => link.getAttribute("href"));
      expect(links).toEqual(["/page/first-root", "/page/today"]);
      expect(container.querySelector('[aria-current="page"]')).not.toBeNull();

      await act(async () => root.unmount());
    });
  });
});
