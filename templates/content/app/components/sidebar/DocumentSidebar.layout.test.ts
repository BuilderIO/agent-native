import { readFileSync } from "node:fs";

import type { DocumentTreeNode } from "@shared/api";
import { describe, expect, it } from "vitest";

import { getDocumentSidebarIconKind } from "./DocumentTreeItem";

function readSidebarSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8").replace(
    /\r\n/g,
    "\n",
  );
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

  it("keeps hosted sidebar reads bounded while isolating exhaustive local inventory", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const documentsHook = readSidebarSource("../../hooks/use-documents.ts");

    expect(sidebar).not.toContain("const documentsQuery = useDocuments();");
    expect(sidebar).toContain("useDocuments({ enabled: localFileMode })");
    expect(sidebar).toContain("useContentNavigationContext(activeDocumentId)");
    expect(documentsHook).toContain('"get-content-navigation-context"');
    expect(sidebar).toContain("limit: 50");
    expect(sidebar).not.toContain("limit: Math.max(contentSpaces.length, 1)");
    expect(sidebar).toContain("useContentSpaces()");
    expect(documentsHook).toContain("enabled: options?.enabled !== false");
  });

  it("opens a new database immediately while persistence settles", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");

    expect(sidebar).toContain("const handleCreateDatabase = useCallback");
    expect(sidebar).toContain("newDocumentId: id");
    expect(sidebar).toContain("navigateToDocument(id)");
    expect(sidebar).toMatch(
      /rollbackOptimisticCreatedDocument\(\s+queryClient,\s+id,/,
    );
    expect(sidebar).toContain("navigate(previousPath, {");
    expect(sidebar).toContain(
      "if (locationRef.current.pathname === `/page/${id}`)",
    );
    expect(sidebar).toContain(
      "pendingOptimisticCreationIdsRef.current.add(id)",
    );
    expect(sidebar).toContain("skipListDocumentsInvalidation: true");
    expect(sidebar).toContain("settleOptimisticListRefresh(id)");
  });

  // oracle-change: the DocumentTreeItem.tsx add-child greps became the rendered menu in DocumentTreeItem.test.tsx
  it("scopes sidebar creation to the selected Content space", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
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

    expect(messages).toContain('workspaces: "Workspaces"');
    expect(messages).toContain('files: "Files"');
  });

  it("settles optimistic page and collection creation before the first read", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const collectionCreate = sidebar.slice(
      sidebar.indexOf("const handleCreateDatabase = useCallback"),
      sidebar.indexOf("const selectSpaceForCreation = useCallback"),
    );

    expect(sidebar).toContain("shouldCreateDocumentOptimistically({");
    expect(sidebar).toContain("filesDatabaseId: rootFilesDatabaseId");
    expect(sidebar).toContain("markDocumentCreationPending(queryClient, {");
    expect(sidebar).toMatch(
      /const confirmed = markDocumentCreationConfirmed\(\s*queryClient,\s*created,\s*\);/,
    );
    expect(sidebar).toMatch(
      /queryClient\.setQueryData\(\s*\[\s*"action",\s*"get-document",\s*\{\s*id:\s*nextId\s*\}\s*\],\s*confirmed,\s*\);/,
    );
    expect(sidebar).toContain(
      "return withDocumentsCacheShape(old, [...docs, tempDoc])",
    );
    expect(sidebar).toContain("rollbackOptimisticCreatedDocument(");
    expect(collectionCreate).toContain(
      "clearDocumentCreationPending(queryClient, { id });",
    );
    expect(collectionCreate).toContain(
      "startPageOpenDocumentReads(queryClient, nextId);",
    );
    expect(
      collectionCreate.indexOf("clearDocumentCreationPending"),
    ).toBeLessThan(collectionCreate.indexOf("startPageOpenDocumentReads"));
  });

  it("restores deleted list and page snapshots before refetching on failure", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");

    expect(sidebar).toContain("const previousDocumentQueries =");
    expect(sidebar).toContain("restoreDeletedDocumentSnapshots(");
    expect(sidebar).toContain("previousDocumentQueries");
    expect(sidebar).toContain("navigate(previousPath, {");
  });

  it("never empties the Files tree while a deferred database read is paused", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const hooks = readSidebarSource("../../hooks/use-content-database.ts");

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
    // The sections draw their placeholders without a space; their reads wait.
    expect(sidebar).toContain("spaceId={selectedSpaceId}");
    expect(sections).toContain("enabled: Boolean(stateArgs)");
    expect(sections).toMatch(
      /useContentRecent\(spaceId \?\? undefined, \{\s+enabled: Boolean\(spaceId\),/,
    );
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
    // Without a space Recent never loads, so its placeholder would never leave.
    expect(sidebar).toMatch(
      /\{selectedSpace \|\| contentSpaceState === "loading" \? \(\s*<PersonalSidebarSections/,
    );
    expect(sidebar).toContain("renderPinned={(limit) =>");
    expect(sections).toContain("sections[id].visible");
    expect(sections).toContain(
      "const hideEmptyPinned = pinnedCount === 0 && !pinnedError;",
    );
    expect(sections).toContain('(id) => id !== "pinned" || !hideEmptyPinned');
    expect(sidebar).toContain("pinnedError={");
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
    expect(sections).toContain("sidebarShowMoreClassName");
    expect(sections).toContain("grid-cols-[0.25rem_1.75rem_minmax(0,1fr)]");
    expect(sections).not.toContain("min-h-[38px]");
    expect(sections).toContain("text-muted-foreground");
    expect(sidebar).toContain("useContentDatabaseById(favoritesDatabaseId, {");
    // Until the Favorites list lists a first pin, Pinned draws the pin itself.
    expect(sidebar).toContain("const drawn = firstPinsToDraw(");
    expect(sidebar).toContain("pinnedData?.items ?? []");
    expect(sidebar).toContain(").slice(0, limit);");
    expect(sidebar).toContain(
      "overrides={favoritesPersonalView.data?.overrides}",
    );
    expect(sidebar).toContain("sidebarOrder={favoritesOrder.order}");
    expect(sidebar).toContain("handlePinnedReorder");
    // A pin its Favorites list doesn't list yet stays out of a saved order.
    expect(sidebar).toContain("!isOptimisticFavoriteItemId(id)");
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

  // oracle-change: the MovePageDialog.tsx greps became the rendered cross-space move in MovePageDialog.test.tsx
  it("asks before moving a Page into another space and never offers local folders", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");

    expect(sidebar).toContain("useMovePageDialog(");
    expect(sidebar).toContain('useActionMutation("duplicate-page"');
  });

  // oracle-change: the pointer-lock.ts grep became packages/toolkit/src/ui/pointer-lock.spec.ts; the Page and Collection rows' dialog-absence greps became the rendered Delete and Move to Trash tests in DocumentTreeItem.test.tsx and editor/database/sidebar.test.tsx, which see each row hand the deletion to the sidebar without opening a dialog of its own
  it("keeps delete confirmation owned by the stable sidebar", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");

    expect(sidebar).toContain("const [pendingDelete, setPendingDelete]");
    expect(sidebar).toContain("open={pendingDelete !== null}");
    expect(sidebar).toContain("confirmedDeleteIdRef");
    expect(sidebar).toContain(
      'import { afterBodyPointerUnlock } from "@/components/ui/pointer-lock"',
    );
    expect(sidebar).toContain("afterBodyPointerUnlock(() => {");
    expect(sidebar).toContain("void handleDelete(confirmedDeleteId)");
  });
});
