import { z } from "zod";

import type { OracleRow } from "./schema";

// The ids a test title cites, as in "(oracle 4.8)" or "(oracle G.snap-to-guides)".
const CITATION_PATTERN =
  /\boracle ((?:\d+|[A-Z])\.\d+[a-z]?|G\.[a-z0-9][a-z0-9.-]*)\b/g;

// One test as Vitest decided its mode at collection. Focus and skip are already
// applied, so "run" and "only" execute, and "skip" and "todo" do not.
export const TestRecordSchema = z.strictObject({
  file: z.string().min(1),
  title: z.string(),
  mode: z.enum(["run", "only", "skip", "todo"]),
});
export type TestRecord = z.infer<typeof TestRecordSchema>;

const EXECUTED_MODES = new Set<TestRecord["mode"]>(["run", "only"]);

/** The records a run wrote, one JSON object per line. A bad line throws. */
export function parseRecords(text: string): TestRecord[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      try {
        return TestRecordSchema.parse(JSON.parse(line));
      } catch (error) {
        throw new Error(
          `modes record ${index + 1} is malformed: ${(error as Error).message}`,
        );
      }
    });
}

function citedIds(title: string): string[] {
  return [...title.matchAll(CITATION_PATTERN)].map((match) => match[1]);
}

/** Row ids that an executed test's title cites. A skipped citation covers nothing. */
function executedIds(records: TestRecord[]): Set<string> {
  const executed = new Set<string>();
  for (const record of records) {
    if (!EXECUTED_MODES.has(record.mode)) continue;
    for (const id of citedIds(record.title)) executed.add(id);
  }
  return executed;
}

/**
 * The measured and deviation rows no executed test cites, sorted. Gap rows are
 * documented claims never measured, so they are left out; their ids are pinned
 * as gapIds instead.
 */
export function uncitedMeasured(
  rows: OracleRow[],
  records: TestRecord[],
): string[] {
  const executed = executedIds(records);
  return rows
    .filter((row) => row.status === "measured" || row.status === "deviation")
    .map((row) => row.id)
    .filter((id) => !executed.has(id))
    .sort();
}

function driftMessage(
  field: string,
  baselineIds: string[],
  computedIds: string[],
): string {
  const added = computedIds.filter((id) => !baselineIds.includes(id));
  const removed = baselineIds.filter((id) => !computedIds.includes(id));
  return [
    `interaction-oracle.baseline.json ${field} is out of date.`,
    `  added (computed now, missing from the baseline): ${JSON.stringify(added)}`,
    `  removed (in the baseline, no longer computed): ${JSON.stringify(removed)}`,
    `  To update: cite each added row from a test that runs ("oracle <id>"), or replace ${field} in interaction-oracle.baseline.json with exactly: ${JSON.stringify(computedIds)}`,
  ].join("\n");
}

/**
 * The problems with a run's citations. Every cited id must be a real row, and no
 * title may cite a gap row, since a gap row is a claim that was never measured.
 * The uncited measured rows must equal the baseline's list.
 */
export function checkCitations(input: {
  rows: OracleRow[];
  records: TestRecord[];
  uncitedBaseline: string[];
}): string[] {
  const rowById = new Map(input.rows.map((row) => [row.id, row]));
  const citedBy = new Map<string, string[]>();
  for (const record of input.records) {
    for (const id of citedIds(record.title)) {
      const files = citedBy.get(id) ?? [];
      if (!files.includes(record.file)) files.push(record.file);
      citedBy.set(id, files);
    }
  }
  const citedList = (ids: string[]) =>
    ids
      .map((id) => `  ${id} (cited in ${(citedBy.get(id) ?? []).join(", ")})`)
      .join("\n");

  const problems: string[] = [];
  const dangling = [...citedBy.keys()].filter((id) => !rowById.has(id)).sort();
  if (dangling.length > 0) {
    problems.push(
      `Citations name oracle rows that do not exist:\n${citedList(dangling)}\nFix the id in the citing test title or check label.`,
    );
  }
  const citedGap = [...citedBy.keys()]
    .filter((id) => rowById.get(id)?.status === "gap")
    .sort();
  if (citedGap.length > 0) {
    problems.push(
      `Test titles cite gap rows, which are never measured:\n${citedList(citedGap)}\nCut the gap id from the title; a gap row is not coverage.`,
    );
  }

  const uncited = uncitedMeasured(input.rows, input.records);
  if (JSON.stringify(uncited) !== JSON.stringify(input.uncitedBaseline)) {
    problems.push(
      driftMessage("uncitedMeasured", input.uncitedBaseline, uncited),
    );
  }
  return problems;
}
