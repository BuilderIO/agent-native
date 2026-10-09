import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const editorToolbarSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "EditorToolbar.tsx"),
  "utf8",
);
const globalCssSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../global.css"),
  "utf8",
);

describe("EditorToolbar layout contract", () => {
  it("keeps the title input measuring its own width without flex-shrinking", () => {
    expect(editorToolbarSource).toContain(
      '"min-w-0 max-w-[500px] bg-transparent text-sm font-medium text-foreground/90 outline-none focus:text-foreground"',
    );
    expect(editorToolbarSource).toContain(
      'widgetEmbed ? "shrink truncate" : "shrink-0"',
    );
    expect(editorToolbarSource).toContain(
      "style={{ width: `${titleInputWidth}px` }}",
    );
  });

  it("drops the deck-list link and the agent panel controls inside an MCP App widget", () => {
    expect(editorToolbarSource).toContain(
      "const widgetEmbed = useIsMcpAppWidgetEmbed();",
    );
    expect(editorToolbarSource).toMatch(
      /\{!widgetEmbed && \(\s*<Tooltip>\s*<TooltipTrigger asChild>\s*<Link\s+to="\/home"/,
    );
    expect(editorToolbarSource).toMatch(
      /\{!widgetEmbed && \(\s*<div className="flex items-center gap-1">\s*<RunsTray pollMs=\{0\} \/>\s*<AgentToggleButton \/>/,
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
    expect(editorToolbarSource).toContain(
      '<div className="ml-auto flex shrink-0 items-center gap-1">',
    );
  });

  it("keeps the AI presence indicator beside the top-right editor actions", () => {
    const presenceIndex = editorToolbarSource.indexOf("<PresenceBar");
    const actionClusterIndex = editorToolbarSource.indexOf(
      '<div className="ml-auto flex shrink-0 items-center gap-1">',
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

  it("keeps the widget toolbars touch sized in a narrow pane and on touch screens", () => {
    const touchRule =
      /:is\(\.deck-editor-toolbar, \.slide-context-toolbar\)\s*:is\(button, input, \[role="combobox"\]\) \{\s*min-width: 2\.5rem;\s*min-height: 2\.5rem;\s*\}/g;
    expect(globalCssSource).toMatch(
      /@container deck-editor \(max-width: 46rem\) \{\s*\.deck-editor-shell\[data-slides-widget="true"\]/,
    );
    expect(globalCssSource).toMatch(
      /@media \(pointer: coarse\) \{\s*\.deck-editor-shell\[data-slides-widget="true"\]/,
    );
    expect(globalCssSource.match(touchRule)).toHaveLength(2);
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
