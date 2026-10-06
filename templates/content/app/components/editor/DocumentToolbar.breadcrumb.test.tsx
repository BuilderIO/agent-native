// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import type {
  ContentDatabaseNavigationItem,
  ContentDatabaseNavigationPageResponse,
} from "@shared/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { filesNavigationPageParams } from "@/lib/files-navigation";

import {
  ToolbarBreadcrumb,
  type ToolbarBreadcrumbItem,
} from "./DocumentToolbar";

function peer(id: string, sourceKind: string | null = null) {
  return {
    membershipId: `membership-${id}`,
    membershipPosition: 0,
    documentId: id,
    parentId: "parent",
    title: `Page ${id}`,
    icon: null,
    type: "page",
    hasChildren: false,
    spaceId: "space",
    sourceKind,
    isFavorite: false,
    canEdit: true,
    canManage: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } satisfies ContentDatabaseNavigationItem;
}

function renderBreadcrumb(
  pages: Array<{
    cursor?: string;
    page: ContentDatabaseNavigationPageResponse;
  }>,
  onOpen = vi.fn(),
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  for (const { cursor, page } of pages) {
    queryClient.setQueryData(
      [
        "action",
        "query-content-database-items",
        filesNavigationPageParams({
          databaseId: "files",
          parentId: "parent",
          cursor,
        }),
      ],
      page,
    );
  }
  const items: ToolbarBreadcrumbItem[] = [
    { id: "parent", title: "Parent" },
    {
      id: "current",
      title: "Current",
      filesDatabaseId: "files",
      siblings: { filesDatabaseId: "files", parentId: "parent" },
    },
  ];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <AgentNativeI18nProvider
          initialLocale="en-US"
          persistPreference={false}
          catalog={{
            sourceLocale: "en-US",
            messages: {
              sidebar: { showMore: "Show more", loadingFiles: "Loading" },
              database: { retry: "Retry" },
            },
          }}
        >
          <ToolbarBreadcrumb
            items={items}
            currentDocumentId="current"
            ariaLabel="Page breadcrumb"
            untitledLabel="Untitled"
            onOpen={onOpen}
          />
        </AgentNativeI18nProvider>
      </QueryClientProvider>,
    ),
  );
  return { container, root, onOpen };
}

async function openMenu(container: HTMLElement) {
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Current"]',
  );
  expect(trigger).not.toBeNull();
  await act(async () => {
    trigger!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
}

function menuLabels() {
  return Array.from(document.querySelectorAll('[role="menuitem"]')).map(
    (item) => item.textContent?.trim(),
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("breadcrumb peer menus", () => {
  it("lists the sidebar's cached page of peers, without folders, and opens one", async () => {
    const { container, root, onOpen } = renderBreadcrumb([
      {
        page: {
          items: [peer("current"), peer("folder", "folder"), peer("next")],
          pagination: { limit: 20, hasMore: false, nextCursor: null },
        },
      },
    ]);

    await openMenu(container);
    expect(menuLabels()).toEqual(["Page current", "Page next"]);

    const next = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("Page next"));
    await act(async () => next!.click());
    expect(onOpen).toHaveBeenCalledWith("next", "files");

    act(() => root.unmount());
  });

  it("drops the menu once the cached page shows no peers", () => {
    const { container, root } = renderBreadcrumb([
      {
        page: {
          items: [peer("current")],
          pagination: { limit: 20, hasMore: false, nextCursor: null },
        },
      },
    ]);

    expect(container.querySelector('button[aria-label="Current"]')).toBeNull();
    expect(container.textContent).toContain("Current");

    act(() => root.unmount());
  });

  it("bounds a large branch to one page and loads more on request", async () => {
    const { container, root } = renderBreadcrumb([
      {
        page: {
          items: Array.from({ length: 20 }, (_, index) => peer(`p${index}`)),
          pagination: { limit: 20, hasMore: true, nextCursor: "next-page" },
        },
      },
      {
        cursor: "next-page",
        page: {
          items: [peer("p19"), peer("p20")],
          pagination: { limit: 20, hasMore: false, nextCursor: null },
        },
      },
    ]);

    await openMenu(container);
    expect(menuLabels()).toHaveLength(21);
    expect(menuLabels().slice(-1)[0]).toBe("Show more");

    const showMore = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("Show more"));
    await act(async () => showMore!.click());
    expect(menuLabels()).toHaveLength(21);
    expect(menuLabels().slice(-1)[0]).toBe("Page p20");

    act(() => root.unmount());
  });
});
