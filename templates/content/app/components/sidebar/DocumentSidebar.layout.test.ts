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
  it("gives the visible workspace plus button only root Page and Collection choices", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const selectorStart = sidebar.indexOf("const contentSpaceSelector");
    const selectorEnd = sidebar.indexOf("const feedbackButton", selectorStart);
    const selector = sidebar.slice(selectorStart, selectorEnd);
    const plusMenuStart = selector.lastIndexOf("<DropdownMenu>");
    const plusMenu = selector.slice(plusMenuStart);

    expect(plusMenu).toContain("<DropdownMenuTrigger asChild>");
    expect(plusMenu).toContain(
      'aria-label={`${t("sidebar.new")} — ${selectedSpace.name}`}',
    );
    expect(plusMenu).toContain("handleCreatePageInSpace(selectedSpace)");
    expect(plusMenu).toContain("handleCreateDatabaseInSpace(selectedSpace)");
    expect(plusMenu).toContain('{t("sidebar.page")}');
    expect(plusMenu).toContain('{t("sidebar.collection")}');
    expect(plusMenu).not.toContain("WorkspaceSourceMenu");
    expect(plusMenu).not.toContain('t("sidebar.newWorkspace")');
    expect(plusMenu).not.toContain('to="/local-files"');
  });

  it("keeps workspace switching and source creation in the workspace menu", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const selectorStart = sidebar.indexOf("const contentSpaceSelector");
    const selectorEnd = sidebar.indexOf("const feedbackButton", selectorStart);
    const selector = sidebar.slice(selectorStart, selectorEnd);

    expect(selector).toContain("<WorkspaceSourceMenu");
    expect(selector).toContain("menuStart={");
    expect(selector).toContain("<DropdownMenuRadioGroup");
    expect(selector).toContain("contentSpaces.map((space)");
    expect(selector).toContain("void handleSelectContentSpace(space)");
    expect(selector).toContain("onCreated={handleWorkspaceCreated}");
  });

  it("opens search from expanded and collapsed sidebar branches", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const collapsedBranchStart = sidebar.indexOf("if (collapsed)");
    const expandedBranchStart = sidebar.indexOf(
      "className={cn(",
      collapsedBranchStart,
    );

    expect(sidebar).toContain("openContentCommandMenu");
    expect(sidebar).toContain('t("sidebar.search")');
    expect(sidebar.slice(collapsedBranchStart, expandedBranchStart)).toContain(
      "{collapsedSearchButton}",
    );
    expect(sidebar.slice(expandedBranchStart)).toContain("{searchButton}");
  });

  it("keeps deeply nested page rows within the sidebar viewport", () => {
    const layout = readSidebarSource("../layout/Layout.tsx");
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const treeItem = readSidebarSource("./DocumentTreeItem.tsx");

    expect(layout).toContain("const MIN_SIDEBAR_WIDTH = 240");
    expect(sidebar).toContain(
      "[&_[data-radix-scroll-area-viewport]]:!overflow-x-hidden",
    );
    expect(sidebar).toContain('className="w-full min-w-0 py-2"');
    expect(sidebar).not.toContain("w-max");
    expect(treeItem).toContain("const indent = depth * 12 + 12");
    expect(treeItem).toContain("min-w-0");
  });

  it("does not highlight the current document in workspace trees while in Trash", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");

    expect(sidebar).toContain(
      'const sidebarActiveDocumentId = location.pathname.startsWith("/trash")',
    );
    expect(
      sidebar.match(/activeDocumentId=\{sidebarActiveDocumentId\}/g),
    ).toHaveLength(3);
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
      "agent-layout-left-drawer flex h-full w-14 flex-col",
    );
    expect(sidebar).toContain(
      "agent-layout-left-drawer relative flex h-full min-h-0 flex-col",
    );
    expect(sidebar).toContain("bg-sidebar");
    expect(sidebar).not.toContain("bg-muted/30");
  });

  it("keeps collapsed footer actions at the bottom of the rail", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const collapsedBranchStart = sidebar.indexOf("if (collapsed)");
    const collapsedReturn = sidebar.indexOf("return (", collapsedBranchStart);
    const expandedReturn = sidebar.indexOf("\n  return (", collapsedReturn + 1);
    const collapsedBranch = sidebar.slice(collapsedBranchStart, expandedReturn);

    expect(collapsedBranch).toContain('className="mt-auto shrink-0 w-full"');
    expect(collapsedBranch).toContain("<AppSidebarFooter");
  });

  it("gates page tree actions by document capabilities", () => {
    const treeItem = readSidebarSource("./DocumentTreeItem.tsx");

    expect(treeItem).toContain("favoriteAvailable: true");
    expect(treeItem).toContain("{canFavorite && (");
    expect(treeItem).toContain("const canCreateChild = canEdit");
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
    const iconSource = treeItem.slice(
      treeItem.indexOf("export function getDocumentSidebarIconKind"),
      treeItem.indexOf("export function DocumentTreeItem"),
    );

    expect(treeItem).toContain("IconDatabase");
    expect(iconSource).toContain("if (document.database)");
    expect(iconSource.indexOf("if (document.database)")).toBeLessThan(
      iconSource.indexOf('return "page"'),
    );
    expect(treeItem).toContain("<DocumentSidebarIcon document={node} />");
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
  });

  it("keeps hosted sidebar reads bounded while isolating exhaustive local inventory", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const documentsHook = readSidebarSource("../../hooks/use-documents.ts");

    expect(sidebar).not.toContain("const documentsQuery = useDocuments();");
    expect(sidebar).toContain("useDocuments({ enabled: localFileMode })");
    expect(sidebar).toContain('"get-content-navigation-context"');
    expect(sidebar).toContain("limit: 50");
    expect(sidebar).not.toContain("limit: Math.max(contentSpaces.length, 1)");
    expect(sidebar).toContain("useContentSpaces()");
    expect(documentsHook).toContain("enabled: options?.enabled !== false");
  });

  it("does not keep a hidden sidebar search query field", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");

    expect(sidebar).not.toContain("setSearchQuery");
    expect(sidebar).not.toContain('placeholder={t("sidebar.search")}');
  });

  it("keeps one command-menu search launcher above the navigation scroller", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const layout = readSidebarSource("../layout/Layout.tsx");

    expect(sidebar).toContain("openContentCommandMenu");
    expect(sidebar).toContain("openCommandMenuFrom(searchTriggerRef.current)");
    expect(sidebar).toContain('{isMac ? "⌘ K" : "Ctrl K"}');
    expect(sidebar.indexOf("{searchButton}")).toBeLessThan(
      sidebar.indexOf('<ScrollArea className="min-h-0 flex-1'),
    );
    expect(sidebar).not.toContain("searchQuery");
    expect(sidebar).not.toContain("isSearching");
    expect(sidebar).not.toContain("filteredDocuments");
    expect(sidebar).not.toContain("search={searchButton}");
    expect(layout).toContain("openSearchAfterSidebarCloseRef");
    expect(layout).toContain("openContentCommandMenu(");
    expect(layout).toContain("sidebarTriggerRef.current ?? undefined");
  });

  it("reveals child destinations without concurrent rollback conflicts", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");

    expect(sidebar).toContain("const revealParentForCreation = useCallback");
    expect(sidebar).toContain("parentCreationRevealsRef");
    expect(sidebar).toContain("reveal.pendingCount += 1");
    expect(sidebar).toContain("current.keepExpanded ||= succeeded");
    expect(sidebar).toContain("settleParentExpansion(false)");
  });

  it("opens a new database immediately while persistence settles", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");

    expect(sidebar).toContain("const handleCreateDatabase = useCallback");
    expect(sidebar).toContain("newDocumentId: id");
    expect(sidebar).toContain("navigateToDocument(id)");
    expect(sidebar).toContain(
      "rollbackOptimisticCreatedDocument(\n          queryClient,\n          id",
    );
    expect(sidebar).toContain("navigate(previousPath, {");
    expect(sidebar).toContain(
      "if (window.location.pathname === `/page/${id}`)",
    );
    expect(sidebar).toContain(
      "pendingOptimisticCreationIdsRef.current.add(id)",
    );
    expect(sidebar).toContain("skipListDocumentsInvalidation: true");
    expect(sidebar).toContain("settleOptimisticListRefresh(id)");
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
      "const handleCreateDatabaseInSpace = useCallback",
    );
    expect(sidebar).toContain(
      "return handleSelectContentSpace(space, null, true);",
    );
    expect(sidebar).toContain(
      "explicitSpaceSelectionRef.current = previousExplicitSelection;",
    );
    expect(sidebar).toContain(
      "if (!(await selectSpaceForCreation(space))) return;",
    );
    expect(sidebar).toContain(
      "if (!(await selectSpaceForCreation(nextSpace))) return;",
    );
    expect(sidebar).toContain("const renderCollapsedNewButton = () =>");
    expect(sidebar).toContain('t("sidebar.new")');
    expect(sidebar).not.toContain(
      "onClick={() => void handleCreateDatabase(null)}",
    );

    expect(treeItem).toContain("onCreateChildPage");
    expect(treeItem).toContain("onCreateChildDatabase");
    expect(treeItem).toContain('t("sidebar.addChild")');
    expect(treeItem).toContain('t("sidebar.page")');
    expect(treeItem).toContain('t("sidebar.collection")');
    expect(treeItem).not.toContain("onCreateChild: (parentId: string)");

    expect(messages).toContain('workspaces: "Workspaces"');
    expect(messages).toContain('files: "Files"');
  });

  it("replaces an optimistic page with the persisted document before conversion", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");

    expect(sidebar).toContain("shouldCreateDocumentOptimistically({");
    expect(sidebar).toContain("filesDatabaseId: rootFilesDatabaseId");
    expect(sidebar).toContain("markDocumentCreationPending({");
    expect(sidebar).toContain(
      '["action", "get-document", { id: nextId }],\n          created',
    );
    expect(sidebar).toContain(
      "return withDocumentsCacheShape(old, [...docs, tempDoc])",
    );
    expect(sidebar).toContain("rollbackOptimisticCreatedDocument(");
  });

  it("restores deleted list and page snapshots before refetching on failure", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");

    expect(sidebar).toContain("const previousDocumentQueries =");
    expect(sidebar).toContain("restoreDeletedDocumentSnapshots(");
    expect(sidebar).toContain("previousDocumentQueries");
    expect(sidebar).toContain("navigate(previousPath, {");
  });

  it("renders one selected Content space with a shallow Files tree", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");

    expect(sidebar).toContain('"get-content-sidebar-state"');
    expect(sidebar).toContain('"update-content-sidebar-state"');
    expect(sidebar).toContain(
      "expandedDocumentIds={visibleExpandedDocumentIds}",
    );
    expect(sidebar).toContain(
      "new Set([...expandedDocumentIds, ...activeAncestorIds])",
    );
    expect(sidebar).toContain("createContentSidebarStateWriteQueue");
    expect(sidebar).toContain(
      'toast.error(t("sidebar.failedSaveSidebarState")',
    );
    expect(sidebar).toContain("<WorkspaceSidebarItem");
    expect(sidebar).toContain("compact={compact}");
    expect(sidebar).toContain('!compact && "ps-4"');
    expect(sidebar).toContain(
      "renderWorkspaceRoot(selectedSpace, undefined, true)",
    );
    expect(sidebar).toContain("value={selectedSpace.id}");
    expect(sidebar).toContain("contentSpaces.map((space)");
    expect(sidebar).not.toContain('<Link to="/favorites">');
    expect(sidebar).toContain(
      "pinned: `/favorites?spaceId=${encodeURIComponent(selectedSpace.id)}`",
    );
    expect(sidebar).toContain(
      "return handleSelectContentSpace(space, null, true)",
    );
    expect(sidebar).toContain(
      'import { OrgSwitcher } from "@agent-native/core/client/org";',
    );
    expect(sidebar).toContain("reserveSpace");
    expect(sidebar).toContain("<OrgSwitcher");
    expect(sidebar).not.toContain("<ExtensionsSidebarSection />");
    expect(sidebar).toContain("<AppSidebarFooter");
    expect(sidebar).toContain("<WorkspaceSourceMenu");
    expect(sidebar).toContain("menuStart={");
    expect(sidebar).toContain("onCreated={handleWorkspaceCreated}");
    expect(sidebar).toContain("scroll={false}");
  });

  it("never empties the Files tree while a deferred database read is paused", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const hooks = readSidebarSource("../../hooks/use-content-database.ts");

    // useDeferredFilesDatabaseId must keep returning the real databaseId
    // while paused (only `enabled` toggles) — swapping databaseId itself to
    // null moves the query to a disabled key with no cached rows and flashes
    // the tree empty for the whole deferred window (see the New page repro
    // in this file's other Files-tree tests).
    expect(sidebar).not.toContain(
      "return expanded && ready ? databaseId : null",
    );
    expect(sidebar).toContain(
      "return { databaseId: expanded ? databaseId : null, enabled: ready }",
    );
    expect(sidebar).toContain("deferredFilesDatabase.databaseId");
    expect(sidebar).toContain("enabled: deferredFilesDatabase.enabled");
    expect(sidebar).toContain('systemRole: "files"');
    expect(hooks).toContain(
      "isContentDatabaseByIdQueryEnabled(databaseId, options)",
    );
    expect(sidebar).toContain("const previouslyExpanded = useRef(false)");
  });

  it("waits for a selected Content space before mounting scoped sidebar queries", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const sections = readSidebarSource("./PersonalSidebarSections.tsx");

    expect(sidebar).toContain("contentSpaceActionArgs(selectedSpace?.id)");
    expect(sidebar).toContain("enabled: Boolean(sidebarStateArgs)");
    expect(sidebar).toContain("{selectedSpace ? (");
    expect(sidebar).toContain("spaceId={selectedSpace.id}");
    expect(sidebar).not.toContain("key={selectedSpace.id}");
    expect(sidebar).toContain('t("sidebar.contentSpace")');
    expect(sections).toContain("contentSpaceActionArgs(spaceId)");
    expect(sections).toContain("optimisticBySpace.get(spaceId)");
    expect(sections).toContain("queueBySpace.current.get(targetSpaceId)");
    expect(sections).toContain("pendingBySpace.current.get(targetSpaceId)");
    expect(sidebar).toContain("contentSpaceActionArgs(snapshot.spaceId)");
    expect(sidebar).toContain("lastSyncedSpaceIdRef.current");
    expect(sidebar).toContain(
      "workspaceSelectionQueueRef\n      .current(async () =>",
    );
    expect(sidebar).not.toContain("ensureWorkspaceExpanded(current, space.id)");
  });

  it("uses the full row width until right-side actions are revealed", () => {
    const databaseSidebar = readSidebarSource("../editor/database/sidebar.tsx");
    const rowActions = readSidebarSource("./SidebarRowActions.tsx");
    const reorder = readSidebarSource("./sidebar-reorder.tsx");

    // Revealed actions fade the title's end instead of re-truncating it.
    expect(rowActions).toContain(
      "group-hover:[mask-image:linear-gradient(to_left,transparent_3rem,#000_4rem)]",
    );
    expect(databaseSidebar).toContain(
      "sidebarRowTitleFadeClassName(hasMenuActions ? 2 : 1)",
    );
    expect(databaseSidebar).not.toContain("group-hover:pe-12");
    expect(databaseSidebar).not.toContain(
      '(hasMenuActions || canCreateChild) && "pe-12"',
    );
    expect(databaseSidebar).toContain(
      "data-sidebar-reorder-item-id={reorder?.controls.itemId}",
    );
    expect(databaseSidebar).toContain(
      '"touch-none cursor-pointer select-none"',
    );
    expect(databaseSidebar).toContain(
      'className="grid min-w-0 gap-0.5 overflow-x-hidden py-1 ps-1"',
    );
    // Nested rows keep the same 2px rhythm as roots.
    expect(databaseSidebar).toMatch(
      /key=\{navigationItem\.membershipId\}\s+className="grid min-w-0 gap-0\.5"/,
    );
    expect(rowActions).toContain("pointer-events-none absolute end-0 top-1/2");
    expect(databaseSidebar).toContain("<SidebarRowActions>");
    expect(reorder).toContain(
      'document.addEventListener("click", preventDraggedLinkNavigation, true)',
    );
    expect(reorder).toContain("event.preventDefault()");
  });

  it("links the unified Trash lifecycle from the sidebar", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const messages = readSidebarSource("../../i18n-data.ts");

    expect(sidebar).toContain("const renderTrashSection = () =>");
    expect(sidebar).toContain('to="/trash"');
    expect(sidebar).toContain('location.pathname.startsWith("/trash")');
    expect(sidebar).toContain("<IconTrash");
    expect(sidebar).toContain("{renderTrashSection()}");

    expect(messages).toContain('trash: "Trash"');
    expect(messages).toContain('restoreDatabase: "Restore"');
    expect(messages).toContain('restorePage: "Restore"');
    expect(messages).toContain('trashEmpty: "Trash is empty"');
    expect(messages).toContain(
      'deleteDatabasePermanentlyQuestion: "Delete collection permanently?"',
    );
    expect(messages).toContain(
      'failedRestoreDatabase: "Failed to restore collection"',
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
    expect(sidebar).toContain('t("sidebar.removeLocalFilesFromSidebar")');
    expect(sidebar).toContain('"remove-local-file-source"');
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

  it("renders Pinned through exact database memberships with accessible reordering", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const sections = readSidebarSource("./PersonalSidebarSections.tsx");
    const reorder = readSidebarSource("./sidebar-reorder.tsx");

    expect(sidebar).toContain("<PersonalSidebarSections");
    expect(sidebar).toContain("renderFiles={renderWorkspaceNavigation}");
    expect(sidebar).toContain("renderPinned={(limit) =>");
    expect(sections).toContain("sections[id].visible");
    expect(sections).toContain("expanded={sections[id].expanded}");
    expect(sections).toContain(
      "change(id, { expanded: !sections[id].expanded });",
    );
    expect(sections).toContain("aria-expanded={expanded}");
    expect(sections).toContain('expanded && "rotate-90"');
    expect(sections).not.toContain("IconGripVertical");
    expect(sections).toContain("onPointerDown={pointerDragListener}");
    expect(sections).toContain("onClick={onToggle}");
    expect(sections).toContain("grid-cols-[minmax(0,1fr)_auto]");
    expect(sections).toContain("grid-cols-[1.75rem_minmax(0,1fr)]");
    expect(sections).not.toContain("{...reorder.listeners}");
    expect(sections).toContain("data-sidebar-reorder-item-id={reorder.itemId}");
    expect(reorder).toContain("activationConstraint: { distance: 5 }");
    expect(sections).toContain("group-hover/toggle:opacity-0");
    expect(sections).toContain("group-focus-visible/toggle:opacity-100");
    expect(sections).toContain("<SidebarNavigationRow");
    expect(sections).toContain("renderPinned(limits.pinned)");
    // Show more / less share the row height and the rows' icon column.
    expect(sections).toContain("sidebarShowMoreClassName");
    expect(sections).toContain("grid-cols-[0.25rem_1.75rem_minmax(0,1fr)]");
    expect(sections).not.toContain("min-h-[38px]");
    expect(sections).toContain("text-muted-foreground");
    expect(sidebar).toContain("useContentDatabaseById(favoritesDatabaseId, {");
    expect(sidebar).toContain("favoritesData?.items ?? []");
    expect(sidebar).toContain(").slice(0, limit);");
    expect(sidebar).toContain(
      "overrides={favoritesPersonalView.data?.overrides}",
    );
    expect(sidebar).toContain("sidebarOrder={favoritesOrder.order}");
    expect(sidebar).toContain("handlePinnedReorder");
    expect(sidebar).not.toContain("updateFavoritesPersonalView.isPending");
    expect(sidebar).toContain(
      'const serverOrdered = favoritesOrder.order.mode !== "custom";',
    );
    expect(sidebar).toContain("renderedItems.map((item) => item.id)");
    expect(sidebar).toContain("contentSidebarSubsetReorder(");
    expect(sidebar).toContain(
      "flex h-7 w-full min-w-0 items-center rounded-md px-1",
    );
    expect(sidebar).not.toContain("<FavoriteDocumentItem");
    expect(sidebar).not.toContain("!localFileMode && favorites.length > 0");
  });

  it("marks the current page with one filled row style everywhere", () => {
    const row = readSidebarSource("./SidebarNavigationRow.tsx");
    const sections = readSidebarSource("./PersonalSidebarSections.tsx");
    const databaseSidebar = readSidebarSource("../editor/database/sidebar.tsx");
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");

    expect(row).toContain(
      '"bg-sidebar-accent font-medium text-sidebar-accent-foreground"',
    );
    expect(row).toContain('aria-current={active ? "page" : undefined}');
    expect(row).not.toContain("text-foreground/85");
    expect(sections).toContain("entry.target.documentId === activeDocumentId");
    expect(databaseSidebar).toContain("active={active}");
    expect(databaseSidebar).toContain("revealActiveSidebarRow(rowRef.current)");
    expect(databaseSidebar).not.toContain('active && "font-semibold');
    expect(sidebar).toContain("sidebarRowClassName(trashActive)");
  });

  it("gives Recent rows the shared row actions with personal-only items", () => {
    const sections = readSidebarSource("./PersonalSidebarSections.tsx");
    const recentRow = sections.slice(
      sections.indexOf("function RecentSidebarRow"),
      sections.indexOf("export function PersonalSidebarSections"),
    );

    expect(recentRow).toContain("<SidebarRowActions>");
    expect(recentRow).toContain("<SidebarPageMenu");
    expect(recentRow).toContain("onTogglePin=");
    expect(recentRow).toContain("onRemoveFromRecent=");
    // Recent is personal history: nothing that changes the Page or tree.
    for (const shared of [
      "onRename",
      "onDuplicate",
      "onMove=",
      "onMoveToTrash",
      "addChild",
      "useSidebarReorderItem",
    ]) {
      expect(recentRow).not.toContain(shared);
    }
  });

  it("builds every sidebar Page menu from one component and one order", () => {
    const rowActions = readSidebarSource("./SidebarRowActions.tsx");
    const databaseSidebar = readSidebarSource("../editor/database/sidebar.tsx");
    const menu = rowActions.slice(
      rowActions.indexOf("export function SidebarPageMenu"),
    );

    expect(databaseSidebar).toContain("<SidebarPageMenu");
    expect(databaseSidebar).not.toContain("<SidebarRowMenu");
    // Pin, then link/open, then page changes, then lifecycle, then activity.
    const order = [
      "<SidebarPinMenuItem",
      't("sidebar.copyLink")',
      't("sidebar.openInNewTab")',
      't("sidebar.rename")',
      't("sidebar.duplicate")',
      't("sidebar.moveTo")',
      't("sidebar.removeFromRecent")',
      't("sidebar.moveToTrash")',
      "<SidebarPageActivity",
    ].map((needle) => menu.indexOf(needle));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Rename keeps focus in its input instead of returning to the trigger.
    expect(menu).toContain("event.preventDefault()");
    // Local-file Pages mirror disk, so they cannot be renamed, duplicated, or
    // moved from the sidebar.
    expect(databaseSidebar).toContain(
      "canEdit && !isLocalFile && pageActions !== null",
    );
    // Reorderable rows (Pinned) stay inside the sidebar so their menu shows.
    expect(databaseSidebar).toContain('className="relative min-w-0"');
  });

  it("asks before moving a Page into another space and never offers local folders", () => {
    const dialog = readSidebarSource("./MovePageDialog.tsx");
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");

    // Choosing a place in another space opens the access warning instead of
    // moving; only its confirm button calls onMove.
    expect(dialog).toContain("if (crossSpace) setPendingParentId(parentId);");
    expect(dialog).toContain("else move(parentId);");
    expect(dialog).toContain("sidebar.moveToSpaceWarningShared");
    expect(dialog).toContain("sidebar.moveToSpaceWarningPrivate");
    // The picker starts in the Page's own space, not the sidebar's selection.
    expect(dialog).toContain("setTargetSpaceId(page?.spaceId");
    expect(sidebar).toContain('space.kind !== "source_backed"');
    expect(sidebar).toContain('useActionMutation("duplicate-page"');
  });

  it("keeps Trash in a fixed group and leaves Settings to the account menu", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const expandedBranch = sidebar.slice(
      sidebar.lastIndexOf("<AppSidebarHeader"),
    );

    expect(expandedBranch.indexOf("</ScrollArea>")).toBeLessThan(
      expandedBranch.indexOf("{renderTrashSection()}"),
    );
    expect(sidebar).not.toContain("renderSettingsNavButton");
    expect(sidebar).not.toContain('to="/settings"');
  });

  it("names tree toggles after the item instead of the sidebar", () => {
    const databaseSidebar = readSidebarSource("../editor/database/sidebar.tsx");
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");

    expect(databaseSidebar).toContain('t("sidebar.expandItem", { title })');
    expect(databaseSidebar).toContain('t("sidebar.collapseItem", { title })');
    expect(databaseSidebar).not.toContain('t("sidebar.expand")} ${title}');
    expect(sidebar).toContain('t("sidebar.expandItem", { title: space.name })');
    expect(databaseSidebar).toContain("<SidebarDepthGuides depth={depth} />");
  });

  it("aligns the expanded sidebar controls to one trailing grid", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const sections = readSidebarSource("./PersonalSidebarSections.tsx");

    // The space switcher and the Page/Collection `+` share one header row.
    expect(sidebar).toContain(
      "grid-cols-[minmax(0,1fr)_2rem] items-center gap-1 ps-3 pe-2",
    );
    // Search is a quiet row whose icon and label line up with the tree rows.
    expect(sidebar).toContain("grid-cols-[1.75rem_minmax(0,1fr)_auto]");
    expect(sidebar).not.toContain('variant="outline"');
    expect(sidebar).toContain("w-[var(--radix-dropdown-menu-trigger-width)]");
    expect(sidebar).toContain("max-w-[calc(100vw-1rem)]");
    expect(sidebar).toContain('className="min-w-0 flex-1 truncate"');
    expect(sidebar).toContain('className="shrink-0 ps-3 pe-2 py-2"');
    expect(sections).toContain(
      "size-7 text-muted-foreground hover:text-foreground focus-visible:text-foreground",
    );
  });

  it("keeps section visibility inside each section menu instead of a duplicate customize row", () => {
    const sections = readSidebarSource("./PersonalSidebarSections.tsx");

    // A standalone sidebar-level 3-dot row duplicated the section header menu
    // and burned a whole row of vertical space.
    expect(sections).not.toContain('className="flex justify-end px-3"');
    expect(sections).not.toContain('<IconDots className="size-4" />');

    // The visibility toggles now live under Move up/Move down in every section
    // menu, so a hidden section is always restorable.
    expect(sections).toContain("<DropdownMenuSeparator />");
    expect(sections).toContain("checked={sections[sectionId].visible}");
    expect(sections).toContain("onChangeVisible(sectionId, visible)");
    expect(sections).toContain("change(sectionId, { visible })");

    // Both call sites, including the always-visible "workspaces" section, wire
    // the visibility group.
    expect(
      sections.split("onChangeVisible={(sectionId, visible) =>").length - 1,
    ).toBe(2);

    // The section menu trigger must not reuse the drag handle's label.
    expect(sections).toContain('aria-label={t("sidebar.customizeSidebar")}');
    const menuTrigger = sections.slice(
      sections.indexOf("<DropdownMenuTrigger"),
    );
    expect(menuTrigger).not.toContain("aria-label={reorderLabels.drag(label)}");
    expect(sections).toContain("seeAllHrefs:");
    expect(sections).toContain("seeAllHref={seeAllHrefs[id]}");
    expect(sections).toContain(
      '<Link to={seeAllHref}>{t("sidebar.seeAll")}</Link>',
    );
  });

  it("keeps delete confirmation owned by the stable sidebar", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const treeItem = readSidebarSource("./DocumentTreeItem.tsx");
    const databaseSidebar = readSidebarSource("../editor/database/sidebar.tsx");
    const pointerLock = readSidebarSource(
      "../../../../../packages/toolkit/src/ui/pointer-lock.ts",
    );

    expect(sidebar).toContain("const [pendingDelete, setPendingDelete]");
    expect(sidebar).toContain("open={pendingDelete !== null}");
    expect(sidebar).toContain("confirmedDeleteIdRef");
    expect(sidebar).toContain(
      'import { afterBodyPointerUnlock } from "@/components/ui/pointer-lock"',
    );
    expect(sidebar).toContain("afterBodyPointerUnlock(() => {");
    expect(sidebar).toContain("void handleDelete(confirmedDeleteId)");
    expect(pointerLock).toContain("window.requestAnimationFrame");
    expect(pointerLock).toContain(
      'document.body.style.pointerEvents === "none"',
    );
    expect(treeItem).not.toContain("deleteDialogOpen");
    expect(treeItem).not.toContain("<AlertDialog");
    expect(databaseSidebar).not.toContain("deleteDialogOpen");
    expect(databaseSidebar).not.toContain("<AlertDialog");
  });

  it("keeps the Content sidebar quiet while lists load", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");

    expect(sidebar).not.toContain('from "@/components/ThemeToggle"');
    expect(sidebar).not.toContain('from "./NotionButton"');
    expect(sidebar).not.toContain("border-s border-border/70");
    expect(sidebar).not.toContain("border-t border-border/60");
    expect(sidebar).toContain("isLoading");
    expect(sidebar).toContain("renderTreeSkeleton()");
    expect(sidebar).toContain("<Skeleton");
  });

  it("routes Favorites into its provisioned full database page", () => {
    const route = readSidebarSource("../../routes/_app.favorites.tsx");

    expect(route).toContain("useContentSpaces()");
    expect(route).toContain("favoritesDocumentId");
    expect(route).toContain("<Navigate");
    expect(route).toContain("`/page/${documentId}`");
  });
});
