import { describe, expect, it } from "vitest";

import {
  findUiBlocksViolations,
  isGuardedPath,
  type UiBlocksFile,
} from "./guard-ui-blocks.js";

const TSX = "templates/forms/app/pages/FormsListPage.tsx";
const CATALOG = "templates/forms/app/i18n/en-US.ts";

function check(path: string, lines: string[], addedLines?: number[]) {
  const file: UiBlocksFile = { path, source: lines.join("\n") };
  if (addedLines) file.addedLines = new Set(addedLines);
  return findUiBlocksViolations([file]).map(({ line, rule }) => ({
    line,
    rule,
  }));
}

describe("menu-leading-icon", () => {
  it("flags an icon as the first child of a menu item", () => {
    expect(
      check(TSX, [
        "<DropdownMenuItem>",
        '  <IconTrash className="size-4" />',
        '  {t("forms.delete")}',
        "</DropdownMenuItem>",
      ]),
    ).toEqual([{ line: 2, rule: "menu-leading-icon" }]);
  });

  it("flags context, checkbox, radio, and submenu triggers", () => {
    expect(
      check(TSX, [
        "<ContextMenuItem><IconCopy />Copy</ContextMenuItem>",
        "<DropdownMenuCheckboxItem checked={on}><IconEye />Show</DropdownMenuCheckboxItem>",
        '<MenubarRadioItem value="a"><IconLayout />Grid</MenubarRadioItem>',
        "<DropdownMenuSubTrigger><IconDownload />Export</DropdownMenuSubTrigger>",
      ]).map(({ line }) => line),
    ).toEqual([1, 2, 3, 4]);
  });

  it("sees past an arrow function in the attributes", () => {
    expect(
      check(TSX, [
        "<DropdownMenuItem",
        "  onSelect={() => setOpen(true)}",
        '  className={cn("gap-2", { "opacity-50": busy })}',
        ">",
        "  <IconPencil />",
        "  Rename",
        "</DropdownMenuItem>",
      ]),
    ).toEqual([{ line: 5, rule: "menu-leading-icon" }]);
  });

  it("allows text-only items and trailing glyphs", () => {
    expect(
      check(TSX, [
        "<DropdownMenuItem onSelect={() => rename()}>",
        '  {t("forms.rename")}',
        "  <DropdownMenuShortcut>⌘R</DropdownMenuShortcut>",
        "</DropdownMenuItem>",
        "<DropdownMenuSubTrigger>Export</DropdownMenuSubTrigger>",
        "<DropdownMenuItem>",
        "  <span className={swatch} />",
        "</DropdownMenuItem>",
        "<DropdownMenuContent><IconDots /></DropdownMenuContent>",
      ]),
    ).toEqual([]);
  });

  it("allows the prompt composer's + menu by path", () => {
    expect(
      check("packages/toolkit/src/composer/ComposerContextMenu.tsx", [
        "<DropdownMenuItem><IconPhoto />Image</DropdownMenuItem>",
      ]),
    ).toEqual([]);
  });

  it("honors the pragma on the line or up to two lines above", () => {
    expect(
      check(TSX, [
        "<DropdownMenuItem>",
        "  {/* guard:allow-menu-content-glyph - layer kind tells rows apart */}",
        "  <IconFrame />",
        "</DropdownMenuItem>",
      ]),
    ).toEqual([]);
  });
});

describe("three-dot-ellipsis", () => {
  it("flags three periods in catalog strings and JSX text", () => {
    expect(
      check(CATALOG, [
        "export default {",
        '  saving: "Saving...",',
        "  searchPlaceholder: 'Search forms...',",
        "};",
      ]),
    ).toEqual([
      { line: 2, rule: "three-dot-ellipsis" },
      { line: 3, rule: "three-dot-ellipsis" },
    ]);
    expect(check(TSX, ["<span>Loading...</span>"])).toEqual([
      { line: 1, rule: "three-dot-ellipsis" },
    ]);
  });

  it("ignores spreads, the ellipsis character, and plain .ts files", () => {
    expect(
      check(TSX, [
        "const next = [...items, { ...item }];",
        "<Item {...props} />",
        'const label = "Saving…";',
      ]),
    ).toEqual([]);
    expect(
      check("templates/forms/server/lib/log.ts", ['log("Saving...");']),
    ).toEqual([]);
  });

  it("honors its pragma", () => {
    expect(
      check(TSX, [
        "// guard:allow-three-dots - matches the provider's key prefix",
        'placeholder="SG...."',
      ]),
    ).toEqual([]);
  });
});

