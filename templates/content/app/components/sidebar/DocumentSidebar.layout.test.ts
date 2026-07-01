import { readFileSync } from "node:fs";

import type { DocumentTreeNode } from "@shared/api";
import { describe, expect, it } from "vitest";

import { getDocumentSidebarIconKind } from "./DocumentTreeItem";

function readSidebarSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function treeNode(
  overrides: Partial<Pick<DocumentTreeNode, "icon" | "database">> = {},
): Pick<DocumentTreeNode, "icon" | "database"> {
  return {
    icon: null,
    database: undefined,
    ...overrides,
  };
}

describe("document sidebar layout", () => {
  it("keeps deeply nested page rows reachable in the sidebar", () => {
    const layout = readSidebarSource("../layout/Layout.tsx");
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const treeItem = readSidebarSource("./DocumentTreeItem.tsx");
    const scrollArea = readSidebarSource("../ui/scroll-area.tsx");

    expect(layout).toContain("const MIN_SIDEBAR_WIDTH = 240");
    expect(sidebar).toContain('className="min-w-full w-max py-2 pe-2"');
    expect(treeItem).toContain("const indent = depth * 12 + 12");
    expect(treeItem).toContain("min-w-56");
    expect(scrollArea).toContain('<ScrollBar orientation="horizontal" />');
  });

  it("gates page tree actions by document capabilities", () => {
    const treeItem = readSidebarSource("./DocumentTreeItem.tsx");

    expect(treeItem).toContain("const canEdit = node.canEdit !== false");
    expect(treeItem).toContain("const canManage =");
    expect(treeItem).toContain("{canEdit && (");
    expect(treeItem).toContain("{canManage && (");
  });

  it("keeps hovered page row actions readable on inactive rows", () => {
    const treeItem = readSidebarSource("./DocumentTreeItem.tsx");

    expect(treeItem).toContain("hover:bg-accent hover:text-foreground");
    expect(treeItem).toContain("pointer-events-none");
    expect(treeItem).toContain("group-focus-within:opacity-100");
    expect(treeItem).toContain('"bg-accent text-foreground"');
    expect(treeItem).toContain("More actions for");
    expect(treeItem).not.toContain("bg-inherit");
    expect(treeItem).not.toContain("hover:bg-accent/50");
    expect(treeItem).not.toContain("hover:bg-background/70");
    expect(treeItem).not.toContain("transition-opacity");
  });

  it("defaults database pages to the database icon before the page icon", () => {
    const treeItem = readSidebarSource("./DocumentTreeItem.tsx");
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const iconSource = treeItem.slice(
      treeItem.indexOf("export function getDocumentSidebarIconKind"),
      treeItem.indexOf("export function DocumentTreeItem"),
    );

    expect(treeItem).toContain("IconDatabase");
    expect(iconSource).toContain("if (document.database)");
    expect(iconSource.indexOf("if (document.database)")).toBeLessThan(
      iconSource.indexOf('return "page"'),
    );
    expect(sidebar).toContain("<DocumentSidebarIcon document={doc} />");
  });

  it("uses the database icon as the default for database pages", () => {
    const database = {
      id: "db_1",
      documentId: "doc_1",
      title: "Content calendar",
      viewConfig: {
        activeViewId: "default",
        views: [],
        sorts: [],
        filters: [],
        columnWidths: {},
      },
      createdAt: "2026-05-27T00:00:00.000Z",
      updatedAt: "2026-05-27T00:00:00.000Z",
    };

    expect(
      getDocumentSidebarIconKind(
        treeNode({
          database,
        }),
      ),
    ).toBe("database");
    expect(
      getDocumentSidebarIconKind(treeNode({ icon: "   ", database })),
    ).toBe("database");
    expect(getDocumentSidebarIconKind(treeNode())).toBe("page");
  });

  it("keeps active ancestor expansion separate from user-expanded state", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");

    expect(sidebar).toContain("const activeAncestorIds = useMemo");
    expect(sidebar).toContain(
      "for (const id of activeAncestorIds) expandedIds.add(id)",
    );
    expect(sidebar).toContain("if (activeAncestorIds.has(id)) return");
  });

  it("keeps sidebar create actions split between pages and databases", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const treeItem = readSidebarSource("./DocumentTreeItem.tsx");
    const messages = readSidebarSource("../../i18n-data.ts");

    expect(sidebar).toContain("useCreateContentDatabase(null)");
    expect(sidebar).toContain("const handleCreateDatabase = useCallback");
    expect(sidebar).toContain("parentId: parentId ?? null");
    expect(sidebar).toContain("navigateToDocument(result.database.documentId)");
    expect(sidebar).toContain("const renderNewButton = () => (");
    expect(sidebar).toContain("const renderCollapsedNewButton = () => (");
    expect(sidebar).toContain('t("sidebar.new")');
    expect(sidebar).toContain('t("sidebar.page")');
    expect(sidebar).toContain('t("sidebar.database")');
    expect(sidebar).not.toContain("const renderNewPageButton = () => (");

    expect(treeItem).toContain("onCreateChildPage");
    expect(treeItem).toContain("onCreateChildDatabase");
    expect(treeItem).toContain('t("sidebar.addChild")');
    expect(treeItem).toContain('t("sidebar.page")');
    expect(treeItem).toContain('t("sidebar.database")');
    expect(treeItem).not.toContain("onCreateChild: (parentId: string)");

    expect(messages).toContain('new: "New"');
    expect(messages).toContain('page: "Page"');
    expect(messages).toContain('database: "Database"');
    expect(messages).toContain(
      'failedCreateDatabase: "Failed to create database"',
    );
  });

  it("keeps the trashed inline database lifecycle visible in the sidebar", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const messages = readSidebarSource("../../i18n-data.ts");

    expect(sidebar).toContain("useTrashedContentDatabases");
    expect(sidebar).toContain("useDeleteContentDatabase");
    expect(sidebar).toContain("useRestoreContentDatabase");
    expect(sidebar).toContain("const trashItems =");
    expect(sidebar).toContain("const handleRestoreDatabase = useCallback");
    expect(sidebar).toContain(
      "const handlePermanentDeleteDatabase = useCallback",
    );
    expect(sidebar).toContain("const renderTrashSection = () =>");
    expect(sidebar).toContain(
      'renderSectionHeader("trash", t("sidebar.trash"))',
    );
    expect(sidebar).toContain("handleRestoreDatabase(database.databaseId)");
    expect(sidebar).toContain("handlePermanentDeleteDatabase");
    expect(sidebar).toContain("database.documentId");
    expect(sidebar).toContain("database.canPermanentlyDelete");
    expect(sidebar).toContain("deletedDocument?.database");
    expect(sidebar).toContain("deleteContentDatabase.mutateAsync");
    expect(sidebar).toContain("databaseId: deletedDocument.database.id");
    expect(sidebar).toContain('t("sidebar.restoreDatabase")');
    expect(sidebar).toContain('t("sidebar.deletePermanently")');
    expect(sidebar).toContain("{renderTrashSection()}");

    expect(messages).toContain('trash: "Trash"');
    expect(messages).toContain('restoreDatabase: "Restore"');
    expect(messages).toContain(
      'deleteDatabasePermanentlyQuestion: "Delete database permanently?"',
    );
    expect(messages).toContain(
      'failedRestoreDatabase: "Failed to restore database"',
    );
  });

  it("keeps local files above extensions and gates the dev database link to Code mode", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");

    // The dev-only "Database admin" link must never render for normal users;
    // it is allowed only behind the Code mode gate.
    expect(sidebar).toContain("isCodeMode ? <DevDatabaseLink");
    expect(sidebar.indexOf("{renderLocalFilesNavButton()}")).toBeLessThan(
      sidebar.indexOf("<ExtensionsSidebarSection />"),
    );
  });

  it("keeps favorite rows constrained so long titles ellipsize", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");

    expect(sidebar).toContain("const favoriteRowWidth =");
    expect(sidebar).toContain("{showFavorites && (");
    expect(sidebar).toContain('"mb-2 min-w-0"');
    expect(sidebar).toContain(
      '"flex w-full min-w-0 items-center gap-2 rounded-md px-4 py-[5px] text-start text-sm"',
    );
    expect(sidebar).toContain("width:");
    expect(sidebar).toContain('"min-w-0 flex-1 truncate"');
    expect(sidebar).not.toContain("!localFileMode && favorites.length > 0");
  });
});
