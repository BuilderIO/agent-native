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
      'className="min-w-0 max-w-[500px] shrink-0 bg-transparent text-sm font-medium text-foreground/90 outline-none focus:text-foreground"',
    );
    expect(editorToolbarSource).toContain(
      "style={{ width: `${titleInputWidth}px` }}",
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

  it("keeps media below slide tools and leaves comments as a single item", () => {
    expect(
      editorToolbarSource.indexOf('{t("editorToolbar.media")}'),
    ).toBeGreaterThan(
      editorToolbarSource.indexOf('{t("editorToolbar.slideTools")}'),
    );
    expect(editorToolbarSource).not.toContain(
      '<DropdownMenuLabel>\n                  {t("editorToolbar.comments")}\n                </DropdownMenuLabel>',
    );
  });

  it("lets the wide contextual toolbar scroll instead of clipping rare overflow", () => {
    expect(globalCssSource).toContain(
      ".deck-editor-context-toolbar-host {\n  min-width: 0;\n  overflow: auto;\n}",
    );
  });
});
