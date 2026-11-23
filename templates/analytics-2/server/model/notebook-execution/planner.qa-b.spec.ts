import { describe, expect, it } from "vitest";

import { sqlCellContentsSchema } from "../../../app/lib/model/contracts.js";
import { notebookCellIdSchema } from "../../../shared/notebook-snapshot-contract.js";
import { notebookGraph, type ExecutionCell } from "./planner.js";

function blankSql(id: string, source: string): ExecutionCell {
  return {
    id: notebookCellIdSchema.parse(id),
    contents: sqlCellContentsSchema.parse({
      kind: "sql",
      id,
      order: "i",
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      source,
      resultVariable: "dataframe",
      outputResult: true,
      databaseSchema: null,
      dataConnectionId: null,
    }),
  };
}

describe("planning a SQL cell with no source", () => {
  it("admits a blank query so it can run to an empty result", () => {
    for (const source of ["", "  \n "]) {
      const [node] = notebookGraph([blankSql("blank", source)]);
      expect(node?.problem, JSON.stringify(source)).toBeUndefined();
    }
  });
});
