import type { OracleExpect, OracleRow } from "./schema";

export interface MarkdownLedgerRow {
  id: string;
  probe: string;
  result: string;
  notes: string;
  confidence: string;
}

// Header names of the ledger tables in interaction-oracle.md. A table is read
// by header name so a reordered column cannot be mistaken for another field.
const COLUMN_NAMES = {
  id: "id",
  probe: "action",
  result: "observed",
  notes: "measurements",
  confidence: "conf",
} as const;

type ColumnIndex = Record<keyof typeof COLUMN_NAMES, number>;

/**
 * The ledger rows of interaction-oracle.md, one per table row. Only tables
 * whose header names the ledger columns are read; a table row outside such a
 * table throws, so a new table cannot be ignored silently.
 */
export function readMarkdownLedger(markdown: string): MarkdownLedgerRow[] {
  const rows: MarkdownLedgerRow[] = [];
  let columns: ColumnIndex | undefined;
  let cellCount = 0;
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) {
      columns = undefined;
      continue;
    }
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.includes(COLUMN_NAMES.id)) {
      columns = mapColumns(cells);
      cellCount = cells.length;
      continue;
    }
    if (/^:?-+:?$/.test(cells[0] ?? "")) continue;
    if (columns === undefined) {
      throw new Error(`Ledger row outside a table header: ${line}`);
    }
    if (cells.length !== cellCount) {
      throw new Error(
        `Ledger row has ${cells.length} cells, its header has ${cellCount}: ${line}`,
      );
    }
    rows.push({
      id: cells[columns.id],
      probe: cells[columns.probe],
      result: cells[columns.result],
      notes: cells[columns.notes],
      confidence: cells[columns.confidence],
    });
  }
  return rows;
}

function mapColumns(header: string[]): ColumnIndex {
  const index = {} as ColumnIndex;
  for (const [key, name] of Object.entries(COLUMN_NAMES) as Array<
    [keyof typeof COLUMN_NAMES, string]
  >) {
    const position = header.indexOf(name);
    if (position === -1) {
      throw new Error(`Ledger table header has no "${name}" column`);
    }
    index[key] = position;
  }
  return index;
}

/**
 * Every field the markdown and the JSON mirror both carry, compared for each
 * id they share. The JSON keeps the full confidence cell in confidenceNote
 * when the cell is compound, so that note is what the markdown must match.
 * Ids present on only one side are left to the id-coverage test.
 */
export function diffLedgerContent(
  markdownRows: MarkdownLedgerRow[],
  jsonRows: OracleRow[],
): string[] {
  const byId = new Map(jsonRows.map((row) => [row.id, row]));
  const problems: string[] = [];
  for (const md of markdownRows) {
    const json = byId.get(md.id);
    if (json === undefined) continue;
    const fields: Array<[string, string, string]> = [
      ["probe", md.probe, json.probe],
      ["result", md.result, json.result],
      ["notes", md.notes, json.notes],
      ["confidence", md.confidence, json.confidenceNote ?? json.confidence],
    ];
    for (const [name, markdownValue, jsonValue] of fields) {
      if (markdownValue !== jsonValue) {
        problems.push(
          `${md.id}: ${name} differs (markdown ${JSON.stringify(markdownValue)}, json ${JSON.stringify(jsonValue)})`,
        );
      }
    }
  }
  return problems;
}

// How a ledger result words each hit value. These are presence checks: they
// catch a result that describes a different outcome, not every rewording.
const HIT_WORDING: Record<NonNullable<OracleExpect["hit"]>, RegExp> = {
  nothing: /\bnothing\b|\bdeselect/i,
  object:
    /\bselect|\bhit|\bmulti-selection|\btopmost|\bstarts a move|\bblocks\b|\badds\b/i,
  group: /\bgroup\b/i,
  text: /\bcaret\b|\bedit\b|\bword\b|\bparagraph\b/i,
  child: /\bchild\b/i,
  sibling: /\bsibling\b|\bneighbou?r\b/i,
};

const OUTLINE_PRESENT = /\boutline\b/i;
const OUTLINE_ABSENT = /\bno\b[^;,.]*\boutline\b/i;

/**
 * Each JSON expect must agree with the ledger result it mirrors. A cursor is
 * checked by name, a hit by its wording, and outlineVisible by whether the
 * result describes an outline or says there is none. A row whose id is not in
 * the markdown is left to the id-coverage test.
 */
export function diffLedgerExpectations(
  markdownRows: MarkdownLedgerRow[],
  jsonRows: OracleRow[],
): string[] {
  const byId = new Map(markdownRows.map((row) => [row.id, row]));
  const problems: string[] = [];
  for (const json of jsonRows) {
    const expect = json.expect;
    if (expect === undefined) continue;
    const md = byId.get(json.id);
    if (md === undefined) continue;
    if (
      expect.cursor !== undefined &&
      !new RegExp(`\\b${expect.cursor}\\b`, "i").test(md.result)
    ) {
      problems.push(
        `${json.id}: cursor "${expect.cursor}" is not named in the result`,
      );
    }
    if (expect.hit !== undefined && !HIT_WORDING[expect.hit].test(md.result)) {
      problems.push(
        `${json.id}: hit "${expect.hit}" is not described in the result`,
      );
    }
    if (expect.outlineVisible !== undefined) {
      const wording = expect.outlineVisible ? OUTLINE_PRESENT : OUTLINE_ABSENT;
      if (!wording.test(md.result)) {
        problems.push(
          `${json.id}: outlineVisible ${expect.outlineVisible} is not described in the result`,
        );
      }
    }
  }
  return problems;
}
