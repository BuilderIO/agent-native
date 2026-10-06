import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), { encoding: "utf8" });
}

const databaseView = read("./DatabaseView.tsx");
const contentTable = read("./ContentTable.tsx");

describe("collection layout at phone and tablet widths", () => {
  it("sizes from its container rather than the window", () => {
    expect(databaseView).not.toContain("--content-sidebar-width");
    expect(databaseView).toContain(
      "<div className={DATABASE_VIEW_CLASS_NAME}>",
    );
  });

  it("gives view tabs their content width and keeps the toolbar at the end when it wraps", () => {
    expect(databaseView).toContain(
      "group/viewtabs relative flex min-w-0 flex-auto items-center gap-1 overflow-x-auto",
    );
    expect(databaseView).toContain('<ContentTableToolbar className="ms-auto">');
  });

  it("leaves vertical scrolling to the page below lg", () => {
    expect(databaseView).toContain(
      'className: "overflow-auto lg:max-h-[70vh]"',
    );
    expect(databaseView).not.toContain('"max-h-[70vh] overflow-auto"');
  });

  it("shows every row checkbox once a selection exists", () => {
    expect(databaseView).toContain(
      'data-table-selecting={selectedCount > 0 ? "" : undefined}',
    );
    expect(databaseView).toContain("{...selectionGutter.containerProps}");
    expect(databaseView).toContain("gutterWidth={gutterWidth}");
    expect(contentTable).toContain("[[data-table-selecting]_&]:opacity-100");
  });

  it("enters selection by long-press on touch without selecting row text", () => {
    expect(databaseView).toContain(
      "const longPress = useContentTableLongPress(onToggleSelected);",
    );
    expect(databaseView).toContain(
      "[@media(any-hover:none)]:select-none [@media(any-hover:none)]:[-webkit-touch-callout:none] [&_input]:select-text",
    );
  });

  it("drops the type icon from narrow column headers and names truncated columns on hover and focus", () => {
    expect(databaseView).toContain("const NARROW_PROPERTY_HEADER_WIDTH = 128;");
    expect(databaseView).toContain(
      "const narrow = width < NARROW_PROPERTY_HEADER_WIDTH;",
    );
    expect(databaseView).toContain(
      'iconClassName={narrow ? "hidden" : undefined}',
    );
    expect(databaseView).toContain("label.scrollWidth > label.clientWidth");
    expect(databaseView).toContain(
      "<Tooltip open={nameTooltip.open} onOpenChange={nameTooltip.onOpenChange}>",
    );
    expect(read("../DocumentProperties.tsx")).toContain(
      'className={cn("size-4 shrink-0", iconClassName)}',
    );
  });
});
