import { describe, expect, it } from "vitest";

import {
  diffLedgerContent,
  diffLedgerExpectations,
  readMarkdownLedger,
} from "./markdown";
import type { OracleRow } from "./schema";

const HEADER = "| id | action | observed | measurements | conf |";
const SEPARATOR = "|----|--------|----------|--------------|------|";

function table(...rows: string[]): string {
  return ["# Ledger", "", HEADER, SEPARATOR, ...rows].join("\n");
}

function jsonRow(overrides: Partial<OracleRow> = {}): OracleRow {
  return {
    id: "1.5",
    family: "1",
    familyName: "Hover",
    probe: "hover on the border",
    result: "move",
    notes: "screen-px constant",
    confidence: "high",
    status: "measured",
    claim: "positive",
    inputPath: "unknown",
    ...overrides,
  };
}

describe("readMarkdownLedger", () => {
  it("reads each ledger row into its named columns", () => {
    const rows = readMarkdownLedger(
      table("| 1.5 | hover on the border | move | screen-px | high |"),
    );
    expect(rows).toEqual([
      {
        id: "1.5",
        probe: "hover on the border",
        result: "move",
        notes: "screen-px",
        confidence: "high",
      },
    ]);
  });

  it("maps columns by header name, not by position", () => {
    const md = [
      "| conf | observed | id | measurements | action |",
      "|---|---|---|---|---|",
      "| high | move | 1.5 | screen-px | hover on the border |",
    ].join("\n");
    expect(readMarkdownLedger(md)).toEqual([
      {
        id: "1.5",
        probe: "hover on the border",
        result: "move",
        notes: "screen-px",
        confidence: "high",
      },
    ]);
  });

  it("reads an empty measurements cell as an empty string", () => {
    const rows = readMarkdownLedger(
      table("| 1.6 | hover a handle | move | | high |"),
    );
    expect(rows[0].notes).toBe("");
  });

  it("starts a new header after a non-table line", () => {
    const md = [
      HEADER,
      SEPARATOR,
      "| 1.5 | a | b | c | high |",
      "",
      "| id | action | observed | measurements | conf |",
      "|---|---|---|---|---|",
      "| 2.1 | d | e | f | medium |",
    ].join("\n");
    expect(readMarkdownLedger(md).map((row) => row.id)).toEqual(["1.5", "2.1"]);
  });

  it("throws when a table lacks a required column", () => {
    const md = [
      "| id | action | observed | conf |",
      "|---|---|---|---|",
      "| 1.5 | a | b | high |",
    ].join("\n");
    expect(() => readMarkdownLedger(md)).toThrow(/measurements/);
  });

  it("throws when a row's cell count differs from its header", () => {
    expect(() => readMarkdownLedger(table("| 1.5 | a | b | high |"))).toThrow(
      /cells/,
    );
  });

  it("throws on a row that appears before any ledger header", () => {
    expect(() => readMarkdownLedger("| 1.5 | a | b | c | high |")).toThrow(
      /header/,
    );
  });

  it("throws on a duplicate row id, which the id-keyed parity checks would shadow", () => {
    expect(() =>
      readMarkdownLedger(
        table(
          "| 1.5 | hover on the border | move | screen-px | high |",
          "| 1.5 | hover on the border | stay | screen-px | high |",
        ),
      ),
    ).toThrow(/duplicate.*1\.5/i);
  });
});

describe("diffLedgerContent", () => {
  const markdownRow = {
    id: "1.5",
    probe: "hover on the border",
    result: "move",
    notes: "screen-px constant",
    confidence: "high",
  };

  it("reports nothing when the markdown and JSON agree", () => {
    expect(diffLedgerContent([markdownRow], [jsonRow()])).toEqual([]);
  });

  it("reports a changed probe for the same id", () => {
    const problems = diffLedgerContent(
      [{ ...markdownRow, probe: "hover near the border" }],
      [jsonRow()],
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^1\.5: probe differs/);
  });

  it("reports a changed result, notes or confidence", () => {
    const problems = diffLedgerContent(
      [
        {
          ...markdownRow,
          result: "resize",
          notes: "other",
          confidence: "medium",
        },
      ],
      [jsonRow()],
    );
    expect(
      problems.map((line) => line.split(":")[1].trim().split(" ")[0]),
    ).toEqual(["result", "notes", "confidence"]);
  });

  it("compares the full confidence cell when the JSON keeps it in confidenceNote", () => {
    const compound = {
      ...markdownRow,
      confidence: "high (with border), medium (no border)",
    };
    const json = jsonRow({
      confidence: "medium",
      confidenceNote: "high (with border), medium (no border)",
    });
    expect(diffLedgerContent([compound], [json])).toEqual([]);
  });

  it("reports a drift when the confidenceNote no longer matches the markdown", () => {
    const compound = {
      ...markdownRow,
      confidence: "high (with border), medium (no border)",
    };
    const json = jsonRow({ confidence: "medium", confidenceNote: "high" });
    expect(diffLedgerContent([compound], [json])).toHaveLength(1);
  });

  it("leaves ids that only one side has to the id coverage test", () => {
    expect(diffLedgerContent([markdownRow], [jsonRow({ id: "9.9" })])).toEqual(
      [],
    );
  });

  it("throws on a repeated JSON row id, which a Map would check only once", () => {
    expect(() =>
      diffLedgerContent([markdownRow], [jsonRow(), jsonRow()]),
    ).toThrow(/duplicate.*1\.5/i);
  });
});

