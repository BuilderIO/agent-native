import type { ContentTrashItem } from "@shared/content-trash";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  DatabaseTableColumnOrder,
  DatabaseTableLayout,
} from "@/components/editor/database/DatabaseTableGrid";

import { TRASH_TABLE_COLUMNS, TrashRow, TrashTableHeader } from "./TrashRow";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({ formatDate: () => "Sep 14, 2026" }),
}));
vi.mock("react-router", () => ({
  Link: ({ children, ...props }: React.ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
}));
vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: (props: React.ComponentProps<"button">) => <button {...props} />,
}));

const item = {
  documentId: "page-1",
  databaseId: null,
  legacyRestoreDatabaseId: null,
  title: "Page",
  kind: "page",
  createdByState: "unresolved",
  updatedByState: "unresolved",
  trashedAt: "2026-09-14T00:00:00.000Z",
  trashedBy: null,
  trashedByState: "unresolved",
  trashOrigin: null,
  trashRootId: "page-1",
  parentId: null,
  parentTitle: null,
  spaceId: "space-1",
  spaceName: "Space",
  canRestore: true,
  canPermanentlyDelete: true,
  hasAccessibleTrashedChildren: false,
} satisfies ContentTrashItem;

function renderRow(row: ContentTrashItem) {
  return renderToStaticMarkup(
    <DatabaseTableLayout.Provider
      value={{ frozenThroughColumnId: "name", viewportWidth: 1280 }}
    >
      <DatabaseTableColumnOrder.Provider value={TRASH_TABLE_COLUMNS}>
        <TrashRow
          item={row}
          selected={false}
          expanded={false}
          onSelect={() => {}}
          onToggle={() => {}}
          onOpen={() => {}}
          focused
          rowRef={() => {}}
          onFocus={() => {}}
          onKeyDown={() => {}}
        />
      </DatabaseTableColumnOrder.Provider>
    </DatabaseTableLayout.Provider>,
  );
}

describe("TrashRow responsive expander contract", () => {
  it("renders aligned sortable table headers", () => {
    const html = renderToStaticMarkup(
      <DatabaseTableLayout.Provider
        value={{ frozenThroughColumnId: "name", viewportWidth: 1280 }}
      >
        <DatabaseTableColumnOrder.Provider value={TRASH_TABLE_COLUMNS}>
          <TrashTableHeader
            checked={false}
            sort="deletedAt"
            direction="desc"
            onSelectLoaded={() => {}}
            onSort={() => {}}
          />
        </DatabaseTableColumnOrder.Provider>
      </DatabaseTableLayout.Provider>,
    );
    expect(html).toContain('role="columnheader"');
    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain('data-table-column="createdBy"');
    expect(html).toContain('data-table-freeze-boundary=""');
  });

  it("uses explicit table tracks with a sticky selection gutter and Name", () => {
    const html = renderRow({
      ...item,
      createdByState: "known",
      updatedByState: "known",
      trashedByState: "known",
      createdByName: "Creator",
      updatedByName: "Editor",
      trashedByName: "Deleter",
    });

    expect(html).toContain(
      "grid-template-columns:44px 240px 180px 180px 180px 150px",
    );
    expect(html).toContain("data-table-selection-gutter");
    expect(html).toContain("sticky start-0");
    expect(html).toContain('data-table-column="name"');
    expect(html).toContain('data-table-frozen=""');
    expect(html).toContain('style="inset-inline-start:44px"');
    expect(html).toContain('data-table-column="createdBy"');
    expect(html).toContain('data-table-column="updatedBy"');
    expect(html).toContain('data-table-column="deletedBy"');
    expect(html).toContain('data-table-column="deletedAt"');
    expect(html).toContain(
      'class="grid min-w-0 items-center border-r border-border/35',
    );
    expect(html).toContain("flex h-full items-center truncate px-3");
    expect(html).toContain("Creator");
    expect(html).toContain("Editor");
    expect(html).toContain("Deleter");
    expect(html).toContain("block truncate text-sm font-medium");
    expect(html).toContain("group group/trash-row");
    expect(html).toContain("group-hover:opacity-100");
  });

  it("distinguishes named, known, and unresolved actors without exposing IDs", () => {
    const html = renderRow({
      ...item,
      createdBy: "creator@example.test",
      createdByName: null,
      updatedBy: null,
      updatedByName: null,
      trashedBy: "deleter@example.test",
      trashedByName: "Display name",
    });

    expect(html).toContain("trash.knownActor");
    expect(html).toContain("trash.unresolvedActor");
    expect(html).toContain("Display name");
    expect(html).not.toContain("creator@example.test");
    expect(html).not.toContain("deleter@example.test");
  });

  it("shows a parent chevron below lg and swaps from its icon on desktop", () => {
    const html = renderRow({ ...item, hasAccessibleTrashedChildren: true });

    expect(html).toContain("data-trash-row-expander");
    expect(html).toContain("opacity-100");
    expect(html).toContain("lg:opacity-0");
    expect(html).toContain("lg:group-hover/trash-row:opacity-100");
    expect(html).toContain(
      "opacity-0 lg:opacity-100 lg:group-hover/trash-row:opacity-0",
    );
  });

  it("renders no expander and leaves the icon visible for a leaf", () => {
    const html = renderRow(item);

    expect(html).not.toContain("data-trash-row-expander");
    expect(html).toContain("data-trash-row-icon");
    expect(html).not.toContain("opacity-0 lg:opacity-100");
  });
});
