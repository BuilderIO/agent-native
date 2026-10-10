import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compareToOracle, OracleRowWithoutExpectError } from "./compare";
import {
  getOracleRow,
  OracleRowNotFoundError,
  ORACLE_FILE_NAMES,
  readOracleFile,
  type OracleFileName,
} from "./load";
import { diffLedgerContent, readMarkdownLedger } from "./markdown";
import {
  ORACLE_ID_PATTERN,
  OracleFileSchema,
  OracleRowSchema,
  type OracleRow,
} from "./schema";

const MARKDOWN_PATH = fileURLToPath(
  new URL("../interaction-oracle.md", import.meta.url),
);

// Ledger rows are the first cell of each md table row. The header ("id") and
// separator rows are skipped; every other first cell is treated as an id.
function readMarkdownLedgerIds(): string[] {
  const markdown = readFileSync(MARKDOWN_PATH, "utf8");
  const ids: string[] = [];
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) continue;
    const firstCell = line.split("|")[1].trim();
    if (firstCell === "" || firstCell === "id") continue;
    if (/^:?-+:?$/.test(firstCell)) continue;
    ids.push(firstCell);
  }
  return ids;
}

function readAllRows(): OracleRow[] {
  return ORACLE_FILE_NAMES.flatMap((fileName) => readOracleFile(fileName).rows);
}

// Gap rows are the rows of interaction-oracle-gaps.json. The md's own NOT
// MEASURED row (1.9) lives in the measured file, so it is not a gap row here.
function readGapRows(): OracleRow[] {
  return readOracleFile("interaction-oracle-gaps.json").rows;
}

describe("interaction oracle files", () => {
  it.each(ORACLE_FILE_NAMES)(
    "%s parses against OracleFileSchema",
    (fileName: OracleFileName) => {
      expect(() => readOracleFile(fileName)).not.toThrow();
    },
  );

  it("ids are unique across both files", () => {
    const counts = new Map<string, number>();
    for (const row of readAllRows()) {
      counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
    }
    const duplicates = [...counts]
      .filter(([, count]) => count > 1)
      .map(([id]) => id);
    expect(duplicates).toEqual([]);
  });

  it("each id matches ORACLE_ID_PATTERN", () => {
    const badIds = readAllRows()
      .map((row) => row.id)
      .filter((id) => !ORACLE_ID_PATTERN.test(id));
    expect(badIds).toEqual([]);
  });

  it("the md ledger parser finds the ledger rows", () => {
    // Guards the two directional checks below against passing on an empty list.
    const mdIds = readMarkdownLedgerIds();
    expect(mdIds).toContain("1.1");
    expect(mdIds).toContain("T.1");
    expect(mdIds).toContain("K.2");
  });

  it("every measured or deviation row id appears as a table row in interaction-oracle.md", () => {
    const mdIds = new Set(readMarkdownLedgerIds());
    const missing = readAllRows()
      .filter((row) => row.status === "measured" || row.status === "deviation")
      .map((row) => row.id)
      .filter((id) => !mdIds.has(id));
    expect(missing).toEqual([]);
  });

  it("every table row id in interaction-oracle.md has a JSON row", () => {
    const jsonIds = new Set(readAllRows().map((row) => row.id));
    const missing = readMarkdownLedgerIds().filter((id) => !jsonIds.has(id));
    expect(missing).toEqual([]);
  });

  it("same-id rows agree on probe, result, notes and confidence", () => {
    const markdownRows = readMarkdownLedger(
      readFileSync(MARKDOWN_PATH, "utf8"),
    );
    expect(diffLedgerContent(markdownRows, readAllRows())).toEqual([]);
  });

  it("every gap row has status gap", () => {
    const wrong = readGapRows()
      .filter((row) => row.status !== "gap")
      .map((row) => `${row.id}: ${row.status}`);
    expect(wrong).toEqual([]);
  });

  it("every gap row has claim positive", () => {
    const wrong = readGapRows()
      .filter((row) => row.claim !== "positive")
      .map((row) => `${row.id}: ${row.claim}`);
    expect(wrong).toEqual([]);
  });

  it("every gap row cites a support.google.com page over https", () => {
    const wrong = readGapRows()
      .filter(
        (row) =>
          row.source === undefined ||
          !/^https:\/\/support\.google\.com\//.test(row.source),
      )
      .map((row) => `${row.id}: ${row.source ?? "(no source)"}`);
    expect(wrong).toEqual([]);
  });
});

