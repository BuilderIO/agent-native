// The shared fix for the "an importer reads an ambiguous cell with one fixed rule" class. These
// checks pin the half that makes the class real: the same cell must read differently under the two
// formats, so a person importing European data gets their own value instead of a wrong one.
//
// Mutant control, run by hand once when this landed: replace the body of parseImportDate with a
// fixed American order (ignore the format argument). "european reads 03-04-2024 as 2024-04-03"
// then FAILS (it returns 2024-03-04), which is exactly the defect the class describes; the iso and
// american cases still pass, so the check is specific to the format rather than to the page.
import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMPORT_DATE_FORMAT,
  DEFAULT_IMPORT_NUMBER_SEPARATOR,
  formatImportDate,
  formatImportNumber,
  IMPORT_DATE_FORMAT_OPTIONS,
  IMPORT_NUMBER_SEPARATOR_OPTIONS,
  parseImportDate,
  parseImportNumber,
} from "./import-cell-format.js";

describe("imported date cells read in the declared format", () => {
  it("reads the same ambiguous cell two different ways", () => {
    expect(parseImportDate("03-04-2024", "american")).toBe("2024-03-04");
    expect(parseImportDate("03-04-2024", "european")).toBe("2024-04-03");
    expect(parseImportDate("03-04-2024", "american")).not.toBe(
      parseImportDate("03-04-2024", "european"),
    );
  });

  it("reads the ISO order only when the year comes first", () => {
    expect(parseImportDate("2024-05-15", "iso")).toBe("2024-05-15");
    expect(parseImportDate("2024/5/9", "iso")).toBe("2024-05-09");
    expect(parseImportDate("5-5-2024", "iso")).toBeNull();
  });

  it("reads European spellings, separators and dotted parts", () => {
    expect(parseImportDate("15-05-2024", "european")).toBe("2024-05-15");
    expect(parseImportDate("15/05/2024", "european")).toBe("2024-05-15");
    expect(parseImportDate("15.05.2024", "european")).toBe("2024-05-15");
  });

  it("refuses a cell that is not a real day in that order instead of guessing", () => {
    expect(parseImportDate("31-02-2024", "european")).toBeNull();
    expect(parseImportDate("2024-02-30", "iso")).toBeNull();
    expect(parseImportDate("13-13-2024", "american")).toBeNull();
    // A written month is the caller's natural parser, not this format.
    expect(parseImportDate("May 15 2024", "american")).toBeNull();
  });

  it("has a default and an option list a control can render", () => {
    expect(DEFAULT_IMPORT_DATE_FORMAT).toBe("iso");
    expect(IMPORT_DATE_FORMAT_OPTIONS.map((option) => option.value)).toEqual([
      "iso",
      "european",
      "american",
    ]);
  });

  it("prints a day in the chosen order", () => {
    const day = new Date(2024, 4, 15);
    expect(formatImportDate(day, "iso")).toBe("2024-05-15");
    expect(formatImportDate(day, "european")).toBe("15-05-2024");
    expect(formatImportDate(day, "american")).toBe("05-15-2024");
  });
});

describe("imported number cells read in the declared separator", () => {
  it("reads the same money cell two different ways", () => {
    expect(parseImportNumber("1.000,50", "comma")).toBe(1000.5);
    expect(parseImportNumber("1,000.50", "period")).toBe(1000.5);
  });

  it("reads a cell written in the other format as a different number", () => {
    // This is the defect the class names, kept as a check rather than a comment: the separator
    // decides which mark is the decimal point, and the other mark is dropped as a thousands mark.
    // A European money cell read under Point therefore stores a value 1000x too small, which is
    // why the mapping asks per property instead of guessing.
    expect(parseImportNumber("1.000,50", "comma")).toBe(1000.5);
    expect(parseImportNumber("1.000,50", "period")).toBe(1.0005);
    expect(parseImportNumber("1.000,50", "period")).not.toBe(
      parseImportNumber("1.000,50", "comma"),
    );
  });

  it("drops a currency symbol and keeps the value", () => {
    expect(parseImportNumber("€1.000,50", "comma")).toBe(1000.5);
    expect(parseImportNumber("$1,000.50", "period")).toBe(1000.5);
  });

  it("leaves text out instead of reading it as a number", () => {
    expect(parseImportNumber("not a number", "period")).toBeNull();
    expect(parseImportNumber("", "comma")).toBeNull();
  });

  it("has a default and an option list a control can render", () => {
    expect(DEFAULT_IMPORT_NUMBER_SEPARATOR).toBe("period");
    expect(
      IMPORT_NUMBER_SEPARATOR_OPTIONS.map((option) => option.value),
    ).toEqual(["period", "comma"]);
  });

  it("prints a number with the chosen separator", () => {
    expect(formatImportNumber(1000.5, "period")).toBe("1,000.50");
    expect(formatImportNumber(1000.5, "comma")).toBe("1.000,50");
  });
});
