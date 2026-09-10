import type { Document } from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  getDocumentSidebarSections,
  isDirectLocalDocument,
  isImportedLocalSourceDocument,
} from "./document-sidebar-sections";

function doc(overrides: Partial<Document> & Pick<Document, "id">): Document {
  return {
    parentId: null,
    title: overrides.id,
    content: "",
    icon: null,
    position: 0,
    isFavorite: false,
    hideFromSearch: false,
    visibility: "private",
    accessRole: "owner",
    canEdit: true,
    canManage: true,
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
    ...overrides,
  };
}

describe("document sidebar sections", () => {
  it("treats local-file ids as direct local documents", () => {
    const localFile = doc({
      id: "local-file:ZG9jcy9wbGFuLm1keA",
      source: { mode: "local-files", kind: "file", path: "docs/plan.mdx" },
    });
    const importedLocal = doc({
      id: "sql_doc",
      source: { mode: "local-files", kind: "file", path: "docs/plan.mdx" },
    });

    expect(isDirectLocalDocument(localFile)).toBe(true);
    expect(isImportedLocalSourceDocument(localFile)).toBe(false);
    expect(isDirectLocalDocument(importedLocal)).toBe(false);
    expect(isImportedLocalSourceDocument(importedLocal)).toBe(true);
  });

  it("shows direct local-file favorites in local-file mode", () => {
    const favorite = doc({
      id: "local-file:ZG9jcy9mYXZvcml0ZS5tZHg",
      title: "Favorite local file",
      isFavorite: true,
      source: {
        mode: "local-files",
        kind: "file",
        path: "docs/favorite.mdx",
      },
    });
    const normal = doc({
      id: "local-file:ZG9jcy9ub3JtYWwubWR4",
      source: { mode: "local-files", kind: "file", path: "docs/normal.mdx" },
    });

    const sections = getDocumentSidebarSections([favorite, normal]);

    expect(sections.localFileMode).toBe(true);
    expect(sections.showFavorites).toBe(true);
    expect(sections.favorites.map((document) => document.id)).toEqual([
      favorite.id,
    ]);
    expect(
      sections.localSourceDocuments.map((document) => document.id),
    ).toEqual([favorite.id, normal.id]);
  });

  it("keeps imported local-source documents out of database source sections", () => {
    const importedFavorite = doc({
      id: "imported_local",
      title: "Imported local source",
      isFavorite: true,
      source: {
        mode: "local-files",
        kind: "file",
        path: "content/imported.mdx",
      },
    });
    const privateFavorite = doc({
      id: "private_doc",
      title: "Private doc",
      isFavorite: true,
    });

    const sections = getDocumentSidebarSections([
      importedFavorite,
      privateFavorite,
    ]);

    expect(sections.localFileMode).toBe(false);
    expect(
      sections.localSourceDocuments.map((document) => document.id),
    ).toEqual([importedFavorite.id]);
    expect(sections.databaseDocuments.map((document) => document.id)).toEqual([
      privateFavorite.id,
    ]);
    expect(sections.favorites.map((document) => document.id)).toEqual([
      privateFavorite.id,
    ]);
  });

  it("groups imported local-source documents under source folders", () => {
    const guide = doc({
      id: "imported_guide",
      title: "Guide",
      source: {
        mode: "local-files",
        kind: "file",
        path: "docs/guide.mdx",
        rootPath: "docs",
      },
    });
    const intro = doc({
      id: "imported_intro",
      title: "Intro",
      source: {
        mode: "local-files",
        kind: "file",
        path: "docs/intro.mdx",
        rootPath: "docs",
      },
    });

    const sections = getDocumentSidebarSections([guide, intro]);

    expect(
      sections.localSourceDocuments.map((document) => document.id),
    ).toEqual(["local-source-folder:docs", guide.id, intro.id]);
    expect(sections.localSourceDocuments[0]).toMatchObject({
      title: "Docs",
      canEdit: false,
      source: { mode: "local-files", kind: "folder", path: "docs" },
    });
    expect(sections.localSourceDocuments[1].parentId).toBe(
      "local-source-folder:docs",
    );
    expect(sections.localSourceDocuments[2].parentId).toBe(
      "local-source-folder:docs",
    );
  });

  it("deduplicates imported local-source documents by source path", () => {
    const first = doc({
      id: "imported_first",
      title: "Guide",
      source: {
        mode: "local-files",
        kind: "file",
        path: "docs/guide.mdx",
        rootPath: "docs",
      },
    });
    const duplicate = doc({
      id: "imported_duplicate",
      title: "Guide duplicate",
      position: 1,
      source: {
        mode: "local-files",
        kind: "file",
        path: "docs/guide.mdx",
        rootPath: "docs",
      },
    });

    const sections = getDocumentSidebarSections([first, duplicate]);

    expect(
      sections.localSourceDocuments.map((document) => document.id),
    ).toEqual(["local-source-folder:docs", first.id]);
  });
});