describe("title-ellipsis", () => {
  it("flags title keys and dialog titles that end in an ellipsis", () => {
    expect(
      check(CATALOG, [
        "export default {",
        '  renameTitle: "Rename form…",',
        '  title: "Importing...",',
        "};",
      ]).filter(({ rule }) => rule === "title-ellipsis"),
    ).toEqual([
      { line: 2, rule: "title-ellipsis" },
      { line: 3, rule: "title-ellipsis" },
    ]);
    expect(check(TSX, ["<DialogTitle>Rename form…</DialogTitle>"])).toEqual([
      { line: 1, rule: "title-ellipsis" },
    ]);
  });

  it("ignores keys that only contain 'title' and bare ellipsis placeholders", () => {
    expect(
      check(CATALOG, [
        "export default {",
        '  titleGenerationQueued: "Generating title…",',
        '  renameItem: "Rename…",',
        '  title: "…",',
        "};",
      ]),
    ).toEqual([]);
  });

  it("honors its pragma", () => {
    expect(
      check(CATALOG, [
        "// guard:allow-title-ellipsis - progress title while indexing",
        '  indexingTitle: "Indexing…",',
      ]),
    ).toEqual([]);
  });
});

describe("hand-rolled-destructive", () => {
  it("flags bg-destructive on AlertDialogAction and Button", () => {
    expect(
      check(TSX, [
        "<AlertDialogAction",
        "  onClick={() => remove(id)}",
        '  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"',
        ">",
        '<Button className="bg-destructive text-white">Delete</Button>',
      ]),
    ).toEqual([
      { line: 3, rule: "hand-rolled-destructive" },
      { line: 5, rule: "hand-rolled-destructive" },
    ]);
  });

  it("allows the variant, state-prefixed classes, and other components", () => {
    expect(
      check(TSX, [
        '<AlertDialogAction variant="destructive" onClick={remove}>',
        '<Button variant="ghost" className="hover:bg-destructive/10">',
        '<ButtonGroup className="bg-destructive">',
        '<div className="bg-destructive" />',
      ]),
    ).toEqual([]);
  });

  it("honors its pragma", () => {
    expect(
      check(TSX, [
        "{/* guard:allow-destructive-class - recording indicator, not an action */}",
        '<Button className="bg-destructive">',
      ]),
    ).toEqual([]);
  });
});

describe("added-lines filter", () => {
  it("reports only lines the branch added", () => {
    const lines = [
      "<DropdownMenuItem><IconTrash />Delete</DropdownMenuItem>",
      "<DropdownMenuItem><IconCopy />Copy</DropdownMenuItem>",
    ];
    expect(check(TSX, lines, [2])).toEqual([
      { line: 2, rule: "menu-leading-icon" },
    ]);
    expect(check(TSX, lines, [])).toEqual([]);
  });
});

describe("isGuardedPath", () => {
  it("covers app and package source, not tests, builds, or scripts", () => {
    expect(isGuardedPath(TSX)).toBe(true);
    expect(isGuardedPath("packages/toolkit/src/ui/menu.tsx")).toBe(true);
    expect(isGuardedPath("community-templates/a/app/i18n/en-US.ts")).toBe(true);
    expect(isGuardedPath("templates/forms/app/pages/Page.test.tsx")).toBe(
      false,
    );
    expect(isGuardedPath("templates/forms/dist/index.tsx")).toBe(false);
    expect(isGuardedPath("scripts/guard-ui-blocks.ts")).toBe(false);
    expect(isGuardedPath("packages/toolkit/README.md")).toBe(false);
  });
});
