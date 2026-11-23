import { describe, expect, it } from "vitest";

import { sampleTables } from "../../app/lib/model/sample-data";

describe("report A2-FIND-1120F-S2-7: sample table column descriptions", () => {
  it("provides a non-empty description for every built-in sample table column", () => {
    const tables = sampleTables();
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      expect(table.columns.length).toBeGreaterThan(0);
      for (const column of table.columns) {
        expect(
          column.description?.trim().length ?? 0,
          `${table.name}.${column.name} should have a description`,
        ).toBeGreaterThan(0);
      }
    }
  });
});
