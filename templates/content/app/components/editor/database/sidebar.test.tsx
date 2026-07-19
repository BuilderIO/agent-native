// @vitest-environment happy-dom

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
  databaseSidebarRows,
} from "./sidebar";
import type { DatabaseBoardGroup } from "./types";

const item = (id: string, title: string) =>
  ({
    id: `item-${id}`,
    databaseId: "database",
    document: {
      id,
      parentId: null,
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
  it("keeps grouped rows in their filtered and sorted group order", () => {
    const groups = [
      { id: "todo", label: "Todo", items: [item("first", "First")] },
      { id: "done", label: "Done", items: [item("second", "Second")] },
    ] as DatabaseBoardGroup[];

    expect(
      databaseSidebarRows(groups).map((candidate) => candidate.id),
    ).toEqual(["item-first", "item-second"]);
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
            loadingLabel="Loading list"
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
          loadingLabel="Loading workspaces"
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
            loadingLabel: "Loading workspaces",
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
            loadingLabel="Loading list"
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

  it("restores contextual more and add-child controls for Files rows", () => {
    const markup = renderToStaticMarkup(
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
            loadingLabel="Loading list"
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
      </MemoryRouter>,
    );

    expect(markup).toContain('aria-label="More actions for Project"');
    expect(markup).toContain('aria-label="Add child to');
    expect(markup).toContain("group-hover:opacity-100");
    expect(markup).not.toContain("pointer-events-none");
    expect(markup).not.toContain("shadow-sm");
  });
});
