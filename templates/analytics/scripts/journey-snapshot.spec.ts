import { describe, expect, it } from "vitest";

import type { SnapshotTree } from "./journey-snapshot-plan.js";
import { summaryTargets } from "./journey-snapshot.js";

function tree(app: "clips" | "design", rootN: number): SnapshotTree {
  return {
    window: { from: "2026-10-19", to: "2026-10-25" },
    app,
    rootN,
    coverage: {
      sessionsWithEvents: rootN,
      sessionsWithReplay: rootN,
      truncated: false,
      paginationConsistency: "stable",
    },
    nodes: [],
  };
}

function readCoverage() {
  return {
    rawRows: 12,
    invalidRows: 0,
    pages: 1,
    truncated: false,
    paginationConsistency: "stable" as const,
    sessionlessMcpOauthSignupEvents: 3,
  };
}

describe("journey snapshot summary targets", () => {
  it("retains every Design first-touch cohort, including empty cohorts", () => {
    const result = {
      format: "cohorts",
      app: "design",
      window: { from: "2026-10-19", to: "2026-10-25" },
      tree: tree("design", 12),
      readCoverage: readCoverage(),
      designFirstTouch: {
        cohorts: {
          web: tree("design", 10),
          "mcp-oauth": tree("design", 0),
          unknown: tree("design", 2),
        },
        conflictingSessions: 0,
        sessionlessMcpOauthSignupTree: {
          ...tree("design", 3),
          populationGrain: "signup_events",
        },
      },
    } satisfies Parameters<typeof summaryTargets>[1];

    expect(
      summaryTargets("design", result, false).map((target) => [
        target.key,
        target.tree.rootN,
      ]),
    ).toEqual([
      ["design-web", 10],
      ["design-mcp-oauth", 0],
      ["design-unknown", 2],
      ["design-sessionless-mcp-oauth-signups", 3],
    ]);
  });

  it("retains an experiment arm with no assigned sessions", () => {
    const result = {
      format: "cohorts",
      app: "clips",
      window: { from: "2026-10-19", to: "2026-10-25" },
      tree: tree("clips", 10),
      readCoverage: readCoverage(),
      experiment: {
        id: "first_run_builder_credits",
        arms: {
          control: tree("clips", 10),
          credits: tree("clips", 0),
        },
        assignedSessions: 10,
        exposureSessions: 10,
        unassignedSessions: 0,
        conflictingSessions: 0,
      },
    } satisfies Parameters<typeof summaryTargets>[1];

    expect(
      summaryTargets("clips", result, true).map((target) => [
        target.key,
        target.tree.rootN,
      ]),
    ).toEqual([
      ["clips-control", 10],
      ["clips-credits", 0],
    ]);
  });
});
