import { describe, expect, it } from "vitest";

import { csvFilename, resultCsv, resultTsv } from "./result-csv";

describe("report FLOW-download-csv: result CSV", () => {
  it("preserves values and quotes delimiters, quotes and line breaks", () => {
    expect(
      resultCsv(
        [{ name: "name" }, { name: 'value,"quoted"' }, { name: "formula" }],
        [
          ["Zoë\nAda", 'a,"b"', "=1+2"],
          [null, 12, false],
        ],
      ),
    ).toBe(
      'name,"value,""quoted""",formula\r\n"Zoë\nAda","a,""b""",\'=1+2\r\n,12,false\r\n',
    );
  });
  it("report A2-CSV-FORMULA-EXPORT protects text cells and headers without changing numeric values", () => {
    expect(
      resultCsv(
        [{ name: "=header" }, { name: "normal" }, { name: "@header" }],
        [
          ["+cmd", " -2+3", "@sum"],
          ["\t=1+2", "\rmalicious", "\nmalicious"],
          [-2, 3.5, false],
          [null, "safe", 'text,"quoted"'],
        ],
      ),
    ).toBe(
      '\'=header,normal,\'@header\r\n\'+cmd,\' -2+3,\'@sum\r\n\'\t=1+2,"\'\rmalicious","\'\nmalicious"\r\n-2,3.5,false\r\n,safe,"text,""quoted"""\r\n',
    );
  });
  it("report EXP-CSV-VALUES serializes objects, arrays, dates and bigint instead of [object Object]", () => {
    const rows = [
      [{ a: 1 }, [1, "x"], new Date("2024-01-02T03:04:05Z"), 10n],
    ] as unknown as Parameters<typeof resultCsv>[1];
    expect(
      resultCsv(
        [{ name: "o" }, { name: "a" }, { name: "d" }, { name: "b" }],
        rows,
      ),
    ).toBe(
      'o,a,d,b\r\n"{""a"":1}","[1,""x""]",2024-01-02T03:04:05.000Z,10\r\n',
    );
  });
  it("report EXP-CSV-FILENAME names the download after the cell and strips unsafe characters", () => {
    expect(csvFilename("Weekly signups")).toBe("Weekly signups.csv");
    expect(csvFilename('a/b\\c:d*e?"f<g>h|i')).toBe("a b c d e f g h i.csv");
    expect(csvFilename("  ..hidden..  ")).toBe("hidden.csv");
    expect(csvFilename("日本語レポート")).toBe("日本語レポート.csv");
    expect(csvFilename("x".repeat(300))).toBe(`${"x".repeat(100)}.csv`);
    expect(csvFilename("")).toBe("results.csv");
    expect(csvFilename(null)).toBe("results.csv");
  });
  it("report EXP-COPY-TSV copies tab-delimited text and quotes tabs but not commas", () => {
    expect(
      resultTsv(
        [{ name: "a,b" }, { name: "c" }],
        [
          ["x\ty", 'q"1'],
          [1, null],
        ],
      ),
    ).toBe('a,b\tc\r\n"x\ty"\t"q""1"\r\n1\t\r\n');
  });
});
