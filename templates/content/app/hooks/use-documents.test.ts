import { describe, expect, it } from "vitest";
import type { Document } from "@shared/api";
import { buildDocumentTree } from "./use-documents";

function doc(id: string, parentId: string | null, position = 0): Document {
  return {
    id,
    parentId,
    position,
    title: id,
    content: "",
    icon: null,
    isFavorite: false,
    hideFromSearch: false,
    visibility: "private",
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
  };
}

describe("buildDocumentTree", () => {
  it("keeps cyclic parent references renderable as roots", () => {
    const tree = buildDocumentTree([doc("a", "b"), doc("b", "a")]);

    expect(tree.map((node) => node.id).sort()).toEqual(["a", "b"]);
    expect(tree.every((node) => node.children.length === 0)).toBe(true);
  });

  it("ignores duplicate document ids instead of creating self-recursive nodes", () => {
    const tree = buildDocumentTree([
      doc("a", null),
      doc("a", "a", 1),
      doc("b", "a"),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("a");
    expect(tree[0].children.map((node) => node.id)).toEqual(["b"]);
  });
});
