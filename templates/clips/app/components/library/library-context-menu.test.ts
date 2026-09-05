import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(name: string): string {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

describe("library contextual menus", () => {
  it("keeps folder and space actions on the shared context-menu primitives", () => {
    const folderSource = readSource("./folder-tree.tsx");
    const spaceSource = readSource("./space-card.tsx");
    const layoutSource = readSource("./library-layout.tsx");

    for (const source of [folderSource, spaceSource, layoutSource]) {
      expect(source).toContain("<ContextMenu>");
      expect(source).toContain("<ContextMenuTrigger asChild>");
      expect(source).toContain("<ContextMenuContent>");
      expect(source).toContain('t("clipsFinalRaw.view")');
    }

    expect(folderSource).toContain('t("folderTree.rename")');
    expect(folderSource).toContain('t("folderTree.newSubfolder")');
    expect(folderSource).toContain('t("folderTree.delete")');
    expect(spaceSource).toContain('t("spaceDialog.renameSpace")');
    expect(spaceSource).toContain('t("spaceDialog.deleteSpace")');
    expect(layoutSource).toContain("to={`/spaces/${s.id}`}");
  });
});
