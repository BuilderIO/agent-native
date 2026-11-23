import { describe, expect, it } from "vitest";

import {
  ADDABLE_CELL_KINDS,
  addCellMenuEntries,
  creatableMenuKinds,
  type CellKind,
} from "@/lib/model/cell-types";

import addProjectCell from "../../../actions/add-project-cell";

// The More menu, the page guard and the action used to keep separate kind lists;
// Component was accepted by the action but never reached the menu, so a reader
// could not add the import cell from the notebook (row 425).
describe("add-cell offers match what the action accepts", () => {
  function offeredKinds(supportedAddKinds: CellKind[] = []) {
    const creatable = creatableMenuKinds(supportedAddKinds);
    return new Set(
      addCellMenuEntries()
        .filter((entry) => creatable.has(entry.kind))
        .map((entry) => entry.kind),
    );
  }
  const offered = offeredKinds();
  const withEditors = offeredKinds(["sql", "code"]);

  it("offers Component in the More menu", () => {
    expect(offered.has("component-import")).toBe(true);
  });

  it("offers SQL and Python when enabled and every other accepted kind by default", () => {
    expect(
      new Set(ADDABLE_CELL_KINDS.filter((kind) => !offered.has(kind))),
    ).toEqual(new Set(["sql", "code"]));
    expect(ADDABLE_CELL_KINDS.filter((kind) => !withEditors.has(kind))).toEqual(
      [],
    );
  });

  it("the action accepts every kind the menu offers", () => {
    const schema = (
      addProjectCell as unknown as {
        schema: { safeParse: (v: unknown) => { success: boolean } };
      }
    ).schema;
    for (const kind of withEditors) {
      const parsed = schema.safeParse({
        projectId: "prj_1",
        kind,
        ...(kind === "input" ? { inputType: "DATE" } : {}),
      });
      expect({ kind, ok: parsed.success }).toEqual({ kind, ok: true });
    }
  });
});
