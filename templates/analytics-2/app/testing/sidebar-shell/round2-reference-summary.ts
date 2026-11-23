import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { referenceCoverageSummary } from "./reference-coverage-summary";

export function round2ReferenceSummary() {
  const canonical = JSON.parse(
    readFileSync(new URL("./reference-coverage.json", import.meta.url), "utf8"),
  ) as { id: string; status: string; counted: boolean }[];
  const evidence = JSON.parse(
    readFileSync(
      new URL("./round2-reference-evidence.json", import.meta.url),
      "utf8",
    ),
  ) as { changes: { id: string; status: string }[] };
  const proposed = canonical.map((row) => ({
    ...row,
    status:
      evidence.changes.find((change) => change.id === row.id)?.status ??
      row.status,
  }));
  return {
    canonical: referenceCoverageSummary(),
    unappliedEvidenceEntries: evidence.changes.length,
    proposedAfterConsolidation: Object.fromEntries(
      [
        "rendered-matched",
        "rendered-differs",
        "slot",
        "not-rendered",
        "excluded",
      ].map((status) => [
        status,
        proposed.filter((row) => row.status === status).length,
      ]),
    ),
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(round2ReferenceSummary(), null, 2));
