import type { ContentDatabaseItem } from "@shared/api";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { DatabaseSidebarView, databaseSidebarRows } from "./sidebar";
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
        />
      </MemoryRouter>,
    );

    expect(markup).toContain('href="/page/page"');
    expect(markup).toContain("Project");
  });
});
