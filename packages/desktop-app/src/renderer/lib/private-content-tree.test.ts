import { describe, expect, it } from "vitest";

import { privateContentTree } from "./private-content-tree.js";

function document(id: string, parentId: string | null, position: number) {
  return {
    id,
    parentId,
    position,
    title: id,
    contentPreview: "",
  } as never;
}

describe("Private Content renderer tree", () => {
  it("orders siblings and nests child pages deterministically", () => {
    expect(
      privateContentTree([
        document("b", null, 2),
        document("child", "a", 0),
        document("a", null, 1),
      ]).map(({ document: value, depth }) => [value.id, depth]),
    ).toEqual([
      ["a", 0],
      ["child", 1],
      ["b", 0],
    ]);
  });

  it("bounds malformed cycles and treats orphans as roots", () => {
    expect(
      privateContentTree([
        document("a", "b", 0),
        document("b", "a", 0),
        document("orphan", "missing", 0),
      ]).map(({ document: value }) => value.id),
    ).toEqual(["orphan"]);
  });
});
