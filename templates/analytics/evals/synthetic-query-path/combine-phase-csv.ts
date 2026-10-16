import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type Phase = "baseline" | "candidate";

interface PhaseCsv {
  header: string[];
  rows: string[][];
}

const REQUIRED_COLUMNS = [
  "phase",
  "source_revision",
  "harness_sha256",
  "case_key",
  "replicate",
  "score",
  "production_path_invoked",
  "guard_applied",
  "owner_org_context_verified",
  "usage_captured",
] as const;

const FORBIDDEN_COLUMNS = new Set([
  "prompt",
  "sql",
  "args",
  "transcript",
  "rows",
  "org_id",
  "user_id",
  "connection_id",
  "token",
  "cursor",
  "result",
]);

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character !== '"') {
        cell += character;
      } else if (text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = false;
      }
      continue;
    }

    if (character === '"') {
      if (cell.length > 0) throw new Error("Malformed CSV quoting.");
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (character !== "\r") {
      cell += character;
    }
  }

  if (quoted) throw new Error("Malformed CSV quoting.");
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function escapeCsvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

async function readPhase(
  path: string,
  expectedPhase: Phase,
): Promise<PhaseCsv> {
  const parsed = parseCsv(await readFile(path, "utf8"));
  const header = parsed[0]?.map((cell, index) =>
    index === 0 ? cell.replace(/^\uFEFF/, "") : cell,
  );
  if (!header?.length || new Set(header).size !== header.length) {
    throw new Error(`${expectedPhase} CSV has no valid unique header.`);
  }

  const columns = new Map(header.map((column, index) => [column, index]));
  for (const column of REQUIRED_COLUMNS) {
    if (!columns.has(column)) {
      throw new Error(`${expectedPhase} CSV is missing a required column.`);
    }
  }
  if (header.some((column) => FORBIDDEN_COLUMNS.has(column.toLowerCase()))) {
    throw new Error(`${expectedPhase} CSV contains a forbidden column.`);
  }

  const rows = parsed
    .slice(1)
    .filter((record) => !(record.length === 1 && !record[0]));
  if (rows.length === 0) throw new Error(`${expectedPhase} CSV has no rows.`);
  for (const record of rows) {
    if (record.length !== header.length) {
      throw new Error(`${expectedPhase} CSV has a row with the wrong width.`);
    }
    const value = (column: string) => record[columns.get(column)!]!;
    if (value("phase") !== expectedPhase) {
      throw new Error(`${expectedPhase} CSV contains the wrong phase.`);
    }
    if (!/^[0-9a-f]{40}(?:\+worktree)?$/.test(value("source_revision"))) {
      throw new Error(`${expectedPhase} CSV has an invalid source revision.`);
    }
    if (!/^[0-9a-f]{64}$/.test(value("harness_sha256"))) {
      throw new Error(`${expectedPhase} CSV has an invalid harness hash.`);
    }
    if (!value("case_key") || !/^\d+$/.test(value("replicate"))) {
      throw new Error(`${expectedPhase} CSV has an invalid case key.`);
    }
  }

  return { header, rows };
}

async function main(): Promise<void> {
  const [baselinePath, candidatePath, outputPath] = process.argv.slice(2);
  if (!baselinePath || !candidatePath || !outputPath) {
    throw new Error(
      "Usage: combine-phase-csv <baseline.csv> <candidate.csv> <output.csv>",
    );
  }

  const [baseline, candidate] = await Promise.all([
    readPhase(resolve(baselinePath), "baseline"),
    readPhase(resolve(candidatePath), "candidate"),
  ]);
  if (baseline.header.join("\0") !== candidate.header.join("\0")) {
    throw new Error("Baseline and candidate CSV headers do not match.");
  }

  const columnIndex = new Map(
    baseline.header.map((column, index) => [column, index]),
  );
  const keyFor = (row: string[]) =>
    `${row[columnIndex.get("case_key")!]!}\0${row[columnIndex.get("replicate")!]!}`;
  const keys = (phase: PhaseCsv) => {
    const result = new Set(phase.rows.map(keyFor));
    if (result.size !== phase.rows.length) {
      throw new Error("A phase CSV contains duplicate case/replicate rows.");
    }
    return result;
  };
  const baselineKeys = keys(baseline);
  const candidateKeys = keys(candidate);
  if (
    baselineKeys.size !== candidateKeys.size ||
    [...baselineKeys].some((key) => !candidateKeys.has(key))
  ) {
    throw new Error(
      "Baseline and candidate case/replicate pairs do not match.",
    );
  }

  const harnessHashes = new Set(
    [...baseline.rows, ...candidate.rows].map(
      (row) => row[columnIndex.get("harness_sha256")!]!,
    ),
  );
  if (harnessHashes.size !== 1) {
    throw new Error("Baseline and candidate harness hashes do not match.");
  }

  const csv = [
    baseline.header.map(escapeCsvCell).join(","),
    ...[...baseline.rows, ...candidate.rows].map((row) =>
      row.map(escapeCsvCell).join(","),
    ),
  ].join("\n");
  await writeFile(resolve(outputPath), `${csv}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });

  const scoreIndex = columnIndex.get("score")!;
  const passed = (phase: PhaseCsv) =>
    phase.rows.filter((row) => row[scoreIndex] === "1").length;
  console.log(
    `Combined ${baseline.rows.length} baseline and ${candidate.rows.length} candidate rows; ` +
      `${passed(baseline)}/${baseline.rows.length} and ` +
      `${passed(candidate)}/${candidate.rows.length} passed.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "CSV combine failed.");
  process.exitCode = 1;
});
