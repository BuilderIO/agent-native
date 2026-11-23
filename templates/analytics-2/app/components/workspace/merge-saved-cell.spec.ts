import { describe, expect, it } from "vitest";

import type { ProjectDocument } from "@/lib/model/contracts";

import { mergeSavedCell } from "./merge-saved-cell";

function project(
  cells: { id: string; updatedAt: string; value: string }[],
  title = "current",
) {
  return {
    id: "project",
    workingVersionId: "version",
    title,
    cells,
  } as unknown as ProjectDocument;
}
const saved = project(
  [
    { id: "a", updatedAt: "revision-2", value: "saved" },
    { id: "b", updatedAt: "revision-1", value: "old" },
  ],
  "stale title",
);

describe("cell save response cache reconciliation", () => {
  it("does not resurrect a cell removed while the save was in flight", () => {
    const current = project([
      { id: "b", updatedAt: "revision-2", value: "new" },
    ]);
    expect(mergeSavedCell(current, saved, "a", "revision-1")).toEqual(current);
  });
  it("preserves another cell's deletion while applying the saved cell", () => {
    const current = project([
      { id: "a", updatedAt: "revision-1", value: "old" },
    ]);
    expect(mergeSavedCell(current, saved, "a", "revision-1")).toEqual(
      project([{ id: "a", updatedAt: "revision-2", value: "saved" }]),
    );
  });
  it("does not overwrite a newer cell edit with a delayed save response", () => {
    const current = project([
      { id: "a", updatedAt: "revision-3", value: "newer" },
    ]);
    expect(mergeSavedCell(current, saved, "a", "revision-1")).toEqual(current);
  });
  it("updates only the saved cell at the expected revision", () => {
    const current = project([
      { id: "a", updatedAt: "revision-1", value: "old" },
      { id: "b", updatedAt: "revision-2", value: "new" },
    ]);
    expect(mergeSavedCell(current, saved, "a", "revision-1")).toEqual(
      project([
        { id: "a", updatedAt: "revision-2", value: "saved" },
        { id: "b", updatedAt: "revision-2", value: "new" },
      ]),
    );
  });
  it("does not apply a response from another project or working version, or without an expected revision", () => {
    const current = project([
      { id: "a", updatedAt: "revision-1", value: "old" },
    ]);
    expect(
      mergeSavedCell(current, { ...saved, id: "other" }, "a", "revision-1"),
    ).toEqual(current);
    expect(
      mergeSavedCell(
        current,
        { ...saved, workingVersionId: "other" },
        "a",
        "revision-1",
      ),
    ).toEqual(current);
    expect(mergeSavedCell(current, saved, "a", undefined)).toEqual(current);
  });
});
