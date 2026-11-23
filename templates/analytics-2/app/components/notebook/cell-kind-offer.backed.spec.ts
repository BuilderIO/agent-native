import { describe, expect, it } from "vitest";

import { addCellMenuEntries, creatableMenuKinds } from "@/lib/model/cell-types";

import { ADDABLE_CELL_KINDS } from "../workspace/NotebookPage";

describe("add-cell offers are backed", () => {
  const creatable = creatableMenuKinds([]);
  const offered = addCellMenuEntries().filter((entry) =>
    creatable.has(entry.kind),
  );

  it("every offered non-input kind is in the page's addable list", () => {
    const missing = offered
      .filter((entry) => entry.kind !== "input")
      .map((entry) => entry.kind)
      .filter(
        (kind) => !(ADDABLE_CELL_KINDS as readonly string[]).includes(kind),
      );
    expect(missing).toEqual([]);
  });
});

// oracle-change: test-audit campaign removed whole low-value tests, see PR 498
