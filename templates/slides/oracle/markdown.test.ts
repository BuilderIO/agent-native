import { describe, expect, it } from "vitest";

import { diffLedgerContent, readMarkdownLedger } from "./markdown";
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
});
