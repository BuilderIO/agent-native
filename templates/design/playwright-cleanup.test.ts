import { describe, expect, it } from "vitest";

import { cleanupDesignE2eArtifacts } from "./e2e/global-teardown";

describe("Design Playwright artifact cleanup", () => {
  it("removes only this run's artifacts after a pass", () => {
    const removed: string[] = [];
    cleanupDesignE2eArtifacts(
      { pgliteDir: "run/pglite", resultsDir: "run/results" },
      0,
      (target) => removed.push(target),
    );
    expect(removed).toEqual(["run/pglite", "run/results"]);
  });

  it("preserves artifacts after a failure", () => {
    const removed: string[] = [];
    cleanupDesignE2eArtifacts(
      { pgliteDir: "run/pglite", resultsDir: "run/results" },
      1,
      (target) => removed.push(target),
    );
    expect(removed).toEqual([]);
  });
});
