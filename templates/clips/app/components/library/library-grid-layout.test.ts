import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(name: string): string {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

describe("selected library actions layout", () => {
  it("uses one consistent breadcrumb header and a single-priority sidebar", () => {
    const gridSource = readSource("./library-grid.tsx");
    const layoutSource = readSource("./library-layout.tsx");
    const folderTreeSource = readSource("./folder-tree.tsx");
    const libraryRouteSource = readSource(
      "../../routes/_app.library._index.tsx",
    );
    const folderRouteSource = readSource(
      "../../routes/_app.library.folder.$folderId.tsx",
    );
    const primaryActionsSource = readSource("./library-primary-actions.tsx");
    const feedbackSource = readSource("./sidebar-feedback-button.tsx");
    const globalStyles = readSource("../../global.css");
    const spacesRouteSource = readSource("../../routes/_app.spaces._index.tsx");
    const spaceRouteSource = readSource(
      "../../routes/_app.spaces.$spaceId.tsx",
    );
    const spaceFolderRouteSource = readSource(
      "../../routes/_app.spaces.$spaceId.folder.$folderId.tsx",
    );
    const recordingRouteSource = readSource(
      "../../routes/_app.r.$recordingId.tsx",
    );

    expect(gridSource).toContain("<PageBreadcrumb");
    expect(gridSource).not.toContain('<h1 className="text-base');
    expect(layoutSource).not.toContain("navigation.newRecording");
    expect(layoutSource).not.toContain("navigation.newFolder");
    expect(layoutSource).not.toContain("createSpaceDialog.newSpace");
    expect(layoutSource).not.toContain("<ImportMenu");
    expect(libraryRouteSource).toContain("<LibraryPrimaryActions />");
    expect(libraryRouteSource).toContain(
      'import { LibraryPrimaryActions } from "@/components/library/library-primary-actions";',
    );
    expect(libraryRouteSource).not.toContain("<CreateFolderDialog");
    expect(libraryRouteSource).not.toContain('t("navigation.newFolder")');
    expect(primaryActionsSource).toContain("<IconVideoPlus />");
    expect(primaryActionsSource).toContain('triggerIcon="chevron"');
    expect(gridSource).toContain('import { FolderCard } from "./folder-card"');
    expect(gridSource).toContain("visibleFolders");
    expect(gridSource).toContain("organizationId: currentOrganizationId");
    expect(folderRouteSource).toContain("useOrganizations()");
    expect(folderRouteSource).toContain(
      "organizationId: currentOrganizationId",
    );
    expect(spaceFolderRouteSource).toContain(
      "organizationId: currentOrganizationId",
    );
    expect(gridSource).toContain('t("navigation.folders")');
    expect(gridSource).toContain('aria-labelledby="library-folders-heading"');
    expect(gridSource).toContain('t("navigation.recordings")');
    expect(gridSource).toContain("LibraryCanvasContextMenu");
    expect(gridSource).toContain(
      "onContextMenu={(event) => event.stopPropagation()}",
    );
    expect(gridSource).toContain('t("navigation.newFolder")');
    expect(folderRouteSource).toContain("<LibraryPrimaryActions folderId");
    expect(spaceRouteSource).toContain("<LibraryPrimaryActions spaceId");
    expect(spaceFolderRouteSource).toContain("<LibraryPrimaryActions folderId");
    expect(folderRouteSource).toContain(
      '{ label: t("navigation.library"), to: "/library" }',
    );
    expect(spaceRouteSource).toContain(
      '{ label: t("navigation.spaces"), to: "/spaces" }',
    );
    expect(spaceFolderRouteSource).toContain("to: `/spaces/${spaceId}`");
    expect(recordingRouteSource).toContain(
      "<PageBreadcrumb items={recordingBreadcrumbItems}",
    );
    expect(recordingRouteSource).not.toContain(
      'from "@/components/ui/breadcrumb"',
    );
    expect(layoutSource).toContain(
      '"flex h-14 shrink-0 items-center border-b border-border"',
    );
    expect(layoutSource).toContain("primaryNavItems.map");
    expect(layoutSource).toContain("lifecycleNavItems.map");
    expect(layoutSource).toContain(
      'item.to === "/library" && libFolderList.length > 0',
    );
    expect(layoutSource).toContain('item.to === "/spaces"');
    expect(layoutSource).toContain("(spaces?.spaces ?? []).length > 0");
    expect(layoutSource).toContain("ExpandedSidebarNavGroup");
    expect(layoutSource).toContain("<CollapsibleContent");
    expect(layoutSource).toContain("expandedSidebarGroups");
    expect(layoutSource).toContain("spaceFolderLists");
    expect(layoutSource).toContain("compact");
    expect(layoutSource).not.toContain(
      'className="ms-4 border-s border-border/70 ps-1"',
    );
    expect(folderTreeSource).toContain("compact ?");
    expect(folderTreeSource).toContain("!compact &&");
    expect(folderTreeSource).toContain("compact && hasChildren");
    expect(layoutSource).not.toContain('t("navigation.noSpaces")');
    expect(layoutSource).not.toContain('t("folderTree.noFolders")');
    expect(layoutSource).not.toContain("pageHasHeaderSearch");
    expect(layoutSource).not.toContain("data-sidebar-brand-toggle");
    expect(layoutSource).not.toContain("navigate(SEARCH_FOCUS_PATH)");
    expect(layoutSource).not.toContain("searchButton");
    expect(layoutSource).not.toContain("IconSearch");
    expect(layoutSource).toContain('currentAppId="clips"');
    expect(layoutSource).toContain("utilityLinks={workspaceUtilityLinks}");
    expect(layoutSource).toContain('id: "chrome-extension"');
    expect(layoutSource).toContain('id: "desktop-app"');
    expect(layoutSource).toContain("SIDEBAR_COLLAPSED_STORAGE_KEY");
    expect(layoutSource).toContain("compact={showCollapsedSidebar}");
    expect(layoutSource).toContain("IconLayoutSidebarLeftCollapse");
    expect(layoutSource).toContain("IconLayoutSidebarLeftExpand");
    expect(layoutSource).toContain("SidebarFeedbackButton");
    expect(layoutSource).toContain(
      "<SidebarFeedbackButton collapsed={showCollapsedSidebar} />",
    );
    expect(layoutSource).toContain("data-sidebar-footer-utilities");
    expect(layoutSource).toContain('? "flex flex-col items-center gap-1"');
    expect(layoutSource).toContain('"!size-9 !p-0 [&>svg]:!size-4"');
    expect(layoutSource).toContain("function isSidebarGroupActive(");
    expect(layoutSource).toContain(
      'group === "library" && pathname.startsWith("/library/folder/")',
    );
    expect(layoutSource).toContain(
      'group === "spaces" && pathname.startsWith("/spaces/")',
    );
    expect(layoutSource).toContain(
      "!bg-transparent !text-primary hover:!bg-accent/60 hover:!text-primary",
    );
    expect(layoutSource).not.toContain("!bg-primary/5");
    expect(feedbackSource).toContain(
      "bg-transparent text-primary hover:bg-accent/60 hover:text-primary",
    );
    expect(feedbackSource).toContain(
      "h-auto w-full justify-start gap-2 bg-transparent px-2 py-1.5 text-xs font-normal",
    );
    expect(feedbackSource).toContain("IconMoodSmile");
    expect(feedbackSource).toContain("clips-feedback-nudge");
    expect(globalStyles).toContain("@keyframes clips-feedback-nudge");
    expect(globalStyles).toContain(".clips-feedback-nudge {");
    expect(globalStyles).toContain("animation: none");
    expect(feedbackSource).not.toContain("bg-primary/5");
    expect(layoutSource).toContain('currentAppId="clips"');
    expect(feedbackSource).toContain("openBugReportDialog");
    expect(feedbackSource).toContain('t("bugReportRoute.sidebarCta")');
    expect(layoutSource).not.toContain("SidebarFooterActions");
    expect(layoutSource).not.toContain("DevDatabaseLink");
    expect(
      spacesRouteSource.match(/t\("createSpaceDialog\.newSpace"\)/g),
    ).toHaveLength(1);
    expect(spacesRouteSource).toContain('t("createSpaceDialog.description")');
    expect(spacesRouteSource).toContain("<AppEmptyState");
    expect(spacesRouteSource).toContain("createSpaceLabel");
    expect(spacesRouteSource).toContain("<PageHeaderPrimaryAction");
  });

  it("keeps Meetings, Dictate, and Trash on the shared app-shell header", () => {
    const meetingsSource = readSource("../../routes/_app.meetings._index.tsx");
    const dictateSource = readSource("../../routes/_app.dictate.tsx");
    const trashSource = readSource("../../routes/_app.trash.tsx");

    expect(meetingsSource).toContain("<PageBreadcrumb");
    expect(dictateSource).toContain("<PageBreadcrumb");
    expect(trashSource).toContain("<PageBreadcrumb");
    expect(trashSource).not.toContain('<h1 className="text-base font-semibold');
    expect(dictateSource).not.toContain(
      't("dictateRoute.voiceToTextDescription")',
    );
  });

  it("keeps library search before the primary recording action", () => {
    const gridSource = readSource("./library-grid.tsx");
    const searchIndex = gridSource.indexOf("<SearchBar");
    const actionIndex = gridSource.indexOf("{extraActions}");

    expect(searchIndex).toBeGreaterThan(-1);
    expect(actionIndex).toBeGreaterThan(searchIndex);
  });

  it("anchors the action bar to the list viewport instead of the list end", () => {
    const gridSource = readSource("./library-grid.tsx");
    const toolbarSource = readSource("./bulk-action-toolbar.tsx");

    expect(gridSource).toContain(
      'className="relative flex min-h-0 flex-1 flex-col overflow-hidden"',
    );
    expect(gridSource).toContain(
      'className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-4"',
    );
    expect(gridSource).toContain('selected.size > 0 && "pb-20"');
    expect(toolbarSource).not.toContain("sticky bottom-4");
  });

  it("moves clips into folders created from either move menu", () => {
    const gridSource = readSource("./library-grid.tsx");
    const toolbarSource = readSource("./bulk-action-toolbar.tsx");

    expect(gridSource).toContain("CreateFolderDialog");
    expect(gridSource).toContain("createFolderTarget");
    expect(gridSource).toContain('kind: "single"');
    expect(gridSource).toContain('kind: "bulk"');
    expect(gridSource).toContain(
      "moveRecordings(createFolderTarget.recordingIds",
    );
    expect(toolbarSource).toContain("onCreateFolder");
    expect(toolbarSource).toContain('t("navigation.newFolder")');
  });
});
