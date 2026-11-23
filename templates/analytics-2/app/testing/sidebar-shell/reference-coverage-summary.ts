import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import captures from "./captures.json";
import round3 from "./round3-reference-evidence.json";
import round4 from "./round4-reference-evidence.json";

export function referenceCoverageSummary() {
  const rows = JSON.parse(
    readFileSync(new URL("./reference-coverage.json", import.meta.url), "utf8"),
  ) as {
    id: string;
    counted: boolean;
    status: string;
    reason?: string;
    witnesses: { fixture: string }[];
  }[];
  function counts(subset: typeof rows) {
    return Object.fromEntries(
      [
        "rendered-matched",
        "rendered-differs",
        "slot",
        "not-rendered",
        "excluded",
      ].map((status) => [
        status,
        subset.filter((row) => row.status === status).length,
      ]),
    );
  }
  const compared = new Set([
    ...rows
      .filter((row) => row.status !== "slot")
      .flatMap((row) => row.witnesses.map((witness) => witness.fixture)),
    ...round3.phaseWitnesses.map((witness) => `${witness.fixture}-mounted`),
    ...round3.additionalRegionComparisons.map((witness) => witness.fixture),
  ]);
  const phases = new Set([
    ...round3.phaseWitnesses.map((witness) => witness.fixture),
    ...round4.phaseWitnesses.map((witness) => witness.fixture),
  ]);
  return {
    rows: rows.length,
    counted: rows.filter((row) => row.counted).length,
    all: counts(rows),
    denominator: counts(rows.filter((row) => row.counted)),
    mounted: 0,
    strict: 0,
    regionComparedCaptures: captures.captures.filter((capture) =>
      compared.has(capture.id),
    ).length,
    totalCaptures: captures.captures.length,
    missingRegionComparisons: captures.captures
      .filter((capture) => !compared.has(capture.id))
      .map((capture) => capture.id),
    replayedPhaseArtifacts: phases.size,
    unreplayedPhaseArtifacts: captures.witnesses
      .filter((capture) => !phases.has(capture.id))
      .map((capture) => capture.id),
    exactJourneyEnvelopes: round4.envelopeWitnesses.length,
    remaining: rows
      .filter((row) => row.counted && row.status !== "rendered-matched")
      .map((row) => ({ id: row.id, status: row.status, reason: row.reason })),
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(referenceCoverageSummary(), null, 2));
