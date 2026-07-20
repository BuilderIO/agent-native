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
  it("keeps deeply nested page rows within the sidebar viewport", () => {
    const layout = readSidebarSource("../layout/Layout.tsx");
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const treeItem = readSidebarSource("./DocumentTreeItem.tsx");

    expect(layout).toContain("const MIN_SIDEBAR_WIDTH = 240");
    expect(sidebar).toContain(
      "[&_[data-radix-scroll-area-viewport]]:!overflow-x-hidden",
    );
    expect(sidebar).toContain('className="w-full min-w-0 py-2 pe-2"');
    expect(sidebar).not.toContain("w-max");
    expect(treeItem).toContain("const indent = depth * 12 + 12");
    expect(treeItem).toContain("min-w-0");
  });

  it("keeps row actions inside the visible sidebar at narrow widths", () => {
    const treeItem = readSidebarSource("./DocumentTreeItem.tsx");
    const rowWidthBlock = treeItem.slice(
      treeItem.indexOf("const rowWidth ="),
      treeItem.indexOf("const {", treeItem.indexOf("const rowWidth =")),
    );

    expect(treeItem).toContain(": Math.max(0, sidebarWidth - 8)");
    expect(rowWidthBlock).not.toContain("Math.max(224");
    expect(rowWidthBlock).not.toContain("+ depth * 12");
    expect(treeItem).toContain("absolute right-1 top-1/2");
    expect(treeItem).toContain(
      "group-focus-within:pointer-events-auto group-focus-within:opacity-100",
    );

    const sidebarWidth = 180;
    const rowWidth = Math.max(0, sidebarWidth - 8);
    const actionsRightEdge = rowWidth - 4;

    expect(rowWidth).toBeLessThanOrEqual(sidebarWidth);
    expect(actionsRightEdge).toBeLessThanOrEqual(sidebarWidth);
  });

  it("uses one sidebar surface for collapsed and expanded rails", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");

    expect(sidebar).toContain(
      "agent-layout-left-drawer flex h-full w-12 flex-col",
    );
    expect(sidebar).toContain(
      "agent-layout-left-drawer relative flex h-full min-h-0 flex-col",
    );
    expect(sidebar).toContain("bg-sidebar");
    expect(sidebar).not.toContain("bg-muted/30");
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

  it("scopes sidebar creation to the selected Content space", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const treeItem = readSidebarSource("./DocumentTreeItem.tsx");
    const messages = readSidebarSource("../../i18n-data.ts");

    expect(sidebar).toContain("useContentSpaces()");
    expect(sidebar).toContain("selectedSpace?.id");
    expect(sidebar).toContain("spaceId: parentId ? undefined : rootSpaceId");
    expect(sidebar).toContain("const handleCreatePageInSpace = useCallback");
    expect(sidebar).toContain(
      "const renderNewButton = (space = selectedSpace) =>",
    );
    expect(sidebar).toContain("const renderCollapsedNewButton = () =>");
    expect(sidebar).toContain('t("sidebar.newPage")');
    expect(sidebar).not.toContain(
      "onClick={() => void handleCreateDatabase(null)}",
    );

    expect(treeItem).toContain("onCreateChildPage");
    expect(treeItem).toContain("onCreateChildDatabase");
    expect(treeItem).toContain('t("sidebar.addChild")');
    expect(treeItem).toContain('t("sidebar.page")');
    expect(treeItem).toContain('t("sidebar.database")');
    expect(treeItem).not.toContain("onCreateChild: (parentId: string)");

    expect(messages).toContain('workspaces: "Workspaces"');
    expect(messages).toContain('files: "Files"');
  });

  it("keeps independently expanded Files lists beneath their workspaces", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");

    expect(sidebar).toContain("aria-expanded={expanded}");
    expect(sidebar).toContain('"get-content-sidebar-state"');
    expect(sidebar).toContain('"update-content-sidebar-state"');
    expect(sidebar).toContain(
      "stored?.expandedWorkspaceIds ?? contentSpaces.map",
    );
    expect(sidebar).toContain("expandedDocumentIds={expandedDocumentIdSet}");
    expect(sidebar).toContain("toggleExpandedWorkspaceIds(current, space.id)");
    expect(sidebar).toContain("ensureWorkspaceExpanded(current, space.id)");
    expect(sidebar).not.toContain(
      "if (!selectedSpace || !sidebarStateHydratedRef.current) return",
    );
    expect(sidebar).toContain("createContentSidebarStateWriteQueue");
    expect(sidebar).toContain(
      '"group/workspace-header flex h-7 w-full min-w-0 items-center rounded-md"',
    );
    expect(sidebar).toContain("group-hover/workspace-header:opacity-100");
    expect(sidebar).toContain(
      "group-focus-visible/workspace-toggle:opacity-100",
    );
    expect(sidebar).not.toContain(
      "group-focus-within/workspace-header:opacity-100",
    );
    expect(sidebar).not.toContain('className="group/workspace min-w-0"');
    expect(sidebar).toContain("{expanded && (");
    expect(sidebar).toContain("<WorkspaceFilesSection");
    expect(sidebar).toContain(
      'aria-label={`${t("sidebar.newPage")} — ${space.name}`}',
    );
    expect(sidebar).toContain("selected={selected}");
    expect(sidebar).toContain("onOpenItem={(item: ContentDatabaseItem) =>");
    expect(sidebar).toContain("void handleSelectContentSpace(space, null)");
    expect(sidebar).toContain(
      "await handleCreatePage(undefined, space.id, id, space.filesDatabaseId)",
    );
    expect(sidebar).toContain("activeDocumentId={activeDocumentId}");
    expect(sidebar).toContain("onCreateChildPage={(nextSpace, item) =>");
    expect(sidebar).toContain("onDeleteItem={(item) =>");
    expect(sidebar).toContain("onToggleFavorite={(item) =>");
    expect(sidebar).toContain(
      "applyOptimisticItemToContentDatabase(current, optimisticItem)",
    );
    expect(sidebar).not.toContain("<WorkspaceCreateMenu");
    expect(sidebar).toContain(
      "text-[10px] font-semibold uppercase tracking-wider",
    );
    expect(sidebar).toContain(
      'className="h-7 min-w-0 flex-1 truncate pe-2 text-start',
    );
    expect(sidebar).toContain(
      'className="mb-2 min-w-0 overflow-x-hidden px-2"',
    );
    expect(sidebar).not.toContain("{selected ? footer : null}");
    expect(sidebar).not.toContain('t("sidebar.workspaces")');
    expect(sidebar).not.toContain(
      '<div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">',
    );
    expect(sidebar).toContain(
      'import { OrgSwitcher } from "@agent-native/core/client/org";',
    );
    expect(sidebar).toContain("<OrgSwitcher reserveSpace />");
    expect(sidebar.indexOf("<ExtensionsSidebarSection />")).toBeLessThan(
      sidebar.indexOf("<OrgSwitcher reserveSpace />"),
    );
    expect(sidebar.indexOf("<OrgSwitcher reserveSpace />")).toBeLessThan(
      sidebar.indexOf("{/* Footer */}"),
    );
    expect(sidebar).toContain('t("sidebar.addWorkspace")');
    expect(sidebar).toContain("<WorkspaceSourceMenu");
    expect(sidebar).toContain("onCreated={handleWorkspaceCreated}");
    expect(sidebar).not.toContain("useCreateContentSpace");
    expect(sidebar).not.toContain("handleCreateWorkspace");
    expect(sidebar).toContain("workspaceCatalogDatabaseId");
    expect(sidebar).toContain("workspaceCatalogPersonalView.data?.overrides");
    expect(sidebar).toContain("renderItem={(item) =>");
    expect(sidebar).toContain("name: item.document.title || space.name");
    expect(sidebar).toContain("scroll={false}");
  });

  it("keeps a unified page and database Trash lifecycle visible in the sidebar", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const messages = readSidebarSource("../../i18n-data.ts");

    expect(sidebar).toContain("useTrashedContentDatabases");
    expect(sidebar).toContain("useTrashedDocuments");
    expect(sidebar).toContain("useDeleteContentDatabase");
    expect(sidebar).toContain("useRestoreContentDatabase");
    expect(sidebar).toContain("const trashItems =");
    expect(sidebar).toContain("const trashedPageItems =");
    expect(sidebar).toContain("const handleRestoreDocument = useCallback");
    expect(sidebar).toContain(
      "const handlePermanentDeleteDocument = useCallback",
    );
    expect(sidebar).toContain("const handleRestoreDatabase = useCallback");
    expect(sidebar).toContain(
      "const handlePermanentDeleteDatabase = useCallback",
    );
    expect(sidebar).toContain("const renderTrashSection = () =>");
    expect(sidebar).toContain("trash: true");
    expect(sidebar).toContain("value?.trash ?? true");
    expect(sidebar).toContain("TRASH_COLLAPSED_DEFAULT_MIGRATION_KEY");
    expect(sidebar).toContain('toggleSection("trash")');
    expect(sidebar).toContain("<IconTrash");
    expect(sidebar).toContain("group-hover/trash:opacity-0");
    expect(sidebar).toContain("group-hover/trash:opacity-100");
    expect(sidebar).toContain('className="px-2"');
    expect(sidebar).toContain("handleRestoreDatabase(database.databaseId)");
    expect(sidebar).toContain("handlePermanentDeleteDatabase");
    expect(sidebar).toContain("handleRestoreDocument(document.documentId)");
    expect(sidebar).toContain("handlePermanentDeleteDocument");
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
    expect(messages).toContain('restorePage: "Restore"');
    expect(messages).toContain('trashEmpty: "Trash is empty"');
    expect(messages).toContain(
      'deleteDatabasePermanentlyQuestion: "Delete database permanently?"',
    );
    expect(messages).toContain(
      'failedRestoreDatabase: "Failed to restore database"',
    );
  });

  it("removes the standalone Local files destination and gates the dev database link to Code mode", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");

    // The dev-only "Database admin" link must never render for normal users;
    // it is allowed only behind the Code mode gate.
    expect(sidebar).toContain("isCodeMode ? <DevDatabaseLink");
    expect(sidebar).not.toContain("renderLocalFilesNavButton");
    expect(sidebar).not.toContain('to="/local-files"\n              className');
  });

  it("persists tree section collapse state and exposes local file actions", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const localFilesRoute = readSidebarSource(
      "../../routes/_app.local-files.tsx",
    );
    const messages = readSidebarSource("../../i18n-data.ts");
    const agents = readSidebarSource("../../../AGENTS.md");

    expect(sidebar).toContain("useLocalStorage");
    expect(sidebar).toContain("content-sidebar-collapsed-sections");
    expect(sidebar).toContain("normalizeCollapsedSections");
    expect(sidebar).toContain("renderLocalFilesSectionActions");
    expect(sidebar).toContain('t("sidebar.localFilesActions")');
    expect(sidebar).toContain('t("sidebar.manageLocalFolders")');
    expect(sidebar).toContain('t("sidebar.removeLocalFilesFromSidebar")');
    expect(sidebar).toContain('"remove-local-file-source"');
    expect(sidebar).toContain("setRemoveLocalFilesDialogOpen(true)");
    expect(localFilesRoute).toContain("localSourceDirectoriesFromDocuments");
    expect(localFilesRoute).toContain("useDocuments()");
    expect(localFilesRoute).toContain('"remove-local-file-source"');
    expect(localFilesRoute).toContain('t("localFiles.importedFiles"');
    expect(localFilesRoute).toContain('t("localFiles.remove")');
    expect(messages).toContain('localFilesActions: "Local files actions"');
    expect(messages).toContain('manageLocalFolders: "Manage folders"');
    expect(messages).toContain('importedSource: "Imported source"');
    expect(agents).toContain("remove-local-file-source");
  });

  it("keeps favorite rows constrained so long titles ellipsize", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const treeItem = readSidebarSource("./DocumentTreeItem.tsx");

    expect(sidebar).toContain("const favoriteRowWidth =");
    expect(sidebar).toContain("{showFavorites && (");
    expect(sidebar).toContain('toggleSection("favorites")');
    expect(sidebar).toContain("!collapsedSections.favorites &&");
    expect(sidebar).toContain("aria-expanded={!collapsedSections.favorites}");
    expect(sidebar).toContain("<IconStar");
    expect(sidebar).toContain("group-hover/favorites:opacity-0");
    expect(sidebar).toContain("group-hover/favorites:opacity-100");
    expect(sidebar).toContain('!collapsedSections.favorites && "rotate-90"');
    expect(sidebar).toContain('"mb-2 min-w-0 px-2"');
    expect(sidebar).toContain("favoritesDocumentId");
    expect(sidebar).toContain("`/page/${favoritesDocumentId}`");
    expect(sidebar).toContain("handleOpenFavorite(doc)");
    expect(sidebar).toContain("<FavoriteDocumentItem");
    expect(treeItem).toContain("export function FavoriteDocumentItem");
    expect(sidebar).toContain(
      "flex h-7 w-full min-w-0 items-center rounded-md px-1",
    );
    expect(treeItem).toContain('paddingInlineStart: "26px"');
    expect(treeItem).toContain('? "font-semibold text-foreground"');
    expect(treeItem).not.toContain(
      '"border-primary bg-accent font-medium text-accent-foreground"',
    );
    expect(treeItem).toContain("Remove from favorites");
    expect(treeItem).toContain("aria-label={`Open ${title}`}");
    expect(treeItem).toContain("onClick={(event) => event.stopPropagation()}");
    expect(treeItem).toContain("onCreateChildPage()");
    expect(treeItem).toContain("setDeleteDialogOpen(true)");
    expect(sidebar).not.toContain("!localFileMode && favorites.length > 0");
  });

  it("routes Favorites into its provisioned full database page", () => {
    const route = readSidebarSource("../../routes/_app.favorites.tsx");

    expect(route).toContain("useContentSpaces()");
    expect(route).toContain("favoritesDocumentId");
    expect(route).toContain("<Navigate");
    expect(route).toContain("`/page/${documentId}`");
  });
});
