import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep as pathSeparator } from "node:path";
import { fileURLToPath } from "node:url";

import type { Browser } from "@playwright/test";

import { renderDesignToFigmaSvg } from "../../../server/lib/design-to-figma-svg.js";
import { DESIGN_TEMPLATE_PRESETS } from "../../../shared/design-template-presets.js";
import { comparePngs, type CompareResult } from "./compare.js";
import { renderDocumentToPng, renderSvgToPng } from "./render.js";

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);
export const DEFAULT_EXPORT_OUT_DIR = join(
  REPO_ROOT,
  ".tmp/figma-fidelity/export",
);
export const EXPORT_BASELINE_PATH = join(
  REPO_ROOT,
  "templates/design/scripts/figma-fidelity/export-baseline.json",
);

export interface BaselineEntry {
  maxDiffPercent: number;
  maxOmitted: number;
  maxApproximated: number;
  sourceHash: string;
}

export interface ExportCase {
  id: string;
  html: string;
  width: number;
  height: number;
  rootSelector?: string | null;
  adHoc?: boolean;
}

export interface CaseOutcome {
  id: string;
  sourceHash: string;
  status: "ok" | "failed";
  diffRatio?: number;
  meanDelta?: number;
  dimensionMismatch?: boolean;
  adHoc?: boolean;
  worstCells?: CompareResult["worstCells"];
  renderWarnings?: string[];
  exportOmissions?: number;
  exportApproximations?: number;
  error?: string;
}

export function hashExportSource(html: string): string {
  return createHash("sha256").update(html).digest("hex");
}

function presetCases(): ExportCase[] {
  return DESIGN_TEMPLATE_PRESETS.map((preset) => ({
    id: preset.id,
    html: preset.content,
    width: preset.width,
    height: preset.height,
    rootSelector: '[data-agent-native-node-id="template-artboard"]',
  }));
}

function corpusCases(): ExportCase[] {
  const cases: ExportCase[] = [];
  const corpusDirs = [
    join(REPO_ROOT, "templates/design/scripts/figma-fidelity/corpus"),
    join(REPO_ROOT, ".tmp/figma-fidelity/corpus"),
  ];

  for (const root of corpusDirs) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, entry.name);
      const htmlPath = join(dir, "screen.html");
      const metaPath = join(dir, "meta.json");
      if (!existsSync(htmlPath) || !existsSync(metaPath)) continue;
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
        width: number;
        height: number;
        rootSelector?: string;
      };
      cases.push({
        id: entry.name,
        html: readFileSync(htmlPath, "utf8"),
        width: meta.width,
        height: meta.height,
        rootSelector: meta.rootSelector ?? null,
        adHoc: root.includes(`${pathSeparator}.tmp${pathSeparator}`),
      });
    }
  }
  return cases;
}

export function loadExportCases(filter?: string): ExportCase[] {
  const cases = [...presetCases(), ...corpusCases()].filter(
    (testCase) => !filter || testCase.id.includes(filter),
  );
  if (!cases.length) {
    throw new Error(
      `No export cases matched${filter ? ` filter "${filter}"` : ""}. ` +
        "Add cases under templates/design/scripts/figma-fidelity/corpus/<id>/" +
        "{screen.html,meta.json}.",
    );
  }
  return cases;
}

export function loadExportBaseline(): Record<string, BaselineEntry> {
  return existsSync(EXPORT_BASELINE_PATH)
    ? (JSON.parse(readFileSync(EXPORT_BASELINE_PATH, "utf8")) as Record<
        string,
        BaselineEntry
      >)
    : {};
}

