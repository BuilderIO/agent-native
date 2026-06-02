import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readDatabaseSource() {
  return readFileSync(new URL("./DocumentDatabase.tsx", import.meta.url), {
    encoding: "utf8",
  });
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
      "group/viewtabs flex min-w-0 flex-1 items-center gap-1 overflow-x-auto",
    );
  });

  it("focuses the preview title after creating a database page", () => {
    const source = readDatabaseSource();

    expect(source).toContain("setPreviewTitleFocusDocumentId");
    expect(source).toContain("titleInputRef.current?.focus()");
    expect(source).toContain("titleInputRef.current?.select()");
    expect(source).toContain('aria-label="New database row"');
  });

  it("selects the current view name when renaming a database view", () => {
    const source = readDatabaseSource();

    expect(source).toContain('aria-label="View name"');
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
    expect(source).toContain('placeholder="Search properties"');
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
    expect(source).toContain('aria-label="View settings"');
    expect(source).toContain("Property visibility");
    expect(source).toContain("bg-foreground px-2.5 text-xs font-medium");
  });

  it("renders a Notion-like right-side view settings panel", () => {
    const source = readDatabaseSource();

    expect(source).toContain("type DatabaseSettingsPanel");
    expect(source).toContain("function DatabaseViewSettingsPanel");
    expect(source).toContain("View settings");
    expect(source).toContain("function DatabaseSettingsLayoutPanel");
    expect(source).toContain(
      "function DatabaseSettingsPropertyVisibilityPanel",
    );
    expect(source).toContain("function DatabaseSettingsGroupPanel");
    expect(source).toContain("fixed bottom-0 right-0 top-12");
  });

  it("keeps the Layout settings panel limited to implemented controls", () => {
    const source = readDatabaseSource();

    expect(source).toContain("function DatabaseOpenPagesInSetting");
    expect(source).toContain("databaseOpenPagesInDescription");
    expect(source).toContain("Wrap all content");
    expect(source).toContain("Open pages in");
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
    expect(source).toContain('aria-label="New database row"');
    expect(source).toContain("hover:bg-muted/35 hover:text-foreground");
  });

  it("uses pill view tabs without a separate active chevron", () => {
    const source = readDatabaseSource();

    expect(source).toContain("const [openViewMenuId, setOpenViewMenuId]");
    expect(source).toContain("onContextMenu={(event) => {");
    expect(source).toContain('aria-label="Add database view"');
    expect(source).toContain("group-hover/viewtabs:opacity-100");
    expect(source).not.toContain("hover:bg-background/80 hover:text-foreground");
  });
});
