import { chromium, type Browser } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  findExportBaselineProblems,
  hashExportSource,
  loadExportBaseline,
  loadExportCases,
  runExportCase,
} from "./lib/export-regression.js";

/**
 * PR gate for the real offline export path. This deliberately runs the same
 * HTML -> live DOM -> Figma SVG -> rendered PNG pipeline as the manual CLI,
 * against every checked-in corpus case and built-in preset.
 *
 * Credentialed Figma/Google readbacks stay manual because PR CI cannot safely
 * share those accounts. The deterministic gate still catches the regressions
 * the historical loops found: page-evaluated exporter errors, wrong canvas
 * dimensions, silent omissions, broken assets, and pixel drift.
 * Typography has a wider reviewed pixel ceiling because HTML and SVG glyph
 * rasterization differs between the macOS developer environment and Linux CI;
 * its 6.218% ceiling is the observed 5.407% Linux result plus the CLI's
 * standard 15% calibration headroom. Other loss signals stay exact.
 */
describe("Figma export fidelity corpus", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
  });

  it("keeps every checked-in case within its reviewed pixel and loss ceilings", async () => {
    const cases = loadExportCases().filter((testCase) => !testCase.adHoc);
    const baseline = loadExportBaseline();

    expect(cases.map((testCase) => testCase.id).sort()).toEqual(
      Object.keys(baseline).sort(),
    );

    const outcomes = [];
    for (const testCase of cases) {
      outcomes.push(await runExportCase(browser, testCase));
    }

    expect(outcomes.every((outcome) => outcome.status === "ok")).toBe(true);
    expect(outcomes.flatMap((outcome) => outcome.renderWarnings ?? [])).toEqual(
      [],
    );
    expect(findExportBaselineProblems(outcomes, baseline)).toEqual([]);
  }, 180_000);
});

describe("Figma export baseline gate", () => {
  it("treats omissions, new cases, and missing runs as regressions", () => {
    const baseline = {
      stable: {
        maxDiffPercent: 1,
        maxOmitted: 0,
        maxApproximated: 0,
        sourceHash: hashExportSource("stable"),
      },
      missing: {
        maxDiffPercent: 1,
        maxOmitted: 0,
        maxApproximated: 0,
        sourceHash: hashExportSource("missing"),
      },
    };
    const problems = findExportBaselineProblems(
      [
        {
          id: "stable",
          sourceHash: hashExportSource("stable"),
          status: "ok",
          diffRatio: 0,
          exportOmissions: 1,
          exportApproximations: 0,
        },
        {
          id: "new-case",
          sourceHash: hashExportSource("new-case"),
          status: "ok",
          diffRatio: 0,
          exportOmissions: 0,
          exportApproximations: 0,
        },
      ],
      baseline,
    );

    expect(problems).toEqual([
      expect.stringContaining("stable: 1 omitted"),
      expect.stringContaining("new-case: no baseline entry"),
      expect.stringContaining("missing: baselined case did not run"),
    ]);
  });

  it("requires a reviewed source for every recorded ceiling", () => {
    const problems = findExportBaselineProblems(
      [
        {
          id: "changed",
          sourceHash: hashExportSource("new source"),
          status: "ok",
          diffRatio: 0,
          exportOmissions: 0,
          exportApproximations: 0,
        },
      ],
      {
        changed: {
          maxDiffPercent: 10,
          maxOmitted: 0,
          maxApproximated: 0,
          sourceHash: hashExportSource("old source"),
        },
      },
    );

    expect(problems).toEqual([
      "changed: source changed since the reviewed baseline; record a new ceiling after reviewing the export",
    ]);
  });
});
