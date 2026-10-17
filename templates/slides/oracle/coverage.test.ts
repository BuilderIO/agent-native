import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { measuredInventory, sortedRowIds } from "./inventory";
import { loadOracleRows, readOracleFile } from "./load";

const BASELINE_PATH = fileURLToPath(
  new URL("interaction-oracle.baseline.json", import.meta.url),
);

const BaselineSchema = z.strictObject({
  schemaVersion: z.literal(1),
  // The measured file's inventory, so removing or relabeling a row is a diff.
  measuredIds: z.array(z.string()),
  unmeasuredIds: z.array(z.string()),
  // The gap file's ids, so deleting, adding or relabeling a gap row is a diff.
  gapIds: z.array(z.string()),
  // The measured rows that carry an expect, so dropping one drops its parity check.
  expectIds: z.array(z.string()),
  // Computed from one full run's modes by `pnpm oracle:ratchet`, not here.
  uncitedMeasured: z.array(z.string()),
  unknownNegativeInput: z.array(z.string()),
});

function readBaseline() {
  return BaselineSchema.parse(JSON.parse(readFileSync(BASELINE_PATH, "utf8")));
}

const sortedIds = (ids: string[]): string[] => [...ids].sort();

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
    `  To update: replace ${field} in interaction-oracle.baseline.json with exactly: ${JSON.stringify(computedIds)}`,
  ].join("\n");
}

describe("interaction oracle inventory", () => {
  const rows = loadOracleRows();
  // Gap rows are documented claims never measured, so the negative list leaves
  // them out. Their ids are pinned as gapIds instead.
  const measured = rows.filter(
    (row) => row.status === "measured" || row.status === "deviation",
  );
  const computedUnknownNegative = sortedIds(
    measured
      .filter((row) => row.claim === "negative" && row.inputPath === "unknown")
      .map((row) => row.id),
  );

  it("keeps the measured inventory equal to the baseline", () => {
    const inventory = measuredInventory(
      readOracleFile("interaction-oracle.json").rows,
    );
    const baseline = readBaseline();
    expect(
      inventory.measuredIds,
      "measured rows were added or removed; update measuredIds in interaction-oracle.baseline.json",
    ).toEqual(baseline.measuredIds);
    expect(
      inventory.unmeasuredIds,
      "a measured row changed to gap, or back; update unmeasuredIds in interaction-oracle.baseline.json",
    ).toEqual(baseline.unmeasuredIds);
  });

  it("keeps the gap inventory equal to the baseline", () => {
    const computed = sortedRowIds(
      readOracleFile("interaction-oracle-gaps.json").rows,
      "the gaps file",
    );
    const baseline = readBaseline();
    expect(computed, driftMessage("gapIds", baseline.gapIds, computed)).toEqual(
      baseline.gapIds,
    );
  });

  it("keeps the expect-bearing rows equal to the baseline", () => {
    const computed = sortedRowIds(
      readOracleFile("interaction-oracle.json").rows.filter(
        (row) => row.expect !== undefined,
      ),
      "the measured file",
    );
    const baseline = readBaseline();
    expect(
      computed,
      driftMessage("expectIds", baseline.expectIds, computed),
    ).toEqual(baseline.expectIds);
  });

  it("keeps the negative rows with unknown input path equal to the baseline", () => {
    const baseline = readBaseline();
    expect(
      computedUnknownNegative,
      driftMessage(
        "unknownNegativeInput",
        baseline.unknownNegativeInput,
        computedUnknownNegative,
      ),
    ).toEqual(baseline.unknownNegativeInput);
  });

  it("keeps every baseline list sorted and unique", () => {
    const baseline = readBaseline();
    const lists = {
      gapIds: baseline.gapIds,
      expectIds: baseline.expectIds,
      uncitedMeasured: baseline.uncitedMeasured,
      unknownNegativeInput: baseline.unknownNegativeInput,
    };
    for (const [field, ids] of Object.entries(lists)) {
      expect(
        new Set(ids).size,
        `${field} in the baseline has duplicate ids`,
      ).toBe(ids.length);
      expect(ids, `${field} in the baseline is not sorted`).toEqual(
        sortedIds(ids),
      );
    }
  });
});
