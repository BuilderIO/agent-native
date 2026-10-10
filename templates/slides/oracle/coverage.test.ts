import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { titleCitations } from "./citations";
import { measuredInventory } from "./inventory";
import { loadOracleRows, readOracleFile } from "./load";

const SLIDES_ROOT = fileURLToPath(new URL("../", import.meta.url));
const BASELINE_PATH = fileURLToPath(
  new URL("interaction-oracle.baseline.json", import.meta.url),
);

// The files Vitest runs (its include pattern, vitest.config.ts) and the
// directories it excludes, so the scan covers every test file the suite runs.
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".react-router",
]);

const BaselineSchema = z.strictObject({
  schemaVersion: z.literal(1),
  // The measured file's inventory, so removing or relabeling a row is a diff.
  measuredIds: z.array(z.string()),
  unmeasuredIds: z.array(z.string()),
  uncitedMeasured: z.array(z.string()),
  unknownNegativeInput: z.array(z.string()),
});

function listTestFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) files.push(...listTestFiles(full));
    } else if (entry.isFile() && TEST_FILE.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/** Each cited row id, with the repo-relative files that cite it. */
function collectCitations(): Map<string, string[]> {
  const cited = new Map<string, string[]>();
  for (const file of listTestFiles(SLIDES_ROOT)) {
    const relative = path.relative(SLIDES_ROOT, file);
    for (const id of titleCitations(readFileSync(file, "utf8"), relative)) {
      const files = cited.get(id) ?? [];
      if (!files.includes(relative)) files.push(relative);
      cited.set(id, files);
    }
  }
  return cited;
}

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
    `  To update: cite each added row from a test title ("oracle <id>"),`,
    `  or replace ${field} in interaction-oracle.baseline.json with exactly: ${JSON.stringify(computedIds)}`,
  ].join("\n");
}

describe("interaction oracle traceability", () => {
  const rows = loadOracleRows();
  const rowIds = new Set(rows.map((row) => row.id));
  const cited = collectCitations();
  // Gap rows are documented claims never measured, so no test is asked to cite them.
  const measured = rows.filter(
    (row) => row.status === "measured" || row.status === "deviation",
  );
  const computedUncited = sortedIds(
    measured.filter((row) => !cited.has(row.id)).map((row) => row.id),
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

  it("cites only rows that exist in the oracle", () => {
    const dangling = [...cited.keys()].filter((id) => !rowIds.has(id));
    const lines = dangling.map(
      (id) => `  ${id} (cited in ${(cited.get(id) ?? []).join(", ")})`,
    );
    expect(
      dangling,
      `Citations name oracle rows that do not exist:\n${lines.join("\n")}\nFix the id in the citing test title or check label.`,
    ).toEqual([]);
  });

  it("keeps the uncited measured rows equal to the baseline", () => {
    const baseline = readBaseline();
    expect(
      computedUncited,
      driftMessage(
        "uncitedMeasured",
        baseline.uncitedMeasured,
        computedUncited,
      ),
    ).toEqual(baseline.uncitedMeasured);
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

  it("keeps both baseline lists sorted and unique", () => {
    const baseline = readBaseline();
    const lists = {
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
