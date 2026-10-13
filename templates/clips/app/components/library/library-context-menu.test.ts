import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildLibraryActionHrefs } from "./library-action-hrefs";

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

  it("offers scoped ingestion actions from the empty library canvas", () => {
    const gridSource = readSource("./library-grid.tsx");

    expect(gridSource).toContain("buildLibraryActionHrefs");
    expect(gridSource).toContain("useUploadVideoPicker");
    expect(gridSource).toContain('t("preRecord.uploadVideo")');
    expect(gridSource).toContain('t("preRecord.importLoom")');
    expect(gridSource).toContain("openUploadPicker(uploadHref)");
    expect(gridSource).toContain("<Link to={importLoomHref}>");

    expect(buildLibraryActionHrefs({})).toEqual({
      recordHref: "/record",
      uploadHref: "/record?autoUpload=1",
      importLoomHref: "/import",
    });
    expect(
      buildLibraryActionHrefs({ spaceId: "space-1", folderId: "folder-1" }),
    ).toEqual({
      recordHref: "/record?spaceId=space-1&folderId=folder-1",
      uploadHref: "/record?spaceId=space-1&folderId=folder-1&autoUpload=1",
      importLoomHref: "/import?spaceId=space-1&folderId=folder-1",
    });
  });
});
