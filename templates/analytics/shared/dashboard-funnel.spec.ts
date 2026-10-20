import { describe, expect, it } from "vitest";

import {
  describeFunnelOutcomeProblems,
  funnelOutcomeKeys,
  funnelOutcomeShare,
  resolveDashboardFunnelRows,
} from "./dashboard-funnel";

describe("resolveDashboardFunnelRows", () => {
  it("keeps SQL stage order and calculates conversion metadata", () => {
    expect(
      resolveDashboardFunnelRows([
        { stage: "Visited", count: "100" },
        { stage: "Signed up", count: 50 },
        { stage: "Activated", count: 25 },
      ]),
    ).toEqual({
      labelKey: "stage",
      valueKey: "count",
      items: [
        {
          label: "Visited",
          value: 100,
          percentOfFirst: 100,
          dropOffPercent: null,
        },
        {
          label: "Signed up",
          value: 50,
          percentOfFirst: 50,
          dropOffPercent: 50,
        },
        {
          label: "Activated",
          value: 25,
          percentOfFirst: 25,
          dropOffPercent: 50,
        },
      ],
    });
  });

  it("honors configured columns and drops invalid stages", () => {
    expect(
      resolveDashboardFunnelRows(
        [
          { name: "Lead", amount: 10, ignored: "x" },
          { name: "Won", amount: -1, ignored: "x" },
          { name: "Lost", amount: "not a number", ignored: "x" },
        ],
        "name",
        "amount",
      ),
    ).toMatchObject({
      labelKey: "name",
      valueKey: "amount",
      items: [
        {
          label: "Lead",
          value: 10,
          percentOfFirst: 100,
          dropOffPercent: null,
        },
      ],
    });
  });
});

const ONBOARDING = [
  {
    step: "Your role",
    shown: 1927,
    completed: 1168,
    skipped: 520,
    left_here: 75,
    optional: true,
  },
  {
    step: "Choose setup",
    shown: "2543",
    completed: "1885",
    skipped: "0",
    left_here: "337",
    optional: "false",
  },
];

const OUTCOMES = {
  completedKey: "completed",
  skippedKey: "skipped",
  leftKey: "left_here",
  optionalKey: "optional",
};

describe("resolveDashboardFunnelRows with funnelOutcomes", () => {
  it("splits each stage and counts the rest of the people shown as moved on", () => {
    const funnel = resolveDashboardFunnelRows(
      ONBOARDING,
      "step",
      "shown",
      OUTCOMES,
    );

    expect(funnel.items.map((item) => item.outcomes)).toEqual([
      { completed: 1168, skipped: 520, movedOn: 164, left: 75, optional: true },
      { completed: 1885, skipped: 0, movedOn: 321, left: 337, optional: false },
    ]);
    expect(funnel.outcomes).toEqual({
      keys: OUTCOMES,
      missingColumns: [],
      issues: [],
    });
    expect(funnelOutcomeShare(75, 1927).toFixed(1)).toBe("3.9");
    expect(funnelOutcomeShare(5, 0)).toBe(0);
  });

  it("leaves a funnel without the key as it was", () => {
    const funnel = resolveDashboardFunnelRows(ONBOARDING, "step", "shown");

    expect(funnel).not.toHaveProperty("outcomes");
    expect(funnel.items.some((item) => "outcomes" in item)).toBe(false);
  });

  it("draws a stage whose counts don't add up as a plain bar and says why", () => {
    const funnel = resolveDashboardFunnelRows(
      [
        {
          step: "Your role",
          shown: 10,
          completed: 8,
          left_here: 5,
          optional: true,
        },
        {
          step: "Connect",
          shown: 10,
          completed: null,
          left_here: 1,
          optional: false,
        },
        { step: "Done", shown: 4, completed: 4, left_here: 0, optional: "yes" },
      ],
      "step",
      "shown",
      {
        completedKey: "completed",
        leftKey: "left_here",
        optionalKey: "optional",
      },
    );

    expect(funnel.items.map((item) => item.outcomes ?? null)).toEqual([
      null,
      null,
      { completed: 4, skipped: 0, movedOn: 0, left: 0, optional: false },
    ]);
    expect(funnel.outcomes?.issues).toEqual([
      { label: "Your role", problem: "overfull" },
      { label: "Connect", problem: "not-a-count" },
      { label: "Done", problem: "not-a-flag" },
    ]);
    expect(describeFunnelOutcomeProblems(funnel.outcomes!)).toBe(
      'Stage "Your role": completed, skipped and left add up to more than shown; shown without the outcome split. ' +
        'Stage "Connect": an outcome column is not a non-negative count; shown without the outcome split. ' +
        'Stage "Done": the optional column is not true or false; shown without the Optional tag.',
    );
  });

  it("splits no stage while a configured column is missing", () => {
    const funnel = resolveDashboardFunnelRows(ONBOARDING, "step", "shown", {
      ...OUTCOMES,
      leftKey: "left",
    });

    expect(funnel.items.some((item) => item.outcomes)).toBe(false);
    expect(funnel.outcomes).toMatchObject({
      missingColumns: ["left"],
      issues: [],
    });
    expect(describeFunnelOutcomeProblems(funnel.outcomes!)).toBe(
      "The result has no left column, so no stage splits into outcomes.",
    );
  });

  it("ignores a funnelOutcomes value that names no usable columns", () => {
    expect(funnelOutcomeKeys({ completedKey: "completed" })).toBeNull();
    expect(funnelOutcomeKeys(["completed", "left_here"])).toBeNull();
    expect(
      funnelOutcomeKeys({ completedKey: "c", leftKey: "l", skippedKey: 3 }),
    ).toBeNull();
    expect(
      resolveDashboardFunnelRows(ONBOARDING, "step", "shown", "completed"),
    ).not.toHaveProperty("outcomes");
  });
});
