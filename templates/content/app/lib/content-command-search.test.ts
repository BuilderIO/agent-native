import { describe, expect, it } from "vitest";

import {
  contentCommandDocumentPath,
  groupContentCommandSearchResults,
  type CommandSearchDocumentResult,
} from "./content-command-search";

function document(
  id: string,
  title: string,
  snippet = "",
): CommandSearchDocumentResult {
  return {
    id,
    parentId: null,
    title,
    icon: null,
    snippet,
    contentLength: snippet.length,
    hideFromSearch: false,
    updatedAt: "2026-06-30T00:00:00.000Z",
  };
}

describe("content command search", () => {
  it("groups documents, databases, and local-file results", () => {
    const groups = groupContentCommandSearchResults({
      query: "launch",
      documents: [
        document("doc-1", "Launch notes", "Body snippet"),
        document(
          "local-file:ZG9jcy9sYXVuY2gubWQ",
          "Local launch note",
          "Local",
        ),
        document("local-folder:docs", "Docs folder", "Folder"),
      ],
      databases: [
        {
          databaseId: "db-1",
          documentId: "db-doc-1",
          title: "Launch calendar",
        },
        {
          databaseId: "db-2",
          documentId: "db-doc-2",
          title: "Ideas",
        },
      ],
    });

    expect(groups.documents.map((doc) => doc.id)).toEqual(["doc-1"]);
    expect(groups.localFiles.map((doc) => doc.id)).toEqual([
      "local-file:ZG9jcy9sYXVuY2gubWQ",
      "local-folder:docs",
    ]);
    expect(groups.databases.map((database) => database.databaseId)).toEqual([
      "db-1",
    ]);
  });

  it("uses document page routes for selectable results", () => {
    expect(contentCommandDocumentPath("doc-1")).toBe("/page/doc-1");
    expect(contentCommandDocumentPath("local-file:ZG9jcy9sYXVuY2gubWQ")).toBe(
      "/page/local-file:ZG9jcy9sYXVuY2gubWQ",
    );
    expect(contentCommandDocumentPath("local-file:docs/launch.md")).toBe(
      "/page/local-file:docs/launch.md",
    );
  });

  it("does not duplicate database-backed pages as document results", () => {
    const groups = groupContentCommandSearchResults({
      query: "launch",
      documents: [
        document("doc-1", "Launch notes"),
        document("db-doc-1", "Launch calendar"),
      ],
      databases: [
        {
          databaseId: "db-1",
          documentId: "db-doc-1",
          title: "Launch calendar",
        },
      ],
    });

    expect(groups.documents.map((doc) => doc.id)).toEqual(["doc-1"]);
    expect(groups.databases.map((database) => database.documentId)).toEqual([
      "db-doc-1",
    ]);
  });

  it("excludes hidden documents from command search groups", () => {
    const hiddenDocument = document("hidden-doc", "Hidden launch note");
    hiddenDocument.hideFromSearch = true;
    const hiddenLocalFile = document(
      "local-file:aGlkZGVuLmxhdW5jaC5tZA",
      "Hidden local launch note",
    );
    hiddenLocalFile.hideFromSearch = true;

    const groups = groupContentCommandSearchResults({
      query: "launch",
      documents: [
        document("doc-1", "Launch notes"),
        hiddenDocument,
        hiddenLocalFile,
      ],
      databases: [],
    });

    expect(groups.documents.map((doc) => doc.id)).toEqual(["doc-1"]);
    expect(groups.localFiles).toEqual([]);
  });
});
