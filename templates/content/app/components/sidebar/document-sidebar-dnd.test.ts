import type { Document } from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  parseDocumentDropTargetId,
  resolveDocumentSidebarMove,
} from "./document-sidebar-dnd";

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
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("document sidebar drag targets", () => {
  it("parses explicit target ids", () => {
    expect(parseDocumentDropTargetId("before:doc_1")).toEqual({
      type: "before",
      documentId: "doc_1",
    });
    expect(parseDocumentDropTargetId("after:doc_1")).toEqual({
      type: "after",
      documentId: "doc_1",
    });
    expect(parseDocumentDropTargetId("inside:doc_1")).toEqual({
      type: "inside",
      documentId: "doc_1",
    });
    expect(parseDocumentDropTargetId("root:private")).toEqual({
      type: "root",
      section: "private",
    });
    expect(parseDocumentDropTargetId("doc_1")).toBeNull();
  });

  it("maps before and after targets to sibling positions", () => {
    const documents = [
      doc({ id: "a", position: 0 }),
      doc({ id: "b", position: 1 }),
      doc({ id: "c", position: 2 }),
    ];

    expect(
      resolveDocumentSidebarMove({
        activeId: "c",
        dropTargetId: "before:a",
        documents,
      }),
    ).toEqual({ ok: true, move: { parentId: null, position: 0 } });
    expect(
      resolveDocumentSidebarMove({
        activeId: "a",
        dropTargetId: "after:c",
        documents,
      }),
    ).toEqual({ ok: true, move: { parentId: null, position: 2 } });
  });

  it("maps inside targets to the end of the target children", () => {
    const documents = [
      doc({ id: "parent", position: 0 }),
      doc({ id: "existing", parentId: "parent", position: 0 }),
      doc({ id: "active", position: 1 }),
    ];

    expect(
      resolveDocumentSidebarMove({
        activeId: "active",
        dropTargetId: "inside:parent",
        documents,
      }),
    ).toEqual({ ok: true, move: { parentId: "parent", position: 1 } });
  });

  it("maps root targets to top-level positions", () => {
    const documents = [
      doc({ id: "root", position: 0 }),
      doc({ id: "child", parentId: "root", position: 0 }),
    ];

    expect(
      resolveDocumentSidebarMove({
        activeId: "child",
        dropTargetId: "root:private",
        documents,
      }),
    ).toEqual({ ok: true, move: { parentId: null, position: 1 } });
  });

  it("rejects cross-visibility drops", () => {
    const documents = [
      doc({ id: "private", visibility: "private", position: 0 }),
      doc({ id: "org", visibility: "org", position: 0 }),
    ];

    expect(
      resolveDocumentSidebarMove({
        activeId: "private",
        dropTargetId: "inside:org",
        documents,
      }),
    ).toMatchObject({ ok: false });
    expect(
      resolveDocumentSidebarMove({
        activeId: "private",
        dropTargetId: "root:org",
        documents,
      }),
    ).toMatchObject({ ok: false });
  });

  it("rejects drops onto read-only, local, or descendant targets", () => {
    const documents = [
      doc({ id: "parent", position: 0 }),
      doc({ id: "child", parentId: "parent", position: 0 }),
      doc({ id: "readonly", position: 1, canEdit: false }),
      doc({
        id: "local",
        position: 2,
        source: { mode: "local-files", kind: "file" },
      }),
    ];

    expect(
      resolveDocumentSidebarMove({
        activeId: "parent",
        dropTargetId: "inside:child",
        documents,
      }),
    ).toMatchObject({ ok: false });
    expect(
      resolveDocumentSidebarMove({
        activeId: "child",
        dropTargetId: "inside:readonly",
        documents,
      }),
    ).toMatchObject({ ok: false });
    expect(
      resolveDocumentSidebarMove({
        activeId: "child",
        dropTargetId: "inside:local",
        documents,
      }),
    ).toMatchObject({ ok: false });
  });
});
