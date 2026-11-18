// oracle-change: Annotate and the Draw tool were removed from Design, so the Draw shortcut row and its lab filter tests are gone
import { describe, expect, it } from "vitest";

import { buildShortcutSections } from "./keyboard-shortcut-sections";
import {
  DESIGN_SHORTCUT_CATEGORIES,
  DESIGN_SHORTCUTS,
  formatShortcutKeycaps,
  formatShortcutLabel,
} from "./keyboard-shortcuts";

// Monaco code editor removed from Design; its tests went with it.
// oracle-change(templates/design/app/components/design/code-workbench/CodeWorkbenchLoader.test.tsx): the Monaco code editor was removed from Design, so its tests are deleted with it
// oracle-change(templates/design/app/components/design/code-workbench/editor/BufferSync.test.tsx): the Monaco code editor was removed from Design, so its tests are deleted with it
// oracle-change(templates/design/app/components/design/code-workbench/editor/StatusBar.test.ts): the Monaco code editor was removed from Design, so its tests are deleted with it
// oracle-change(templates/design/app/components/design/code-workbench/editor/monaco-theme.test.ts): the Monaco code editor was removed from Design, so its tests are deleted with it
// oracle-change(templates/design/app/components/design/code-workbench/editor/tab-drag.test.ts): the Monaco code editor was removed from Design, so its tests are deleted with it
// oracle-change(templates/design/app/components/design/code-workbench/explorer/ExplorerView.test.tsx): the Monaco code editor was removed from Design, so its tests are deleted with it
// oracle-change(templates/design/app/components/design/code-workbench/explorer/FileTree.test.tsx): the Monaco code editor was removed from Design, so its tests are deleted with it
// oracle-change(templates/design/app/components/design/code-workbench/format/format-on-open.test.ts): the Monaco code editor was removed from Design, so its tests are deleted with it
// oracle-change(templates/design/app/components/design/code-workbench/format/prettier-format.test.ts): the Monaco code editor was removed from Design, so its tests are deleted with it
// oracle-change(templates/design/app/components/design/code-workbench/model-registry.spec.ts): the Monaco code editor was removed from Design, so its tests are deleted with it
// oracle-change(templates/design/app/components/design/code-workbench/quickinput/fuzzy.test.ts): the Monaco code editor was removed from Design, so its tests are deleted with it
// oracle-change(templates/design/app/components/design/code-workbench/search/search-engine.test.ts): the Monaco code editor was removed from Design, so its tests are deleted with it
// oracle-change(templates/design/app/components/design/code-workbench/store.spec.tsx): the Monaco code editor was removed from Design, so its tests are deleted with it
// oracle-change(templates/design/app/components/design/code-workbench/workbench.test.ts): the Monaco code editor was removed from Design, so its tests are deleted with it
// oracle-change(templates/design/app/components/design/code-workbench/workspace/inline-provider.test.ts): the Monaco code editor was removed from Design, so its tests are deleted with it
// oracle-change(templates/design/app/components/design/code-workbench/workspace/localhost-provider.test.ts): the Monaco code editor was removed from Design, so its tests are deleted with it
// oracle-change(templates/design/app/components/design/code-workbench/workspace/tree.test.ts): the Monaco code editor was removed from Design, so its tests are deleted with it
// oracle-change(templates/design/e2e/code-workbench-local-files.spec.ts): the Monaco code editor was removed from Design, so its tests are deleted with it

