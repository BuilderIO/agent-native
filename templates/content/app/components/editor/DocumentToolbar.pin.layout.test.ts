import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const toolbarSource = readFileSync(
  new URL("./DocumentToolbar.tsx", import.meta.url),
  "utf8",
);
const editorSource = readFileSync(
  new URL("./DocumentEditor.tsx", import.meta.url),
  "utf8",
);
const sidebarSource = readFileSync(
  new URL("../sidebar/DocumentSidebar.tsx", import.meta.url),
  "utf8",
);
const treeItemSource = readFileSync(
  new URL("../sidebar/DocumentTreeItem.tsx", import.meta.url),
  "utf8",
);
const databaseSidebarSource = readFileSync(
  new URL("../editor/database/sidebar.tsx", import.meta.url),
  "utf8",
);

describe("page menu Pin/Unpin", () => {
  it("adds a Pin/Unpin item to the page menu near Copy page link and Info", () => {
    const copyIndex = toolbarSource.indexOf("editor.toolbar.copyPageLink");
    const pinIndex = toolbarSource.indexOf("onToggleFavorite(!isFavorite)");
    const infoIndex = toolbarSource.indexOf("editor.toolbar.info");

    expect(copyIndex).toBeGreaterThan(-1);
    expect(pinIndex).toBeGreaterThan(-1);
    expect(infoIndex).toBeGreaterThan(-1);
    expect(pinIndex).toBeGreaterThan(copyIndex);
    expect(pinIndex).toBeLessThan(infoIndex);
  });

  it("toggles the pin by calling onToggleFavorite with the inverted state", () => {
    expect(toolbarSource).toContain("onToggleFavorite(!isFavorite)");
  });

  it("swaps the label between Pin and Unpin based on the current pinned state", () => {
    expect(toolbarSource).toContain("editor.toolbar.unpin");
    expect(toolbarSource).toContain("editor.toolbar.pin");
  });

  it("uses a pin glyph for pinning in the page menu and sidebar", () => {
    for (const source of [
      toolbarSource,
      sidebarSource,
      treeItemSource,
      databaseSidebarSource,
    ]) {
      expect(source).toContain("IconPin");
      expect(source).not.toContain("IconStar");
    }
  });

  it("only renders the item when a toggle handler is provided", () => {
    expect(toolbarSource).toContain("onToggleFavorite ? (");
  });

  it("reuses the existing update-document favorite mutation instead of a new pin action", () => {
    expect(editorSource).toContain("id: documentId, isFavorite: nextFavorite");
    expect(editorSource).not.toContain("pin-document");
    expect(editorSource).not.toContain("unpin-document");
  });

  it("wires the page menu to the current document isFavorite state", () => {
    expect(editorSource).toContain("isFavorite={document.isFavorite}");
    expect(editorSource).toContain("onToggleFavorite={handleToggleFavorite}");
  });
});
