import { realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Phase = "baseline" | "candidate";

interface PhaseCsv {
  header: string[];
  rows: string[][];
}

const SAFE_CSV_COLUMNS = [
  "phase",
  "source_revision",
  "harness_sha256",
  "case_key",
  "replicate",
  "score",
  "reason_code",
  "completed",
  "aborted",
  "production_path_invoked",
  "guard_applied",
  "owner_org_context_verified",
  "usage_captured",
  "tool_call_count",
  "provider_call_count",
  "dbt_call_count",
  "bigquery_call_count",
  "schema_search_call_count",
  "provenance_distinguished",
  "event_taxonomy_grounded",
  "bounded_grouping_verified",
  "bounded_time_scope_verified",
  "first_party_div_recovery_verified",
  "organization_grain_verified",
  "partial_warning_disclosed",
  "latency_ms",
  "input_tokens",
  "output_tokens",
  "llm_calls",
] as const;

const BOOLEAN_COLUMNS = [
  "completed",
  "aborted",
  "production_path_invoked",
  "guard_applied",
  "owner_org_context_verified",
  "usage_captured",
  "provenance_distinguished",
  "event_taxonomy_grounded",
  "bounded_grouping_verified",
  "bounded_time_scope_verified",
  "first_party_div_recovery_verified",
  "organization_grain_verified",
  "partial_warning_disclosed",
] as const;

const NUMBER_COLUMNS = [
  "tool_call_count",
  "provider_call_count",
  "dbt_call_count",
  "bigquery_call_count",
  "schema_search_call_count",
  "latency_ms",
  "input_tokens",
  "output_tokens",
  "llm_calls",
] as const;

const INTEGER_COLUMNS = [
  "tool_call_count",
  "provider_call_count",
  "dbt_call_count",
  "bigquery_call_count",
  "schema_search_call_count",
  "input_tokens",
  "output_tokens",
  "llm_calls",
] as const;

const REASON_CODES = new Set([
  "pass",
  "aborted",
  "contract_failed",
  "production_path_failed",
]);

const SAFE_CASE_KEYS = [
  "synthetic-unbuilt-index-does-not-claim-absence",
  "synthetic-content-api-requests-not-visual-views",
  "synthetic-source-provenance-ambiguity",
  "synthetic-dbt-disconnected-abstains",
  "synthetic-dbt-paginated-bounded-grouping",
  "synthetic-dbt-rolling-window-product-category",
  "synthetic-dbt-annual-period-rejects-all-time",
  "synthetic-dbt-ordinal-dayfirst-range-retries-bounded",
  "synthetic-dbt-same-month-day-only-range-retries-bounded",
  "synthetic-latest-skill-event-taxonomy",
  "synthetic-latest-monthly-ai-credits-by-workspace",
  "synthetic-bigquery-partial-warning-disclosed",
  "synthetic-schema-discovery-corrects-query",
  "synthetic-dbt-organization-description-does-not-change-grain",
  "synthetic-first-party-div-recovery",
] as const;
const SAFE_CASE_KEY_SET = new Set<string>(SAFE_CASE_KEYS);
const EXPECTED_REPLICATES = ["1", "2"] as const;

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

function readPhase(text: string, expectedPhase: Phase): PhaseCsv {
  const parsed = parseCsv(text);
  const header = parsed[0]?.map((cell, index) =>
    index === 0 ? cell.replace(/^\uFEFF/, "") : cell,
  );
  if (!header?.length || new Set(header).size !== header.length) {
    throw new Error(`${expectedPhase} CSV has no valid unique header.`);
  }

  const columns = new Map(header.map((column, index) => [column, index]));
  if (header.join("\0") !== SAFE_CSV_COLUMNS.join("\0")) {
    throw new Error(`${expectedPhase} CSV does not match the safe schema.`);
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
    if (!value("case_key")) {
      throw new Error(`${expectedPhase} CSV has an invalid case key.`);
    }
    if (!SAFE_CASE_KEY_SET.has(value("case_key"))) {
      throw new Error(
        `${expectedPhase} CSV has an invalid synthetic case key.`,
      );
    }
    if (!/^\d+$/.test(value("replicate")) || Number(value("replicate")) < 1) {
      throw new Error(`${expectedPhase} CSV has an invalid replicate.`);
    }
    if (!(value("score") === "0" || value("score") === "1")) {
      throw new Error(`${expectedPhase} CSV has an invalid score.`);
    }
    if (!REASON_CODES.has(value("reason_code"))) {
      throw new Error(`${expectedPhase} CSV has an invalid reason code.`);
    }
    const score = value("score");
    const reasonCode = value("reason_code");
    const completed = value("completed") === "true";
    const aborted = value("aborted") === "true";
    if (
      (score === "1") !== (reasonCode === "pass") ||
      (reasonCode === "pass" && (!completed || aborted)) ||
      (reasonCode === "aborted") !== aborted ||
      (reasonCode === "contract_failed" && !completed) ||
      (reasonCode === "production_path_failed" && completed) ||
      (aborted && completed)
    ) {
      throw new Error(`${expectedPhase} CSV has inconsistent result status.`);
    }
    if (
      BOOLEAN_COLUMNS.some(
        (column) => value(column) !== "true" && value(column) !== "false",
      )
    ) {
      throw new Error(`${expectedPhase} CSV has an invalid boolean value.`);
    }
    if (
      NUMBER_COLUMNS.some((column) => {
        const numericValue = value(column);
        return (
          !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(numericValue) ||
          !Number.isFinite(Number(numericValue))
        );
      })
    ) {
      throw new Error(`${expectedPhase} CSV has an invalid numeric value.`);
    }
    if (INTEGER_COLUMNS.some((column) => !/^\d+$/.test(value(column)))) {
      throw new Error(`${expectedPhase} CSV has an invalid integer value.`);
    }
    if (
      (score === "1" || reasonCode === "contract_failed") &&
      [
        "production_path_invoked",
        "guard_applied",
        "owner_org_context_verified",
        "usage_captured",
      ].some((column) => value(column) !== "true")
    ) {
      throw new Error(
        `${expectedPhase} CSV is missing valid production receipts.`,
      );
    }
  }
  const sourceRevisions = new Set(
    rows.map((record) => record[columns.get("source_revision")!]!),
  );
  if (sourceRevisions.size !== 1) {
    throw new Error(`${expectedPhase} CSV must use one source revision.`);
  }

  const caseKeyIndex = columns.get("case_key")!;
  const replicateIndex = columns.get("replicate")!;
  const caseReplicate = (record: string[]) =>
    `${record[caseKeyIndex]!}\0${record[replicateIndex]!}`;
  const rowKeys = new Set(rows.map(caseReplicate));
  if (rowKeys.size !== rows.length) {
    throw new Error(
      `${expectedPhase} CSV contains duplicate case/replicate rows.`,
    );
  }
  const expectedRows = SAFE_CASE_KEYS.length * EXPECTED_REPLICATES.length;
  if (
    rowKeys.size !== expectedRows ||
    SAFE_CASE_KEYS.some((caseKey) =>
      EXPECTED_REPLICATES.some(
        (replicate) => !rowKeys.has(`${caseKey}\0${replicate}`),
      ),
    )
  ) {
    throw new Error(
      `${expectedPhase} CSV does not contain the complete case/replicate set.`,
    );
  }

  return { header, rows };
}

export function combinePhaseCsvTexts(
  baselineText: string,
  candidateText: string,
): {
  csv: string;
  baselineRows: number;
  candidateRows: number;
  passed: [number, number];
} {
  const baseline = readPhase(baselineText, "baseline");
  const candidate = readPhase(candidateText, "candidate");
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
  const scoreIndex = columnIndex.get("score")!;
  const passed = (phase: PhaseCsv) =>
    phase.rows.filter((row) => row[scoreIndex] === "1").length;

  return {
    csv: `${csv}\n`,
    baselineRows: baseline.rows.length,
    candidateRows: candidate.rows.length,
    passed: [passed(baseline), passed(candidate)],
  };
}

async function main(): Promise<void> {
  const [baselinePath, candidatePath, outputPath] = process.argv.slice(2);
  if (!baselinePath || !candidatePath || !outputPath) {
    throw new Error(
      "Usage: combine-phase-csv <baseline.csv> <candidate.csv> <output.csv>",
    );
  }

  const result = combinePhaseCsvTexts(
    await readFile(resolve(baselinePath), "utf8"),
    await readFile(resolve(candidatePath), "utf8"),
  );
  await writeFile(resolve(outputPath), result.csv, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });

  console.log(
    `Combined ${result.baselineRows} baseline and ${result.candidateRows} candidate rows; ` +
      `${result.passed[0]}/${result.baselineRows} and ` +
      `${result.passed[1]}/${result.candidateRows} passed.`,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === realpathSync(process.argv[1])
) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "CSV combine failed.",
    );
    process.exitCode = 1;
  });
}
