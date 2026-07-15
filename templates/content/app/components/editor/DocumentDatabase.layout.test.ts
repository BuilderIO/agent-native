import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readDatabaseSource() {
  return [
    "./database/DatabaseView.tsx",
    "./database/settings.tsx",
    "./database/shared.tsx",
    "./database/view-config.ts",
    "./database/view-state.ts",
  ]
    .map((path) =>
      readFileSync(new URL(path, import.meta.url), {
        encoding: "utf8",
      }),
    )
    .join("\n");
}

describe("document database layout", () => {
  it("wraps database toolbar controls instead of clipping them", () => {
    const source = readDatabaseSource();

    expect(source).toContain(
      '<div className="mt-4 min-w-0 w-full max-w-[calc(100vw-var(--content-sidebar-width,0px)-1.5rem)]">',
    );
    expect(source).toContain(
      "mb-1 flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-1 pb-1",
    );
    expect(source).toContain(
      "flex max-w-full flex-wrap items-center justify-end gap-1",
    );
    expect(source).toContain(
      "group/viewtabs relative flex min-w-0 flex-1 items-center gap-1 overflow-x-auto",
    );
  });

  it("focuses the preview title after creating a database page", () => {
    const source = readDatabaseSource();

    expect(source).toContain("setPreviewTitleFocusDocumentId");
    expect(source).toContain("titleInputRef.current?.focus()");
    expect(source).toContain("titleInputRef.current?.select()");
    expect(source).toContain('aria-label={dbText("newDatabaseRow")}');
  });

  it("selects the current view name when renaming a database view", () => {
    const source = readDatabaseSource();

    expect(source).toContain('aria-label={dbText("viewName")}');
    expect(source).toContain("const renameInputRef = useRef<HTMLInputElement>");
    expect(source).toContain("renameInputRef.current?.focus()");
    expect(source).toContain("renameInputRef.current?.select()");
  });

  it("selects the current row title when inline editing a database row", () => {
    const source = readDatabaseSource();

    expect(source).toContain(
      "const rowTitleInputRef = useRef<HTMLInputElement>",
    );
    expect(source).toContain(
      'aria-label={`Inline title for ${item.document.title || "Untitled"}`}',
    );
    expect(source).toContain("rowTitleInputRef.current?.focus()");
    expect(source).toContain("rowTitleInputRef.current?.select()");
    expect(source).toContain("onClick={() => setEditingTitle(true)}");
  });

  it("makes direct checkbox cells fill their table cell click target", () => {
    const source = readDatabaseSource();

    expect(source).toContain(
      "flex min-h-6 w-full min-w-0 items-center rounded px-1 text-left",
    );
  });

  it("lets board columns collapse into narrow saved groups", () => {
    const source = readDatabaseSource();

    expect(source).toContain(
      "collapsedGroupIds={activeView.collapsedGroupIds ?? []}",
    );
    expect(source).toContain("onGroupCollapsedChange={setGroupCollapsed}");
    expect(source).toContain('collapsed ? "w-12" : "w-72"');
    expect(source).toContain(
      "aria-label={`Expand ${group.label} board group`}",
    );
    expect(source).toContain(
      "aria-label={`Collapse ${group.label} board group`}",
    );
  });

  it("uses searchable property pickers in database view controls", () => {
    const source = readDatabaseSource();

    expect(source).toContain("function DatabasePropertyPickerSearch");
    expect(source).toContain('placeholder={dbText("searchProperties")}');
    expect(source).toContain("DatabasePropertyPickerSubContent");
    expect(source).toContain(
      "const groupPropertyItems = databasePropertyPickerItems",
    );
  });

  it("closes transient database menus after one-shot actions", () => {
    const source = readDatabaseSource();

    expect(source).toContain("const [addViewOpen, setAddViewOpen]");
    expect(source).toContain("setAddViewOpen(false)");
    expect(source).toContain("const [menuOpen, setMenuOpen]");
    expect(source).toContain("const [actionsMenuOpen, setActionsMenuOpen]");
    expect(source).toContain("setActionsMenuOpen(false)");
    expect(source).toContain("setMenuOpen(false)");
  });

  it("keeps preview property popovers inside the side preview sheet", () => {
    const source = readDatabaseSource();

    expect(source).toContain("popoversPortalled={false}");
  });

  it("uses compact icon-led database toolbar controls", () => {
    const source = readDatabaseSource();

    expect(source).toContain("function databaseToolbarIconButtonClass");
    expect(source).toContain('aria-label="Search"');
    expect(source).toContain(': "Database settings"');
    expect(source).toContain("Property visibility");
    expect(source).toContain("bg-foreground px-2.5 text-xs font-medium");
  });

  it("renders a Notion-like right-side view settings panel", () => {
    const source = readDatabaseSource();

    expect(source).toContain("type DatabaseSettingsPanel");
    expect(source).toContain("function DatabaseSettingsPanelSheet");
    expect(source).toContain("Database settings");
    expect(source).toContain("function DatabaseSettingsLayoutPanel");
    expect(source).toContain(
      "function DatabaseSettingsPropertyVisibilityPanel",
    );
    expect(source).toContain("function DatabaseSettingsGroupPanel");
    expect(source).toContain("fixed bottom-0 right-0 top-12");
  });

  it("keeps database settings row clicks inside the source drawer", () => {
    const source = readDatabaseSource();

    expect(source).toContain("onClick={(event) => event.stopPropagation()}");
    expect(source).toContain(
      "onPointerDown={(event) => event.stopPropagation()}",
    );
    expect(source).toContain(
      "onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {",
    );
    expect(source).toContain("event.stopPropagation();");
    expect(source).toContain('label="Sources"');
    expect(source).toContain('onClick={() => onPanelChange("source")}');
  });

  it("keeps idle reloads, source-panel mounts, remounts, and focus local until explicit refresh", () => {
    const source = readDatabaseSource();

    expect(source).not.toContain("const autoSyncEnabled");
    expect(source).not.toContain('window.addEventListener("focus"');
    expect(source).not.toContain("refreshSourceRef.current()");
    expect(source.match(/dbText\("refreshSource"\)/g)).toHaveLength(2);
    expect(
      source.match(/onClick=\{\(\) => onRefreshSource\(source\.id\)\}/g),
    ).toHaveLength(2);
    // The independent DatabaseView continuation pump still resumes an already
    // fetching snapshot after a reload; it is not a panel-open freshness read.
    expect(source).toContain(
      'builderSourceRowFetchStatus(source) === "fetching"',
    );
    expect(source).toContain("source.metadata.lastReadHasMore === true");
    expect(source).toContain("const continuationKey");
  });

  it("reduces the connected source panel to read-only status plus a diff slot", () => {
    const source = readDatabaseSource();

    // Read-only is the headline signal; live writes flip the same badge.
    expect(source).toContain('dbText("readOnly")');
    expect(source).toContain('dbText("liveWritesOn")');
    // The dormant diff slot is the single push-review entry point.
    expect(source).toContain('dbText("reviewDiff")');
    // A failed sync surfaces inline instead of silently going stale.
    expect(source).toContain('dbText("couldntSyncRetry")');
    // Disconnect stays available, tucked at the bottom.
    expect(source).toContain('dbText("disconnectSource")');
    // The aggregate field-mappings list is gone (mappings live in column menus).
    expect(source).not.toContain(">Field mappings<");
  });

  it("keeps the Layout settings panel limited to implemented controls", () => {
    const source = readDatabaseSource();

    expect(source).toContain("function DatabaseOpenPagesInSetting");
    expect(source).toContain("databaseOpenPagesInDescription");
    expect(source).toContain('dbText("wrapAllContent")');
    expect(source).toContain('dbText("openPagesIn")');
    expect(source).not.toContain("Row density");
    expect(source).not.toContain("DATABASE_ROW_DENSITIES");
    expect(source).not.toContain("databaseRowDensityLabel");
    expect(source).not.toContain("Show vertical lines");
    expect(source).not.toContain("Show page icon");
    expect(source).not.toContain('["Chart", "Feed", "Map", "Dashboard"]');
  });

  it("omits unavailable database settings placeholders", () => {
    const source = readDatabaseSource();

    expect(source).not.toContain("Automations");
    expect(source).not.toContain("AI Autofill");
    expect(source).not.toContain("Conditional color");
    expect(source).not.toContain("Copy link to view");
    expect(source).not.toContain("Manage data sources");
    expect(source).not.toContain("Lock database");
    expect(source).not.toContain("Data source settings");
    expect(source).not.toContain("DatabaseSettingsUnavailablePanel");
  });

  it("keeps empty table chrome quiet", () => {
    const source = readDatabaseSource();

    expect(source).toContain("const cleanDefaultTable");
    expect(source).toContain("EMPTY_DEFAULT_ADD_PROPERTY_COLUMN_WIDTH");
    expect(source).toContain("function DatabaseBlankDefaultRows");
    expect(source).toContain('variant={cleanDefaultTable ? "header" : "icon"}');
    expect(source).toContain(
      "if (totalCount === 0 && !constrained) return null",
    );
    expect(source).toContain('aria-label={dbText("newDatabaseRow")}');
    expect(source).toContain("hover:bg-muted/35 hover:text-foreground");
  });

  it("uses pill view tabs without a separate active chevron", () => {
    const source = readDatabaseSource();

    expect(source).toContain("const [openViewMenuId, setOpenViewMenuId]");
    expect(source).toContain("const [draggedViewId, setDraggedViewId]");
    expect(source).toContain("const [dropTargetView, setDropTargetView]");
    expect(source).toContain("function DatabaseDragPreview(");
    expect(source).toContain("function DatabaseDropIndicator(");
    expect(source).toContain("function startViewPointerDrag(");
    expect(source).toContain("data-database-view-id");
    expect(source).toContain("reorderDatabaseView(");
    expect(source).toContain("targetView.side");
    expect(source).toContain("onContextMenu={(event) => {");
    expect(source).toContain('aria-label={dbText("addDatabaseView")}');
    expect(source).toContain("group-hover/viewtabs:opacity-100");
    expect(source).not.toContain(
      "hover:bg-background/80 hover:text-foreground",
    );
  });

  it("uses drag reordering instead of explicit move actions for views and columns", () => {
    const source = readDatabaseSource();

    expect(source).toContain("function reorderDatabaseView(");
    expect(source).toContain("function reorderDatabaseViewProperty(");
    expect(source).toContain("const [draggedPropertyId, setDraggedPropertyId]");
    expect(source).toContain("function startPropertyPointerDrag(");
    expect(source).toContain("data-database-property-id");
    expect(source).toContain('data-column-resize-handle=""');
    expect(source).toContain("triggerTrailing={");
    expect(source).toContain("dropTargetProperty?.id");
    expect(source).toContain("cursor-grab active:cursor-grabbing");
    expect(source).not.toContain('data-column-menu-trigger=""');
    expect(source).not.toContain("Column menu for ${property.definition.name}");
    expect(source).not.toContain("Move left");
    expect(source).not.toContain("Move right");
    expect(source).not.toContain("Move up");
    expect(source).not.toContain("Move down");
    expect(source).not.toContain("onMoveLeft");
    expect(source).not.toContain("onMoveRight");
  });

  it("keeps calendar cells calm and unclipped", () => {
    const source = readDatabaseSource();

    expect(source).toContain('data-database-calendar-surface="true"');
    expect(source).toContain("min-w-0 max-w-full overflow-hidden");
    expect(source).toContain("group min-w-0 border-r border-b");
    expect(source).toContain("aria-label={`Add page for ${dateKey}`}");
    expect(source).toContain("group-hover:opacity-100");
    expect(source).not.toContain("New ${dateKey} calendar card title");
  });

  it("orders new view choices by the supported database IA", () => {
    const source = readDatabaseSource();
    expect(source).toContain("DATABASE_VIEW_TYPES.map((type) => {");
    const typeOrder = source.indexOf(
      "const DATABASE_VIEW_TYPES: ContentDatabaseViewType[] = [",
    );
    const tableIndex = source.indexOf('"table"', typeOrder);
    const boardIndex = source.indexOf('"board"', typeOrder);
    const galleryIndex = source.indexOf('"gallery"', typeOrder);
    const listIndex = source.indexOf('"list"', typeOrder);
    const timelineIndex = source.indexOf('"timeline"', typeOrder);
    const calendarIndex = source.indexOf('"calendar"', typeOrder);

    expect([
      tableIndex,
      boardIndex,
      galleryIndex,
      listIndex,
      timelineIndex,
      calendarIndex,
    ]).toEqual(
      [
        ...[
          tableIndex,
          boardIndex,
          galleryIndex,
          listIndex,
          timelineIndex,
          calendarIndex,
        ],
      ].sort((left, right) => left - right),
    );
  });

  it("keeps the table footer inside one quiet horizontal scroll surface", () => {
    const source = readDatabaseSource();

    expect(source).toContain('data-database-scroll-surface="table"');
    expect(source).toContain("min-w-0 max-w-full overflow-x-auto");
    expect(source).toContain("group/footer grid border-b border-border/30");
    expect(source).toContain(
      "aria-label={`Calculate ${property.definition.name}`}",
    );
    expect(source).toContain("group-hover/footer:opacity-100");
    expect(source).toContain("quietUntilHover");
  });
});