describe("oracle schema rules", () => {
  const validRow = {
    id: "1.1",
    family: "1",
    familyName: "Hover cursors",
    probe: "hover empty slide",
    result: "default",
    notes: "",
    confidence: "high",
    status: "measured",
    claim: "positive",
    inputPath: "unknown",
    expect: { hit: "nothing", cursor: "default" },
  };

  it("accepts the row shape", () => {
    expect(OracleRowSchema.safeParse(validRow).success).toBe(true);
  });

  it("rejects unknown keys on a row", () => {
    expect(
      OracleRowSchema.safeParse({ ...validRow, extra: true }).success,
    ).toBe(false);
  });

  it("rejects unknown keys inside expect", () => {
    const row = { ...validRow, expect: { hit: "nothing", bogus: 1 } };
    expect(OracleRowSchema.safeParse(row).success).toBe(false);
  });

  it("rejects an empty expect, which would otherwise compare as a vacuous match", () => {
    expect(OracleRowSchema.safeParse({ ...validRow, expect: {} }).success).toBe(
      false,
    );
  });

  it.each(["resize", "grab", "rotate"])(
    "rejects cursor %s, which the oracle channel does not report",
    (cursor) => {
      const row = { ...validRow, expect: { cursor } };
      expect(OracleRowSchema.safeParse(row).success).toBe(false);
    },
  );

  it.each([
    "nw-resize",
    "n-resize",
    "ne-resize",
    "e-resize",
    "se-resize",
    "s-resize",
    "sw-resize",
    "w-resize",
  ])("accepts directional cursor %s", (cursor) => {
    const row = { ...validRow, expect: { cursor } };
    expect(OracleRowSchema.safeParse(row).success).toBe(true);
  });

  it.each(["1.1", "10.7", "1.4a", "T.1", "H.12", "K.2", "G.hover-cursor"])(
    "id %s is accepted",
    (id) => {
      expect(ORACLE_ID_PATTERN.test(id)).toBe(true);
    },
  );

  it.each(["1", "1-1", "t.1", "G.Hover", "G.", "1.a"])(
    "id %s is rejected",
    (id) => {
      expect(ORACLE_ID_PATTERN.test(id)).toBe(false);
    },
  );

  it("rejects a file with the wrong schemaVersion or an extra top-level key", () => {
    expect(
      OracleFileSchema.safeParse({ schemaVersion: 2, rows: [] }).success,
    ).toBe(false);
    expect(
      OracleFileSchema.safeParse({ schemaVersion: 1, rows: [], extra: 1 })
        .success,
    ).toBe(false);
  });

  it("getOracleRow throws OracleRowNotFoundError for an unknown id", () => {
    expect(() => getOracleRow("no.such.row")).toThrow(OracleRowNotFoundError);
  });
});

describe("compareToOracle against the shipped rows", () => {
  it("compares an observation with the row's expect", () => {
    expect(
      compareToOracle("1.11", { cursor: "default", outlineVisible: false }),
    ).toEqual({
      verdict: "match",
      keys: { cursor: "match", outlineVisible: "match" },
    });
  });

  it("refuses a row whose cells are ranges or per-handle values", () => {
    expect(() => compareToOracle("1.5", { cursor: "move" })).toThrow(
      OracleRowWithoutExpectError,
    );
  });

  it("throws OracleRowNotFoundError for an unknown id", () => {
    expect(() => compareToOracle("no.such.row", {})).toThrow(
      OracleRowNotFoundError,
    );
  });
});