export async function runExportCase(
  browser: Browser,
  testCase: ExportCase,
  outDir = DEFAULT_EXPORT_OUT_DIR,
): Promise<CaseOutcome> {
  const dir = join(outDir, testCase.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "screen.html"), testCase.html);

  const renderOptions = {
    width: testCase.width,
    height: testCase.height,
    deviceScaleFactor: 1,
    rootSelector: testCase.rootSelector,
  };

  const reference = await renderDocumentToPng(
    browser,
    testCase.html,
    renderOptions,
  );
  writeFileSync(join(dir, "design.png"), reference.png);

  const { svg, report } = await renderDesignToFigmaSvg({
    html: testCase.html,
    width: testCase.width,
    height: testCase.height,
    embedImages: true,
    title: testCase.id,
    rootSelector: testCase.rootSelector,
  });
  writeFileSync(join(dir, "export.svg"), svg);
  writeFileSync(
    join(dir, "export-report.json"),
    JSON.stringify(report, null, 2),
  );

  const candidate = await renderSvgToPng(browser, svg, renderOptions);
  writeFileSync(join(dir, "export.png"), candidate.png);

  const comparison = await comparePngs(browser, reference.png, candidate.png, {
    threshold: 8,
  });
  writeFileSync(join(dir, "diff.png"), comparison.diffPng);

  const { diffPng: _diffPng, ...serializable } = comparison;
  writeFileSync(
    join(dir, "compare.json"),
    JSON.stringify(
      {
        ...serializable,
        renderWarnings: [...reference.warnings, ...candidate.warnings],
      },
      null,
      2,
    ),
  );

  return {
    id: testCase.id,
    sourceHash: hashExportSource(testCase.html),
    status: "ok",
    adHoc: testCase.adHoc,
    diffRatio: comparison.diffRatio,
    meanDelta: comparison.meanDelta,
    dimensionMismatch: comparison.dimensionMismatch,
    worstCells: comparison.worstCells.slice(0, 4),
    renderWarnings: [...reference.warnings, ...candidate.warnings],
    exportOmissions: report.omitted?.length ?? 0,
    exportApproximations: report.approximated?.length ?? 0,
  };
}

export function findExportBaselineProblems(
  outcomes: readonly CaseOutcome[],
  baseline: Record<string, BaselineEntry>,
  filter?: string,
): string[] {
  const problems: string[] = [];
  for (const outcome of outcomes) {
    if (outcome.status !== "ok") {
      problems.push(`${outcome.id}: case failed to export - ${outcome.error}`);
      continue;
    }
    const expected = baseline[outcome.id];
    if (!expected && outcome.adHoc) continue;
    if (!expected) {
      problems.push(
        `${outcome.id}: no baseline entry - run with --update to record one`,
      );
      continue;
    }
    const diffPercent = (outcome.diffRatio ?? 0) * 100;
    if (outcome.sourceHash !== expected.sourceHash) {
      problems.push(
        `${outcome.id}: source changed since the reviewed baseline; record a new ceiling after reviewing the export`,
      );
    }
    if (diffPercent > expected.maxDiffPercent) {
      problems.push(
        `${outcome.id}: ${diffPercent.toFixed(3)}% differing pixels exceeds the ${expected.maxDiffPercent}% ceiling`,
      );
    }
    if ((outcome.exportOmissions ?? 0) > expected.maxOmitted) {
      problems.push(
        `${outcome.id}: ${outcome.exportOmissions} omitted, ceiling ${expected.maxOmitted} - the export is dropping content`,
      );
    }
    if ((outcome.exportApproximations ?? 0) > expected.maxApproximated) {
      problems.push(
        `${outcome.id}: ${outcome.exportApproximations} approximated, ceiling ${expected.maxApproximated}`,
      );
    }
    if (outcome.dimensionMismatch) {
      problems.push(`${outcome.id}: exported SVG is not the screen's size`);
    }
  }

  const ran = new Set(outcomes.map((outcome) => outcome.id));
  for (const id of Object.keys(baseline)) {
    if (filter && !id.includes(filter)) continue;
    if (!ran.has(id)) problems.push(`${id}: baselined case did not run`);
  }
  return problems;
}

export function ceilingFor(diffPercent: number): number {
  return Number((diffPercent + Math.max(0.1, diffPercent * 0.15)).toFixed(3));
}
