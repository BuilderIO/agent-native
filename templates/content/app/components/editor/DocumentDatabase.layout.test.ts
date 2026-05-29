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
      '<div className="mt-6 min-w-0 w-full max-w-[calc(100vw-var(--content-sidebar-width,0px)-3rem)]">',
    );
    expect(source).toContain(
      "mb-1 flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border pb-1",
    );
    expect(source).toContain(
      "flex max-w-full flex-wrap items-center justify-end gap-1",
    );
    expect(source).toContain(
      "flex min-w-0 flex-1 items-center gap-1 overflow-x-auto",
    );
  });

  it("focuses the preview title after creating a database page", () => {
    const source = readDatabaseSource();

    expect(source).toContain("setPreviewTitleFocusDocumentId");
    expect(source).toContain("titleInputRef.current?.focus()");
    expect(source).toContain("titleInputRef.current?.select()");
    expect(source).toContain("if (!createdItem) inputRef.current?.focus()");
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
    expect(source).toContain("setMenuOpen(false)");
  });

  it("keeps preview property popovers inside the side preview sheet", () => {
    const source = readDatabaseSource();

    expect(source).toContain("popoversPortalled={false}");
  });
});