describe("diffLedgerExpectations", () => {
  function markdownResult(id: string, result: string) {
    return {
      id,
      probe: "probe",
      result,
      notes: "",
      confidence: "high",
    };
  }

  it("throws on a repeated markdown row id, so a clean copy cannot hide a contradicting one", () => {
    expect(() =>
      diffLedgerExpectations(
        [markdownResult("1.1", "`default`"), markdownResult("1.1", "`text`")],
        [jsonRow({ id: "1.1", expect: { cursor: "text" } })],
      ),
    ).toThrow(/duplicate.*1\.1/i);
  });

  it("accepts a cursor expectation the result names", () => {
    const problems = diffLedgerExpectations(
      [markdownResult("1.1", "`default`")],
      [jsonRow({ id: "1.1", expect: { cursor: "default" } })],
    );
    expect(problems).toEqual([]);
  });

  it("reports a cursor expectation the result does not quote", () => {
    const problems = diffLedgerExpectations(
      [markdownResult("1.1", "`default`")],
      [jsonRow({ id: "1.1", expect: { cursor: "text" } })],
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^1\.1: cursor "text" is not named/);
  });

  it("accepts an outlineVisible true expectation the result describes as an outline", () => {
    const problems = diffLedgerExpectations(
      [markdownResult("1.10", "1 px outline at the box bounds while hovered")],
      [jsonRow({ id: "1.10", expect: { outlineVisible: true } })],
    );
    expect(problems).toEqual([]);
  });

  it("reports an outlineVisible false expectation the result does not deny", () => {
    const problems = diffLedgerExpectations(
      [markdownResult("1.11", "1 px outline at the box bounds")],
      [jsonRow({ id: "1.11", expect: { outlineVisible: false } })],
    );
    expect(problems).toHaveLength(1);
  });

  it("accepts an outlineVisible false expectation the result denies", () => {
    const problems = diffLedgerExpectations(
      [markdownResult("1.11", "`default`, no hover outline at any distance")],
      [jsonRow({ id: "1.11", expect: { outlineVisible: false } })],
    );
    expect(problems).toEqual([]);
  });

  it("reports a hit expectation the result does not describe", () => {
    const problems = diffLedgerExpectations(
      [markdownResult("3.7", "selects Beta")],
      [jsonRow({ id: "3.7", expect: { hit: "nothing" } })],
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^3\.7: hit "nothing" is not described/);
  });

  it("accepts a hit expectation the result describes", () => {
    const problems = diffLedgerExpectations(
      [markdownResult("3.7", "nothing created, nothing selected")],
      [jsonRow({ id: "3.7", expect: { hit: "nothing" } })],
    );
    expect(problems).toEqual([]);
  });

  it("rejects an outlineVisible true expectation whose only outline is negated", () => {
    const problems = diffLedgerExpectations(
      [markdownResult("1.10", "no hover outline at any distance")],
      [jsonRow({ id: "1.10", expect: { outlineVisible: true } })],
    );
    expect(problems).toHaveLength(1);
  });

  it("rejects a hit expectation whose keyword is only negated", () => {
    const problems = diffLedgerExpectations(
      [markdownResult("2.3", "select only, no caret")],
      [jsonRow({ id: "2.3", expect: { hit: "text" } })],
    );
    expect(problems).toHaveLength(1);
  });

  it("rejects an object hit expectation whose only selection is negated", () => {
    const problems = diffLedgerExpectations(
      [markdownResult("3.5", "nothing selected")],
      [jsonRow({ id: "3.5", expect: { hit: "object" } })],
    );
    expect(problems).toHaveLength(1);
  });

  it("rejects a nothing hit expectation that a mixed result contradicts", () => {
    const problems = diffLedgerExpectations(
      [markdownResult("3.6", "nothing created; selects Beta")],
      [jsonRow({ id: "3.6", expect: { hit: "nothing" } })],
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/is contradicted by the result/);
  });

  it("rejects a cursor expectation whose name is only negated", () => {
    const problems = diffLedgerExpectations(
      [markdownResult("1.1", "not default, a hover cursor")],
      [jsonRow({ id: "1.1", expect: { cursor: "default" } })],
    );
    expect(problems).toHaveLength(1);
  });

  it("accepts a cursor expectation affirmed in its own clause next to a negated value", () => {
    const problems = diffLedgerExpectations(
      [markdownResult("1.4", "`move`, not default")],
      [jsonRow({ id: "1.4", expect: { cursor: "move" } })],
    );
    expect(problems).toEqual([]);
  });

  it("ignores rows that carry no expect", () => {
    expect(
      diffLedgerExpectations([markdownResult("1.5", "anything")], [jsonRow()]),
    ).toEqual([]);
  });
});
