import { describe, expect, it } from "vitest";

import {
  cleanupDesignE2eArtifacts,
  designE2eRunRoot,
} from "./e2e/global-teardown";

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

  it("uses the configured run root for loopback teardown", () => {
    expect(
      designE2eRunRoot("/repo/templates/design", "/tmp/custom-e2e-root", "run"),
    ).toBe("/tmp/custom-e2e-root");
  });

  it("uses the run id when no root is configured", () => {
    expect(designE2eRunRoot("/repo/templates/design", undefined, "run")).toBe(
      "/repo/.tmp/design-e2e/run",
    );
  });
});
