import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// source-read-ok: pins the toolbar's contextual layout and host integration boundaries.
const editorToolbarSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "EditorToolbar.tsx"),
  "utf8",
);
const globalCssSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../global.css"),
  "utf8",
);
// The top-right action cluster doubles as the anchor for floating panels.
const TOP_RIGHT_ACTIONS_OPEN_TAG =
  /<div\s+ref=\{panelAnchorRef\}\s+className="ml-auto flex shrink-0 items-center gap-1"\s*>/;

describe("EditorToolbar layout contract", () => {
  it("keeps the title input measuring its own width without flex-shrinking", () => {
    const widthStyle = "style={{ width: `${titleInputWidth}px` }}";
    const widthStyleIndex = editorToolbarSource.indexOf(widthStyle);
    const titleInputStart = editorToolbarSource.lastIndexOf(
      "<Input",
      widthStyleIndex,
    );
    const titleInputEnd = editorToolbarSource.indexOf("/>", widthStyleIndex);
    const titleInput = editorToolbarSource.slice(
      titleInputStart,
      titleInputEnd,
    );
    const titleInputClasses = titleInput.match(/className="([^"]+)"/)?.[1];

    expect(widthStyleIndex).toBeGreaterThan(-1);
    expect(titleInputStart).toBeGreaterThan(-1);
    expect(titleInputEnd).toBeGreaterThan(titleInputStart);
    expect(titleInputClasses?.split(/\s+/)).toEqual(
      expect.arrayContaining(["min-w-0", "max-w-[500px]", "shrink-0"]),
    );
  });

  it("hides the save status pill only inside a read-only directory widget", () => {
    expect(editorToolbarSource).toContain(
      "const readOnlyWidget = useIsMcpDirectoryWidgetReadOnlyEmbed();",
    );
    expect(editorToolbarSource).toMatch(
      /\{!readOnlyWidget && \(canEdit \|\| saveFailed\) && \(\s*<SaveStatusIndicator/,
    );
  });

  it("leaves the contextual toolbar the full row segment instead of splitting it with a flex spacer", () => {
    expect(editorToolbarSource).toContain('<div className="w-2 shrink-0" />');
    expect(editorToolbarSource).not.toContain(
      '<div className="flex-1 min-w-2" />',
    );
  });

  it("pushes the top-right actions to the row edge when the style toolbar moves below", () => {
    expect(editorToolbarSource).toMatch(TOP_RIGHT_ACTIONS_OPEN_TAG);
  });

  it("keeps the AI presence indicator beside the top-right editor actions", () => {
    const presenceIndex = editorToolbarSource.indexOf("<PresenceBar");
    const actionClusterIndex = editorToolbarSource.search(
      TOP_RIGHT_ACTIONS_OPEN_TAG,
    );
    const menuIndex = editorToolbarSource.indexOf("<DropdownMenu>");
    const shareIndex = editorToolbarSource.indexOf("{/* Framework share");

    expect(presenceIndex).toBeGreaterThan(actionClusterIndex);
    expect(presenceIndex).toBeLessThan(menuIndex);
    expect(menuIndex).toBeLessThan(shareIndex);
    expect(actionClusterIndex).toBeGreaterThan(-1);
    expect(presenceIndex).toBeGreaterThan(-1);
    expect(menuIndex).toBeGreaterThan(-1);
    expect(shareIndex).toBeGreaterThan(-1);
    expect(editorToolbarSource).toContain('className="flex-shrink-0 pl-2"');
  });

  it("lets the overflow menu use most of the viewport height", () => {
    expect(editorToolbarSource).toContain(
      'className="max-h-[90vh] w-64 overflow-y-auto"',
    );
  });

  it("keeps the overflow menu focused on the remaining editor actions", () => {
    expect(editorToolbarSource).not.toContain(
      '{t("editorToolbar.transition")}',
    );
    expect(editorToolbarSource).not.toContain('{t("editorToolbar.media")}');
    expect(editorToolbarSource).not.toContain(
      '{t("editorToolbar.lightTheme")}',
    );
    expect(editorToolbarSource).not.toContain(
      '<DropdownMenuLabel>\n                  {t("editorToolbar.comments")}\n                </DropdownMenuLabel>',
    );
  });

  it("opens the deck in the app through the host bridge", () => {
    expect(editorToolbarSource).toContain("openMcpAppHostLink(editorUrl)");
    expect(
      editorToolbarSource.match(/editorToolbar\.openInAgentNative/g),
    ).toHaveLength(2);
  });

  it("lets the wide contextual toolbar scroll instead of clipping rare overflow", () => {
    expect(globalCssSource).toContain(
      ".deck-editor-context-toolbar-host {\n  min-width: 0;\n  overflow: auto;\n}",
    );
  });
});
