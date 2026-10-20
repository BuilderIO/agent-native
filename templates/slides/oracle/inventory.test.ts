import { describe, expect, it } from "vitest";

import { measuredInventory } from "./inventory";
import type { OracleRow } from "./schema";

function row(id: string, status: OracleRow["status"]): OracleRow {
  return {
    id,
    family: "1",
    familyName: "Fixture",
    probe: "probe",
    result: "result",
    notes: "",
    confidence: status === "gap" ? "gap" : "high",
    status,
    claim: "positive",
    inputPath: "unknown",
  };
}

describe("measuredInventory", () => {
  it("lists every row id, sorted, and the unmeasured ones", () => {
    const inventory = measuredInventory([
      row("10.1", "measured"),
      row("1.9", "gap"),
      row("2.1", "deviation"),
    ]);
    expect(inventory).toEqual({
      measuredIds: ["1.9", "10.1", "2.1"],
      unmeasuredIds: ["1.9"],
    });
  });

  it("changes when a measured row is relabeled gap", () => {
    const before = measuredInventory([row("1.1", "measured")]);
    const after = measuredInventory([row("1.1", "gap")]);
    expect(after.measuredIds).toEqual(before.measuredIds);
    expect(after.unmeasuredIds).not.toEqual(before.unmeasuredIds);
  });

  it("changes when a row is removed", () => {
    const before = measuredInventory([
      row("1.1", "measured"),
      row("1.2", "measured"),
    ]);
    const after = measuredInventory([row("1.1", "measured")]);
    expect(after.measuredIds).not.toEqual(before.measuredIds);
  });

  it("refuses duplicate ids, which would hide a removal behind a copy", () => {
    expect(() =>
      measuredInventory([row("1.1", "measured"), row("1.1", "measured")]),
    ).toThrow(/duplicate/i);
  });
});
