import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parityEvalScenarios } from "../eval-scenarios";
import { parityMatrix } from "../matrix";

const contentRoot = new URL("../../", import.meta.url);
const priorityCapabilityIds = [
  "database.lifecycle-and-trash",
  "database.rows",
  "source-sync.database-source-bindings",
  "sidebar.document-tree-crud",
  "editor.document-body-and-title",
  "local-files.import-export-mounted-folder",
  "sharing.document-discoverability-and-export",
  "source-sync.builder-cms-review-and-write-gates",
] as const;

describe("Content parity critical capability coverage", () => {
  it("keeps PR 2.2 priority capabilities backed by deterministic refs or gated evals", () => {
    const scenarioIds = new Set(
      parityEvalScenarios.map((scenario) => scenario.id),
    );
    const matrixById = new Map(parityMatrix.map((row) => [row.id, row]));

    const missing = priorityCapabilityIds.flatMap((id) => {
      const row = matrixById.get(id);
      if (!row) return [`Capability ${id} is missing from the parity matrix`];

      const coverageRefs = row.coverageRefs ?? [];
      const evalScenarioIds = row.evalScenarioIds ?? [];
      const hasExistingTest = coverageRefs.some((ref) =>
        existsSync(new URL(ref, contentRoot)),
      );
      const hasScenario = evalScenarioIds.some((scenarioId) =>
        scenarioIds.has(scenarioId),
      );

      return hasExistingTest || hasScenario
        ? []
        : [
            `Capability ${row.id} has no deterministic or gated coverage: add coverageRefs or evalScenarioIds`,
          ];
    });

    expect(missing).toEqual([]);
  });

  it("points coverage refs at real files", () => {
    const missingRefs = parityMatrix.flatMap((row) =>
      (row.coverageRefs ?? [])
        .filter((ref) => !existsSync(new URL(ref, contentRoot)))
        .map((ref) => `${row.id}: ${ref}`),
    );

    expect(missingRefs).toEqual([]);
  });
});
