import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { loadOracleRows } from "./load";
import { checkCitations, parseRecords, uncitedMeasured } from "./ratchet-core";

// Written by `pnpm oracle:ratchet`, which runs the whole suite in one process.
const MODES_PATH = process.env.ORACLE_MODES_PATH ?? ".tmp/oracle/modes.jsonl";
const BASELINE_PATH = fileURLToPath(
  new URL("interaction-oracle.baseline.json", import.meta.url),
);

const BaselineSchema = z.object({
  uncitedMeasured: z.array(z.string()),
});

function fail(message: string, code: number): never {
  console.error(message);
  process.exit(code);
}

function main() {
  if (!existsSync(MODES_PATH)) {
    fail(
      `No test modes at ${MODES_PATH}. Run \`pnpm oracle:ratchet\`, which writes them from one full run.`,
      2,
    );
  }
  const rows = loadOracleRows();
  const records = parseRecords(readFileSync(MODES_PATH, "utf8"));
  const baseline = BaselineSchema.parse(
    JSON.parse(readFileSync(BASELINE_PATH, "utf8")),
  );

  if (process.argv.includes("--print")) {
    console.log(JSON.stringify(uncitedMeasured(rows, records), null, 2));
    return;
  }

  const problems = checkCitations({
    rows,
    records,
    uncitedBaseline: baseline.uncitedMeasured,
  });
  if (problems.length > 0) fail(problems.join("\n\n"), 1);
  const measuredRows = rows.filter(
    (row) => row.status === "measured" || row.status === "deviation",
  ).length;
  const covered = measuredRows - uncitedMeasured(rows, records).length;
  console.log(
    `oracle ratchet passed: ${records.length} tests, ${covered} of ${measuredRows} measured rows covered by executed tests.`,
  );
}

main();
