import { describe, expect, it } from "vitest";

import { decodeTsv, encodeTsv } from "./clipboard";

describe("TSV clipboard", () => {
  it("round-trips a plain rectangle", () => {
    const rows = [
      ["Acme", "acme.com"],
      ["Globex", "globex.io"],
    ];
    expect(decodeTsv(encodeTsv(rows))).toEqual(rows);
  });

  it("round-trips a cell containing a tab", () => {
    const rows = [["before\tafter", "b"]];
    const encoded = encodeTsv(rows);
    expect(encoded).toBe('"before\tafter"\tb');
    expect(decodeTsv(encoded)).toEqual(rows);
  });

  it("round-trips a cell containing a newline", () => {
    const rows = [
      ["line one\nline two", "b"],
      ["c", "d"],
    ];
    expect(decodeTsv(encodeTsv(rows))).toEqual(rows);
  });

  it("round-trips embedded quotes", () => {
    const rows = [['say "hi"', "plain"]];
    expect(encodeTsv(rows)).toBe('"say ""hi"""\tplain');
    expect(decodeTsv(encodeTsv(rows))).toEqual(rows);
  });

  it("reads what Sheets actually puts on the clipboard", () => {
    expect(decodeTsv("a\tb\r\nc\td\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps a ragged paste ragged rather than inventing empty cells", () => {
    expect(decodeTsv("a\tb\nc")).toEqual([["a", "b"], ["c"]]);
  });

  it("reads a single cell", () => {
    expect(decodeTsv("solo")).toEqual([["solo"]]);
    expect(decodeTsv("")).toEqual([[""]]);
  });
});
