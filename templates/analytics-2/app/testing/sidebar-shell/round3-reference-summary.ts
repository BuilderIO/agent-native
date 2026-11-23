import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { referenceCoverageSummary } from "./reference-coverage-summary";

interface EvidenceRow {
  id: string;
  status: string;
  reason?: string;
  counted?: boolean;
  witnesses: { fixture: string }[];
}
const statuses = [
  "rendered-matched",
  "rendered-differs",
  "slot",
  "not-rendered",
  "excluded",
];
function read<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8")) as T;
}

export function round3ReferenceSummary() {
  const canonical = read<EvidenceRow[]>("./reference-coverage.json");
  const round2 = read<{ changes: EvidenceRow[] }>(
    "./round2-reference-evidence.json",
  );
  const round3 = read<{
    changes: EvidenceRow[];
    unrenderedRows: Pick<EvidenceRow, "id" | "status" | "reason">[];
    phaseWitnesses: { fixture: string }[];
    additionalRegionComparisons: { fixture: string }[];
  }>("./round3-reference-evidence.json");
  const proposed = canonical.map((row) => {
    const second = round2.changes.find((change) => change.id === row.id);
    const third = round3.changes.find((change) => change.id === row.id);
    // Later contract support must not rewrite the historical proposal's limits.
    const unrendered = round3.unrenderedRows.find(
      (limit) => limit.id === row.id,
    );
    return { ...row, ...second, ...third, ...unrendered };
  });
  const captures = read<{
    captures: { id: string }[];
    witnesses: { id: string }[];
  }>("./captures.json");
  const regionCompared = new Set([
    ...canonical
      .filter((row) => row.status !== "slot")
      .flatMap((row) => row.witnesses.map((witness) => witness.fixture)),
    ...round2.changes.flatMap((row) =>
      row.witnesses.map((witness) => witness.fixture),
    ),
    ...round3.changes
      .filter((row) => row.status !== "slot")
      .flatMap((row) => row.witnesses.map((witness) => witness.fixture)),
    ...round3.phaseWitnesses.map((witness) => `${witness.fixture}-mounted`),
    ...round3.additionalRegionComparisons.map((witness) => witness.fixture),
  ]);
  const phases = new Set(
    round3.phaseWitnesses.map((witness) => witness.fixture),
  );
  const counts = (rows: EvidenceRow[]) =>
    Object.fromEntries(
      statuses.map((status) => [
        status,
        rows.filter((row) => row.status === status).length,
      ]),
    );
  return {
    canonical: referenceCoverageSummary(),
    unappliedRound3Entries: round3.changes.length,
    proposedAfterConsolidation: {
      all: counts(proposed),
      denominator: counts(proposed.filter((row) => row.counted)),
    },
    regionComparedCaptures: captures.captures.filter((capture) =>
      regionCompared.has(capture.id),
    ).length,
    missingRegionComparisons: captures.captures
      .filter((capture) => !regionCompared.has(capture.id))
      .map((capture) => capture.id),
    replayedPhaseArtifacts: phases.size,
    unreplayedPhaseArtifacts: captures.witnesses
      .filter((capture) => !phases.has(capture.id))
      .map((capture) => capture.id),
    remainingProposedNotRendered: proposed
      .filter((row) => row.status === "not-rendered")
      .map((row) => row.id),
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(round3ReferenceSummary(), null, 2));
