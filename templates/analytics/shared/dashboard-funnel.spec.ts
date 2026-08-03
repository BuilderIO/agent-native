import { describe, expect, it } from "vitest";

import { resolveDashboardFunnelRows } from "./dashboard-funnel";

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
