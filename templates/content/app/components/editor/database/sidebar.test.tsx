// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import type { ContentDatabaseItem, ContentDatabaseResponse } from "@shared/api";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import {
  ContentFilesSidebarView,
  DatabaseSidebarView,
  contentSidebarOrderedItems,
  databaseSidebarReorderItems,
  databaseSidebarItemTree,
  databaseSidebarRootItems,
  databaseSidebarRowIndent,
  databaseSidebarRows,
} from "./sidebar";
import type { DatabaseBoardGroup } from "./types";

const item = (id: string, title: string, parentId: string | null = null) =>
  ({
    id: `item-${id}`,
    databaseId: "database",
    document: {
      id,
      parentId,
      title,
      content: "",
      icon: null,
      position: 0,
      isFavorite: false,
      hideFromSearch: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    position: 0,
    properties: [],
  }) as ContentDatabaseItem;

describe("DatabaseSidebarView", () => {
  it("keeps a personal custom item order before new membership positions", () => {
    const first = { ...item("first", "First"), position: 1 };
    const second = { ...item("second", "Second"), position: 2 };
    const newItem = { ...item("new", "New"), position: 0 };

    expect(
      contentSidebarOrderedItems([first, second, newItem], {
        mode: "custom",
        itemIds: [second.id, first.id],
      }).map((candidate) => candidate.id),
    ).toEqual([second.id, first.id, newItem.id]);
  });

  it("uses stable computed Files ordering without replacing the custom order", () => {
    const alpha = {
      ...item("alpha", "Alpha"),
      document: {
        ...item("alpha", "Alpha").document,
        createdAt: "2026-01-03T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    };
    const beta = {
      ...item("beta", "Beta"),
      document: {
        ...item("beta", "Beta").document,
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
      },
    };
    const customItemIds = [beta.id, alpha.id];

    expect(
      contentSidebarOrderedItems([beta, alpha], {
        mode: "name",
        itemIds: customItemIds,
      }).map((candidate) => candidate.id),
    ).toEqual([alpha.id, beta.id]);
    expect(
      contentSidebarOrderedItems([alpha, beta], {
        mode: "last_edited",
        itemIds: customItemIds,
      }).map((candidate) => candidate.id),
    ).toEqual([beta.id, alpha.id]);
    expect(
      contentSidebarOrderedItems([beta, alpha], {
        mode: "created",
        itemIds: customItemIds,
      }).map((candidate) => candidate.id),
    ).toEqual([alpha.id, beta.id]);
    expect(
      contentSidebarOrderedItems([alpha, beta], {
        mode: "custom",
        itemIds: customItemIds,
      }).map((candidate) => candidate.id),
    ).toEqual(customItemIds);
  });

  it("treats flat reference rows as reorder siblings while preserving Files hierarchy", () => {
    const rows = [
      item("first", "First", "canonical-parent-a"),
      item("second", "Second", "canonical-parent-b"),
    ];

    expect(
      databaseSidebarReorderItems(rows, "Untitled", false).map(
        (candidate) => candidate.parentId,
      ),
    ).toEqual([null, null]);
    expect(
      databaseSidebarReorderItems(rows, "Untitled", true).map(
        (candidate) => candidate.parentId,
      ),
    ).toEqual(["canonical-parent-a", "canonical-parent-b"]);
  });

  it("disables manual reorder while the active saved view has sorts", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TooltipProvider>
          <ContentFilesSidebarView
            data={
              {
                database: {
                  viewConfig: {
                    version: 1,
                    activeViewId: "default",
                    views: [
                      {
                        id: "default",
                        name: "Table",
                        type: "table",
                        filters: [],
                        sorts: [
                          {
                            key: "name",
                            label: "Name",
                            direction: "asc",
                          },
                        ],
                        filterMode: "and",
                      },
                    ],
                  },
                },
                items: [item("first", "First")],
                properties: [],
              } as unknown as ContentDatabaseResponse
            }
            overrides={null}
            isLoading={false}
            sidebarOrder={{ mode: "custom", itemIds: ["item-first"] }}
            manualReorder={{
              onReorder: () => {},
              labels: {
                drag: (label) => `Drag ${label}`,
                moveUp: "Move up",
                moveDown: "Move down",
                moveTo: "Move to",
                moveToPosition: (position) => `Position ${position}`,
              },
            }}
            labels={{
              noMatchesLabel: "No matches",
              clearLabel: "Clear",
              navigationLabel: "Files",
              untitledLabel: "Untitled",
            }}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );

    expect(markup).not.toContain("Drag First");
    expect(markup).toContain('role="link"');
  });

  it("leaves the compact order control to the workspace header", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TooltipProvider>
          <ContentFilesSidebarView
            data={
              {
                database: {
                  viewConfig: {
                    version: 1,
                    activeViewId: "default",
                    views: [],
                  },
                },
                items: [],
                properties: [],
              } as unknown as ContentDatabaseResponse
            }
            overrides={null}
            isLoading={false}
            sidebarOrder={{ mode: "name", itemIds: [] }}
            labels={{
              noMatchesLabel: "No matches",
              clearLabel: "Clear",
              navigationLabel: "Files",
              untitledLabel: "Untitled",
            }}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );

    expect(markup).not.toContain("Order: name");
  });

  it("aligns sibling icons whether or not a page has children", () => {
    expect(databaseSidebarRowIndent(1, false)).toBe(
      databaseSidebarRowIndent(1, true),
    );
  });

  it("keeps grouped rows in their filtered and sorted group order", () => {
    const groups = [
      { id: "todo", label: "Todo", items: [item("first", "First")] },
      { id: "done", label: "Done", items: [item("second", "Second")] },
    ] as DatabaseBoardGroup[];

    expect(
      databaseSidebarRows(groups).map((candidate) => candidate.id),
    ).toEqual(["item-first", "item-second"]);
  });

  it("renders an empty fallback while database data is incomplete", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TooltipProvider>
          <ContentFilesSidebarView
            data={{} as ContentDatabaseResponse}
            overrides={null}
            isLoading={false}
            labels={{
              noMatchesLabel: "No matches",
              clearLabel: "Clear",
              navigationLabel: "Files",
              untitledLabel: "Untitled",
            }}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );

    expect(markup).toContain('aria-label="Files"');
  });

  it("renders skeleton rows without loading copy or a spinner", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <DatabaseSidebarView
          groups={[]}
          grouped={false}
          isLoading
          hasActiveConstraints={false}
          openPagesIn="full_page"
          noMatchesLabel="No pages"
          clearLabel="Clear"
          navigationLabel="Pages"
          untitledLabel="Untitled"
          onClearResultConstraints={() => {}}
          onPreview={() => {}}
        />
      </MemoryRouter>,
    );

    expect(markup).not.toContain("Loading");
    expect(markup).not.toContain("animate-spin");
    expect(markup).toContain("animate-pulse");
  });

  it("renders compact router links for an ungrouped saved view", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TooltipProvider>
          <DatabaseSidebarView
            groups={[
              {
                id: "all",
                label: "All pages",
                items: [item("page", "Project")],
                property: null,
                value: "all",
              },
            ]}
            grouped={false}
            isLoading={false}
            hasActiveConstraints={false}
            openPagesIn="full_page"
            noMatchesLabel="No rows match this view"
            clearLabel="Clear"
            navigationLabel="Database pages"
            untitledLabel="Untitled"
            onClearResultConstraints={() => {}}
            onPreview={() => {}}
            activeDocumentId="page"
          />
        </TooltipProvider>
      </MemoryRouter>,
    );

    expect(markup).toContain('href="/page/page"');
    expect(markup).toContain("Project");
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("font-semibold");
  });

  it("starts with only hierarchy roots visible", () => {
    const rootItem = item("parent", "Page one");
    const childItem = item("child", "Page two", "parent");
    const grandchildItem = item("grandchild", "Page three", "child");

    expect(
      databaseSidebarItemTree(
        [rootItem],
        [rootItem, childItem, grandchildItem],
      ),
    ).toMatchObject([
      {
        item: { document: { id: "parent" } },
        children: [
          {
            item: { document: { id: "child" } },
            children: [{ item: { document: { id: "grandchild" } } }],
          },
        ],
      },
    ]);

    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TooltipProvider>
          <DatabaseSidebarView
            groups={[
              {
                id: "all",
                label: "All pages",
                items: [rootItem],
                property: null,
                value: "all",
              },
            ]}
            hierarchyItems={[rootItem, childItem, grandchildItem]}
            grouped={false}
            isLoading={false}
            hasActiveConstraints
            openPagesIn="full_page"
            noMatchesLabel="No rows match this view"
            clearLabel="Clear"
            navigationLabel="Database pages"
            untitledLabel="Untitled"
            onClearResultConstraints={() => {}}
            onPreview={() => {}}
            activeDocumentId="parent"
          />
        </TooltipProvider>
      </MemoryRouter>,
    );

    expect(markup).toContain('aria-label="Expand Page one"');
    expect(markup).not.toContain('href="/page/child"');
    expect(markup).not.toContain("Page three");
    expect(markup).toContain('aria-current="page"');
  });

  it("does not promote a child when sorting places it before its parent", () => {
    const parent = item("parent", "Zulu parent");
    const child = item("child", "Alpha child", "parent");
    const sortedItems = [child, parent];

    expect(
      databaseSidebarRootItems(sortedItems, sortedItems).map(
        (candidate) => candidate.document.id,
      ),
    ).toEqual(["parent"]);

    expect(
      databaseSidebarItemTree(
        databaseSidebarRootItems(sortedItems, sortedItems),
        sortedItems,
      ),
    ).toMatchObject([
      {
        item: { document: { id: "parent" } },
        children: [{ item: { document: { id: "child" } } }],
      },
    ]);
  });

  it("does not promote a matching child when its existing parent is filtered out", () => {
    const parent = item("parent", "Parent");
    const child = item("child", "Matching child", "parent");

    expect(databaseSidebarRootItems([child], [parent, child])).toEqual([]);
  });

  it("keeps a true orphan visible as a root", () => {
    const orphan = item("orphan", "Orphan", "deleted-parent");

    expect(databaseSidebarRootItems([orphan], [orphan])).toEqual([orphan]);
  });

  it("does not promote a database row when its database page is in Files", () => {
    const databasePage = item("database-page", "Database");
    const databaseRow = item("row", "Database row", "database-page");
    databaseRow.document.databaseMembership = {
      databaseId: "database",
      databaseDocumentId: "database-page",
      databaseTitle: "Database",
      position: 0,
    };

    expect(
      databaseSidebarRootItems(
        [databaseRow, databasePage],
        [databaseRow, databasePage],
      ).map((candidate) => candidate.document.id),
    ).toEqual(["database-page"]);
  });

  it("reveals descendants only after their parent is explicitly expanded", async () => {
    const rootItem = item("parent", "Page one");
    const childItem = item("child", "Page two", "parent");
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MemoryRouter>
          <TooltipProvider>
            <DatabaseSidebarView
              groups={[
                {
                  id: "all",
                  label: "All pages",
                  items: [rootItem],
                  property: null,
                  value: "all",
                },
              ]}
              hierarchyItems={[rootItem, childItem]}
              grouped={false}
              isLoading={false}
              hasActiveConstraints={false}
              openPagesIn="full_page"
              noMatchesLabel="No rows match this view"
              clearLabel="Clear"
              navigationLabel="Database pages"
              untitledLabel="Untitled"
              onClearResultConstraints={() => {}}
              onPreview={() => {}}
            />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('a[href="/page/child"]')).toBeNull();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Expand Page one"]')
        ?.click();
    });
    expect(container.querySelector('a[href="/page/child"]')).not.toBeNull();

    await act(async () => root.unmount());
  });

  it("does not reinsert descendants excluded by a Files filter", () => {
    const parent = item("parent", "Parent");
    const child = item("child", "Child", "parent");
    const matchingSibling = item("matching", "Matching");
    const data = {
      database: {
        viewConfig: {
          version: 1,
          activeViewId: "default",
          views: [
            {
              id: "default",
              name: "Table",
              type: "table",
              filters: [
                {
                  key: "name",
                  label: "Name",
                  operator: "contains",
                  value: "ing",
                },
              ],
              sorts: [],
              filterMode: "and",
            },
          ],
        },
      },
      items: [parent, child, matchingSibling],
      properties: [
        {
          definition: { id: "parent", systemRole: "files_parent" },
        },
      ],
    } as unknown as ContentDatabaseResponse;

    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TooltipProvider>
          <ContentFilesSidebarView
            data={data}
            overrides={null}
            isLoading={false}
            labels={{
              noMatchesLabel: "No matches",
              clearLabel: "Clear",
              navigationLabel: "Files",
              untitledLabel: "Untitled",
            }}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );

    expect(markup).toContain("Matching");
    expect(markup).not.toContain(">Parent<");
    expect(markup).not.toContain(">Child<");
  });

  it("does not promote a matching child whose parent is filtered out", () => {
    const parent = item("parent", "Parent");
    const child = item("child", "Matching child", "parent");
    const data = {
      database: {
        viewConfig: {
          version: 1,
          activeViewId: "default",
          views: [
            {
              id: "default",
              name: "Table",
              type: "table",
              filters: [
                {
                  key: "name",
                  label: "Name",
                  operator: "contains",
                  value: "Matching",
                },
              ],
              sorts: [],
              filterMode: "and",
            },
          ],
        },
      },
      items: [parent, child],
      properties: [
        {
          definition: { id: "parent", systemRole: "files_parent" },
        },
      ],
    } as unknown as ContentDatabaseResponse;

    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TooltipProvider>
          <ContentFilesSidebarView
            data={data}
            overrides={null}
            isLoading={false}
            labels={{
              noMatchesLabel: "No matches",
              clearLabel: "Clear",
              navigationLabel: "Files",
              untitledLabel: "Untitled",
            }}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );

    expect(markup).not.toContain("Matching child");
  });

  it("lets a saved database view render workspace roots inside its groups", () => {
    const groups = [
      {
        id: "team",
        label: "Team",
        items: [item("workspace", "Builder.io")],
        property: null,
        value: "team",
      },
    ] as DatabaseBoardGroup[];
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <DatabaseSidebarView
          groups={groups}
          grouped
          scroll={false}
          isLoading={false}
          hasActiveConstraints={false}
          openPagesIn="full_page"
          noMatchesLabel="No workspaces"
          clearLabel="Clear"
          navigationLabel="Content navigation"
          untitledLabel="Untitled"
          onClearResultConstraints={() => {}}
          onPreview={() => {}}
          renderItem={(workspace) => (
            <button type="button">{workspace.document.title} files</button>
          )}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain("Team");
    expect(markup).toContain("Builder.io files");
    expect(markup).not.toContain('href="/page/workspace"');
  });

  it("explains when a saved workspace filter hides every root", () => {
    const data = {
      database: {
        viewConfig: {
          version: 1,
          activeViewId: "filtered",
          views: [
            {
              id: "filtered",
              name: "Filtered",
              type: "sidebar",
              filters: [
                {
                  id: "missing",
                  key: "name",
                  label: "Name",
                  operator: "contains",
                  value: "Missing",
                },
              ],
              sorts: [],
              filterMode: "and",
            },
          ],
        },
      },
      items: [item("workspace", "Builder.io")],
      properties: [],
    } as unknown as ContentDatabaseResponse;
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ContentFilesSidebarView
          data={data}
          overrides={null}
          isLoading={false}
          labels={{
            noMatchesLabel: "No workspaces match this view",
            clearLabel: "Show all",
            navigationLabel: "Content navigation",
            untitledLabel: "Untitled",
          }}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain("No workspaces match this view");
    expect(markup).toContain("Show all");
    expect(markup).not.toContain("Builder.io");
  });

  it("lets the Files sidebar intercept a workspace reference row", async () => {
    const onOpenItem = vi.fn(() => true);
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MemoryRouter>
          <DatabaseSidebarView
            groups={[
              {
                id: "all",
                label: "All pages",
                items: [item("workspace", "Builder.io")],
                property: null,
                value: "all",
              },
            ]}
            grouped={false}
            isLoading={false}
            hasActiveConstraints={false}
            openPagesIn="full_page"
            noMatchesLabel="No rows match this view"
            clearLabel="Clear"
            navigationLabel="Database pages"
            untitledLabel="Untitled"
            onClearResultConstraints={() => {}}
            onPreview={() => {}}
            onOpenItem={onOpenItem}
          />
        </MemoryRouter>,
      );
    });

    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    await act(async () => {
      container.querySelector("a")?.dispatchEvent(click);
    });

    expect(onOpenItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: "item-workspace" }),
    );
    expect(click.defaultPrevented).toBe(true);

    await act(async () => root.unmount());
  });

  it("leaves modified row clicks to the native link", async () => {
    const onOpenItem = vi.fn(() => true);
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MemoryRouter>
          <DatabaseSidebarView
            groups={[
              {
                id: "all",
                label: "All pages",
                items: [item("workspace", "Builder.io")],
                property: null,
                value: "all",
              },
            ]}
            grouped={false}
            isLoading={false}
            hasActiveConstraints={false}
            openPagesIn="full_page"
            noMatchesLabel="No rows match this view"
            clearLabel="Clear"
            navigationLabel="Database pages"
            untitledLabel="Untitled"
            onClearResultConstraints={() => {}}
            onPreview={() => {}}
            onOpenItem={onOpenItem}
          />
        </MemoryRouter>,
      );
    });

    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      metaKey: true,
    });
    await act(async () => {
      container.querySelector("a")?.dispatchEvent(click);
    });

    expect(onOpenItem).not.toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(false);
    await act(async () => root.unmount());
  });

  it("restores contextual more and add-child controls for Files rows", () => {
    const markup = renderToStaticMarkup(
      <AgentNativeI18nProvider
        initialLocale="en-US"
        persistPreference={false}
        catalog={{
          sourceLocale: "en-US",
          messages: {
            sidebar: {
              moreActionsFor: "More actions for {{label}}",
              addChildTo: "Add child to {{title}}",
            },
          },
        }}
      >
        <MemoryRouter>
          <TooltipProvider>
            <DatabaseSidebarView
              groups={[
                {
                  id: "all",
                  label: "All pages",
                  items: [
                    {
                      ...item("page", "Project"),
                      document: {
                        ...item("page", "Project").document,
                        canEdit: true,
                        canManage: true,
                      },
                    },
                  ],
                  property: null,
                  value: "all",
                },
              ]}
              grouped={false}
              isLoading={false}
              hasActiveConstraints={false}
              openPagesIn="full_page"
              noMatchesLabel="No rows match this view"
              clearLabel="Clear"
              navigationLabel="Database pages"
              untitledLabel="Untitled"
              onClearResultConstraints={() => {}}
              onPreview={() => {}}
              onCreateChildPage={() => {}}
              onCreateChildDatabase={() => {}}
              onDeleteItem={() => {}}
              onToggleFavorite={() => {}}
            />
          </TooltipProvider>
        </MemoryRouter>
      </AgentNativeI18nProvider>,
    );

    expect(markup).toContain('aria-label="More actions for Project"');
    expect(markup).toContain('aria-label="Add child to');
    expect(markup).toContain("group-hover:opacity-100");
    expect(markup).toContain("pointer-events-none");
    expect(markup).toContain("group-hover:pointer-events-auto");
    expect(markup).not.toContain("shadow-sm");
  });

  it("keeps the viewer add-child slot disabled beside the personal pin action", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onToggleFavorite = vi.fn();
    const onCreateChildPage = vi.fn();
    const onCreateChildDatabase = vi.fn();

    await act(async () => {
      root.render(
        <MemoryRouter>
          <TooltipProvider>
            <DatabaseSidebarView
              groups={[
                {
                  id: "all",
                  label: "All pages",
                  items: [
                    {
                      ...item("shared", "Shared page"),
                      document: {
                        ...item("shared", "Shared page").document,
                        accessRole: "viewer",
                        canEdit: false,
                        canManage: false,
                      },
                    },
                  ],
                  property: null,
                  value: "all",
                },
              ]}
              grouped={false}
              isLoading={false}
              hasActiveConstraints={false}
              openPagesIn="full_page"
              noMatchesLabel="No rows match this view"
              clearLabel="Clear"
              navigationLabel="Database pages"
              untitledLabel="Untitled"
              onClearResultConstraints={() => {}}
              onPreview={() => {}}
              onCreateChildPage={onCreateChildPage}
              onCreateChildDatabase={onCreateChildDatabase}
              onDeleteItem={() => {}}
              onToggleFavorite={onToggleFavorite}
            />
          </TooltipProvider>
        </MemoryRouter>,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="More actions for Shared page"]',
    );
    expect(trigger).toBeTruthy();
    expect(
      container.querySelectorAll('button[aria-haspopup="menu"]'),
    ).toHaveLength(1);
    const addChild = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add child to Shared page"]',
    );
    if (!trigger || !addChild) {
      throw new Error("Expected aligned viewer sidebar controls");
    }
    expect(addChild.disabled).toBe(true);
    expect(addChild.className).toContain("size-6");
    expect(addChild.className).toContain("text-muted-foreground/50");
    expect(trigger.compareDocumentPosition(addChild)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    addChild.focus();
    addChild.click();
    addChild.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
    );
    addChild.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: " " }),
    );
    expect(document.activeElement).not.toBe(addChild);
    expect(onCreateChildPage).not.toHaveBeenCalled();
    expect(onCreateChildDatabase).not.toHaveBeenCalled();

    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
      await Promise.resolve();
    });

    const menuItems = Array.from(
      document.querySelectorAll<HTMLElement>("[role=menuitem]"),
    );
    expect(menuItems.map((menuItem) => menuItem.textContent?.trim())).toEqual([
      "Pin to sidebar",
    ]);

    await act(async () => {
      menuItems[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(onToggleFavorite).toHaveBeenCalledOnce();
    expect(onToggleFavorite).toHaveBeenCalledWith(
      expect.objectContaining({
        document: expect.objectContaining({ id: "shared" }),
      }),
    );

    act(() => root.unmount());
    container.remove();
  });
});
