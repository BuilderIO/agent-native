import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import captures from "./captures.json";
import canonical from "./reference-coverage.json";
import { round3ReferenceSummary } from "./round3-reference-summary";
import proposed from "./round4-reference-coverage.proposed.json";
import evidence from "./round4-reference-evidence.json";

export function round4ReferenceSummary() {
  const prior = round3ReferenceSummary();
  const counts = (rows: typeof canonical) =>
    Object.fromEntries(
      [
        "rendered-matched",
        "rendered-differs",
        "slot",
        "not-rendered",
        "excluded",
      ].map((status) => [
        status,
        rows.filter((row) => row.status === status).length,
      ]),
    );
  const phaseWitnesses = new Set([
    ...captures.witnesses
      .filter((capture) => !prior.unreplayedPhaseArtifacts.includes(capture.id))
      .map((capture) => capture.id),
    ...evidence.phaseWitnesses.map((witness) => witness.fixture),
  ]);
  return {
    canonical: prior.canonical,
    canonicalAccountingUpdated: evidence.canonicalAccountingUpdated,
    proposedAfterConsolidation: {
      rows: proposed.length,
      counted: proposed.filter((row) => row.counted).length,
      all: counts(proposed),
      denominator: counts(proposed.filter((row) => row.counted)),
      mounted: 0,
      strict: 0,
    },
    exactJourneyEnvelopes: evidence.envelopeWitnesses.length,
    newPhaseArtifacts: evidence.phaseWitnesses.length,
    replayedPhaseArtifacts: phaseWitnesses.size,
    unreplayedPhaseArtifacts: captures.witnesses
      .filter((capture) => !phaseWitnesses.has(capture.id))
      .map((capture) => capture.id),
    regionComparedCaptures: prior.regionComparedCaptures,
    missingRegionComparisons: prior.missingRegionComparisons,
    remainingNotRendered: proposed
      .filter((row) => row.status === "not-rendered")
      .map((row) => ({ id: row.id, reason: row.reason })),
    differences: proposed
      .filter(
        (row) => row.status === "rendered-differs" || row.status === "slot",
      )
      .map((row) => ({ id: row.id, status: row.status, reason: row.reason })),
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Fail before reporting if an evidence path was lost during consolidation.
  for (const row of proposed)
    for (const witness of row.witnesses) readFileSync(witness.baseline);
  console.log(JSON.stringify(round4ReferenceSummary(), null, 2));
}