describe("keyboard shortcuts catalog", () => {
  it("keeps the Design category order and gives every category real commands", () => {
    expect(DESIGN_SHORTCUT_CATEGORIES).toEqual([
      "essential",
      "tools",
      "view",
      "zoom",
      "text",
      "shape",
      "selection",
      "cursor",
      "edit",
      "transform",
      "arrange",
      "components",
      "layout",
    ]);
    for (const category of DESIGN_SHORTCUT_CATEGORIES) {
      expect(
        DESIGN_SHORTCUTS.some((shortcut) => shortcut.category === category),
      ).toBe(true);
    }
  });

  it("has unique ids and only documents wired Design handler names", () => {
    const ids = DESIGN_SHORTCUTS.map((shortcut) => shortcut.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const shortcut of DESIGN_SHORTCUTS) {
      expect(shortcut.handler).toMatch(/^on[A-Z]/);
      expect(shortcut.bindings.length).toBeGreaterThan(0);
    }
  });
  // oracle-change: the Monaco code editor was removed from Design, so its shortcuts section and tests are gone

  it("formats platform modifiers as individual keycaps", () => {
    expect(formatShortcutKeycaps("$mod+shift+p", true)).toEqual([
      "⇧",
      "⌘",
      "P",
    ]);
    expect(formatShortcutKeycaps("ctrl+shift+?", false)).toEqual([
      "Ctrl",
      "Shift",
      "?",
    ]);
    expect(formatShortcutKeycaps("+", true)).toEqual(["+"]);
  });
  it("orders Windows modifiers Ctrl, Alt, Shift and never doubles Ctrl", () => {
    expect(formatShortcutKeycaps("$mod+alt+g", false)).toEqual([
      "Ctrl",
      "Alt",
      "G",
    ]);
    expect(formatShortcutKeycaps("$mod+alt+g", true)).toEqual(["⌥", "⌘", "G"]);
    expect(formatShortcutKeycaps("ctrl+$mod+t", false)).toEqual(["Ctrl", "T"]);
  });

  it("spells menu hints for the viewer's platform, not the author's Mac", () => {
    expect(formatShortcutLabel("$mod+shift+r", true)).toBe("⇧⌘R");
    expect(formatShortcutLabel("$mod+shift+r", false)).toBe("Ctrl+Shift+R");
    expect(formatShortcutLabel("alt+a", true)).toBe("⌥A");
    expect(formatShortcutLabel("alt+a", false)).toBe("Alt+A");
    expect(formatShortcutLabel("", true)).toBe("");
  });

  it("advertises Cmd/Ctrl+\\ for toggling the Design chrome", () => {
    expect(
      DESIGN_SHORTCUTS.find((shortcut) => shortcut.id === "toggle-ui")
        ?.bindings,
    ).toEqual(["$mod+\\"]);
  });

  it("advertises Cmd/Ctrl+Shift+\\ for minimal Design chrome", () => {
    expect(
      DESIGN_SHORTCUTS.find((shortcut) => shortcut.id === "toggle-minimal-ui")
        ?.bindings,
    ).toEqual(["$mod+shift+\\"]);
  });
});

describe("shortcut sections", () => {
  const build = (query: string) =>
    buildShortcutSections({
      query,
      applePlatform: false,
      categoryLabel: (category) => category,
      rowLabel: (labelKey) => labelKey.split(".").pop() ?? labelKey,
    });

  it("returns every category once, in catalog order, with no query", () => {
    expect(build("").map((section) => section.category)).toEqual([
      ...DESIGN_SHORTCUT_CATEGORIES,
    ]);
  });

  it("lists each Design shortcut exactly once across sections", () => {
    const ids = buildShortcutSections({
      query: "",
      applePlatform: true,
      categoryLabel: (category) => category,
      rowLabel: (labelKey) => labelKey,
    })
      .flatMap((section) => section.rows)
      .map((row) => row.id);
    expect(ids.sort()).toEqual(DESIGN_SHORTCUTS.map((item) => item.id).sort());
  });

  it("finds working canvas shortcuts by name", () => {
    const found = (query: string) =>
      build(query)
        .flatMap((section) => section.rows)
        .map((row) => row.id);
    expect(found("rename")).toContain("rename");
    expect(found("toggleHidden")).toContain("toggle-hidden");
    expect(found("toggleLocked")).toContain("toggle-locked");
    expect(found("alignHorizontalCenters")).toContain("align-center-h");
    expect(found("alignVerticalCenters")).toContain("align-center-v");
    expect(found("distributeHorizontal")).toContain("distribute-horizontal");
    expect(found("setOpacity")).toContain("set-opacity");
  });

  it("only lists the vertical distribute chord where it is bound", () => {
    const ids = (applePlatform: boolean) =>
      buildShortcutSections({
        query: "",
        applePlatform,
        categoryLabel: (category) => category,
        rowLabel: (labelKey) => labelKey,
      })
        .flatMap((section) => section.rows)
        .map((row) => row.id);
    expect(ids(true)).toContain("distribute-vertical");
    expect(ids(false)).not.toContain("distribute-vertical");
    expect(ids(false)).toContain("distribute-horizontal");
  });

  it("drops categories with no matching row", () => {
    const sections = build("undo");
    expect(sections.map((section) => section.category)).toEqual(["essential"]);
    expect(sections[0]?.rows.map((row) => row.id)).toEqual(["undo"]);
  });

  it("matches on the key as well as the label", () => {
    const rows = build("alt+1".replace("+", " ")).flatMap(
      (section) => section.rows,
    );
    expect(rows.map((row) => row.id)).toContain("show-layers");
  });

  it("returns nothing for a query that matches no row", () => {
    expect(build("qqqqq")).toEqual([]);
  });

  const rowIds = (query = "") =>
    buildShortcutSections({
      query,
      applePlatform: false,
      categoryLabel: (category) => category,
      rowLabel: (labelKey) => labelKey.split(".").pop() ?? labelKey,
    })
      .flatMap((section) => section.rows)
      .map((row) => row.id);

  it("lists the Text, shape and comment rows and no Draw row", () => {
    expect(rowIds()).toEqual(
      expect.arrayContaining([
        "text-tool",
        "rectangle",
        "line",
        "arrow",
        "ellipse",
        "comment-tool",
        "toggle-comments",
        "pen-tool",
      ]),
    );
    expect(rowIds()).not.toContain("draw-tool");
    expect(rowIds("shift y")).not.toContain("draw-tool");
  });
});
