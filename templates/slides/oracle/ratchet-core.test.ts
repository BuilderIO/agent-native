import { describe, expect, it } from "vitest";

import {
  checkCitations,
  parseRecords,
  type TestRecord,
  uncitedMeasured,
} from "./ratchet-core";
import type { OracleRow } from "./schema";

function row(
  id: string,
  status: OracleRow["status"] = "measured",
  claim: OracleRow["claim"] = "positive",
): OracleRow {
  return {
    id,
    family: "1",
    familyName: "Fixture",
    probe: "probe",
    result: "result",
    notes: "",
    confidence: status === "gap" ? "gap" : "high",
    status,
    claim,
    inputPath: "unknown",
  };
}

function record(
  title: string,
  mode: TestRecord["mode"] = "run",
  file = "a.test.ts",
): TestRecord {
  return { file, title, mode };
}

describe("checkCitations", () => {
  it("covers a row with a citation on a test that executes", () => {
    const problems = checkCitations({
      rows: [row("1.1")],
      records: [record("moves (oracle 1.1)")],
      uncitedBaseline: [],
    });
    expect(problems).toEqual([]);
  });

  it("does not cover a row with a citation on a skipped test", () => {
    const problems = checkCitations({
      rows: [row("1.1")],
      records: [record("moves (oracle 1.1)", "skip")],
      uncitedBaseline: [],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/uncitedMeasured is out of date/);
    expect(problems[0]).toMatch(/"1\.1"/);
  });

  it("counts an only test as executed", () => {
    expect(
      uncitedMeasured([row("1.1")], [record("moves (oracle 1.1)", "only")]),
    ).toEqual([]);
  });

  it("reports a citation that names no row", () => {
    const problems = checkCitations({
      rows: [row("1.1")],
      records: [record("moves (oracle 9.9)")],
      uncitedBaseline: ["1.1"],
    });
    expect(problems[0]).toMatch(/name oracle rows that do not exist/);
    expect(problems[0]).toMatch(/9\.9 \(cited in a\.test\.ts\)/);
  });

  it("rejects a title that cites a gap row, even on a skipped test", () => {
    const problems = checkCitations({
      rows: [row("G.snap-to-guides", "gap")],
      records: [record("snaps (oracle G.snap-to-guides)", "skip")],
      uncitedBaseline: [],
    });
    expect(problems[0]).toMatch(/cite gap rows, which are never measured/);
  });

  it("leaves a gap row out of the uncited list", () => {
    expect(
      uncitedMeasured(
        [row("G.snap-to-guides", "gap"), row("1.1")],
        [record("moves (oracle 1.1)")],
      ),
    ).toEqual([]);
  });

  it("passes when the baseline lists exactly the uncited rows", () => {
    const problems = checkCitations({
      rows: [row("1.1"), row("2.1")],
      records: [record("moves (oracle 1.1)")],
      uncitedBaseline: ["2.1"],
    });
    expect(problems).toEqual([]);
  });
});

describe("parseRecords", () => {
  it("reads one record per line and skips blank lines", () => {
    const text = `${JSON.stringify(record("a (oracle 1.1)"))}\n\n${JSON.stringify(record("b", "skip"))}\n`;
    expect(parseRecords(text)).toEqual([
      record("a (oracle 1.1)"),
      record("b", "skip"),
    ]);
  });

  it("throws on a malformed line, naming its number", () => {
    const text = `${JSON.stringify(record("a"))}\n{"file":"a.test.ts","title":"b","mode":"maybe"}\n`;
    expect(() => parseRecords(text)).toThrow(/record 2 is malformed/);
  });
});
