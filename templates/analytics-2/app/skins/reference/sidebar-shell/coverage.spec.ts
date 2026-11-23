import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { errorFixtures } from "../../../testing/sidebar-shell/models/errors";
import { bootFixtures } from "../../../testing/sidebar-shell/models/lifecycle";
import {
  creationFixtures,
  publishedFixture,
} from "../../../testing/sidebar-shell/models/owners";
import { railFixtures } from "../../../testing/sidebar-shell/models/rails";
import { setupFixtures } from "../../../testing/sidebar-shell/models/setup";
import {
  frameFixtures,
  homeShellFixtures,
} from "../../../testing/sidebar-shell/models/shell";
import { workspaceFixtures } from "../../../testing/sidebar-shell/models/workspace";
import { referenceCoverageSummary } from "../../../testing/sidebar-shell/reference-coverage-summary";
import coverage from "../../../testing/sidebar-shell/reference-coverage.json";
import rows from "../../../testing/sidebar-shell/rows.json";

describe("reference accounting", () => {
  it("credits both exact account-image captures while retaining the custom and kit owner limits", () => {
    for (const id of ["sidebar.footer", "sidebar.account.open"]) {
      const row = coverage.find((entry) => entry.id === id);
      expect(row?.status).toBe("rendered-matched");
      for (const suffix of ["", "-surface"])
        expect(row?.witnesses).toContainEqual({
          fixture: "account-identity-image",
          baseline: `app/testing/sidebar-shell/reference-fixtures/account-identity-image${suffix}.json`,
          spec: "app/skins/reference/sidebar-shell/AccountImage.spec.tsx",
        });
    }
    expect(referenceCoverageSummary().denominator).toEqual({
      "rendered-matched": 109,
      "rendered-differs": 2,
      slot: 3,
      "not-rendered": 0,
      excluded: 0,
    });
    expect(referenceCoverageSummary().remaining.map((row) => row.id)).toEqual([
      "shell.nav",
      "sidebar.context-setup",
      "shell.create.new-project",
      "shell.create.import-project",
      "shell.error",
    ]);
  });
  it("accounts for every frozen identity once without changing the denominator", () => {
    expect(coverage.map((entry) => entry.id).sort()).toEqual(
      rows.map((row) => row.id).sort(),
    );
    expect(new Set(coverage.map((entry) => entry.id)).size).toBe(rows.length);
    for (const entry of coverage) {
      const source = rows.find((row) => row.id === entry.id);
      if (!source) throw new Error(`Unknown row ${entry.id}`);
      expect(entry.scope).toBe(source.scope);
      expect(entry.counted).toBe(
        source.scope === "swap" || source.scope === "custom",
      );
      expect(entry.familyMembers).toBe(source.family_members);
      expect(entry.presentations).toBe(source.presentation_witnesses);
      if (entry.status !== "rendered-matched")
        expect(entry.reason?.trim()).toBeTruthy();
      if (entry.status === "excluded") expect(entry.counted).toBe(false);
      if (entry.status === "rendered-matched") {
        expect(entry.renderer).not.toBeNull();
        expect(entry.witnesses.length).toBeGreaterThan(0);
      }
      if (entry.renderer) readFileSync(entry.renderer.file);
      for (const fixture of entry.modelFixtures) readFileSync(fixture);
    }
    expect(referenceCoverageSummary()).toMatchObject({
      rows: 135,
      counted: 114,
      mounted: 0,
      strict: 0,
    });
    const summary = referenceCoverageSummary();
    expect(
      summary.replayedPhaseArtifacts + summary.unreplayedPhaseArtifacts.length,
    ).toBe(52);
    expect(summary.missingRegionComparisons).toEqual(
      expect.arrayContaining(creationFixtures.map((fixture) => fixture.name)),
    );
    expect(summary.remaining.every((entry) => entry.reason?.trim())).toBe(true);
  });
  it("requires existing independently frozen evidence and a runnable fixture for each claimed witness", () => {
    const fixtures = new Set(
      [
        ...workspaceFixtures,
        ...errorFixtures,
        ...creationFixtures,
        publishedFixture,
        ...railFixtures,
        ...setupFixtures,
        ...frameFixtures,
        ...homeShellFixtures,
        ...bootFixtures.map((fixture) => ({ name: `${fixture.name}-mounted` })),
        { name: "shortcut-owner" },
        { name: "shortcut-existing-guards" },
      ].map((fixture) => fixture.name),
    );
    for (const entry of coverage)
      for (const witness of entry.witnesses) {
        expect(fixtures.has(witness.fixture), witness.fixture).toBe(true);
        const frozen = JSON.parse(readFileSync(witness.baseline, "utf8")) as {
          name: string;
          rows: string[];
        };
        expect(frozen.name).toBe(witness.fixture);
        expect(frozen.rows).toContain(entry.id);
        readFileSync(witness.spec);
      }
  });
});
