import type { ContentDatabaseItem, DocumentProperty } from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  firstLocalSourceDocumentId,
  localSourceItemIdentity,
  projectLocalSourceHierarchy,
} from "./local-source-hierarchy";

function systemProperty(
  role: "files_parent" | "files_source",
  value: string | string[] | null,
): DocumentProperty {
  return {
    definition: {
      id: role,
      databaseId: "files",
      systemRole: role,
      name: role,
      type: role === "files_parent" ? "relation" : "multi_select",
      visibility: "always_show",
      options: {},
      position: 0,
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:00:00.000Z",
    },
    value,
    editable: false,
  };
}

function fileItem(sourceId: string, path: string): ContentDatabaseItem {
  const id = `${sourceId}:${path}`;
  return {
    id: `membership:${id}`,
    databaseId: "files",
    document: {
      id,
      parentId: null,
      title: path.split("/").pop()!,
      content: "",
      description: "",
      icon: null,
      position: 0,
      isFavorite: false,
      hideFromSearch: false,
      visibility: "private",
      accessRole: "owner",
      canView: true,
      canComment: true,
      canEdit: true,
      canManage: true,
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:00:00.000Z",
      source: {
        mode: "local-files",
        kind: "file",
        path,
        rootPath: `${sourceId}-root`,
      },
    },
    position: 0,
    properties: [
      systemProperty("files_parent", null),
      systemProperty("files_source", [sourceId]),
    ],
  };
}

describe("local Source hierarchy", () => {
  it("projects every directory segment without creating a Page target", () => {
    const [nested, research, file] = projectLocalSourceHierarchy([
      fileItem("source-a", "nested/research/deep-note.md"),
    ]);

    expect(nested.document).toMatchObject({
      title: "nested",
      parentId: null,
      canEdit: false,
      canManage: false,
      source: { kind: "folder", path: "nested" },
    });
    expect(research.document).toMatchObject({
      title: "research",
      parentId: nested.document.id,
      source: { kind: "folder", path: "nested/research" },
    });
    expect(file.document.parentId).toBe(research.document.id);
  });

  it("opens the first real file instead of a projected directory", () => {
    const projected = projectLocalSourceHierarchy([
      fileItem("source-a", "drafts/second-note.md"),
    ]);

    expect(projected[0]?.document.source?.kind).toBe("folder");
    expect(firstLocalSourceDocumentId(projected)).toBe(
      "source-a:drafts/second-note.md",
    );
  });

  it("scopes identical relative paths to stable Source identity", () => {
    const projected = projectLocalSourceHierarchy([
      fileItem("source-a", "notes/daily.md"),
      fileItem("source-b", "notes/daily.md"),
    ]);
    const folders = projected.filter(
      (item) => item.document.source?.kind === "folder",
    );

    expect(folders).toHaveLength(2);
    expect(new Set(folders.map((item) => item.id)).size).toBe(2);
    expect(localSourceItemIdentity(projected[projected.length - 1]!)).toBe(
      "source-b",
    );
  });

  it("selects one working copy and drops obsolete virtual directories", () => {
    const first = projectLocalSourceHierarchy(
      [
        fileItem("source-a", "old/deep/file.md"),
        fileItem("source-b", "other/file.md"),
      ],
      { sourceId: "source-a" },
    );
    const moved = projectLocalSourceHierarchy(
      [fileItem("source-a", "notes/file.md")],
      { sourceId: "source-a" },
    );

    expect(first.some((item) => item.document.source?.path === "other")).toBe(
      false,
    );
    expect(
      first.some((item) => item.document.source?.path === "old/deep"),
    ).toBe(true);
    expect(
      moved.some((item) => item.document.source?.path === "old/deep"),
    ).toBe(false);
    expect(moved.some((item) => item.document.source?.path === "notes")).toBe(
      true,
    );
  });

  it("scopes shared-file folders to the selected Source", () => {
    const item = fileItem("source-a", "nested/shared.md");
    const sourceProperty = item.properties.find(
      (property) => property.definition.systemRole === "files_source",
    );
    if (sourceProperty) sourceProperty.value = ["source-a", "source-b"];

    const projected = projectLocalSourceHierarchy([item], {
      sourceId: "source-b",
    });
    const folder = projected.find(
      (entry) => entry.document.source?.kind === "folder",
    );

    expect(folder?.id).toContain(encodeURIComponent("source-b"));
  });
});
