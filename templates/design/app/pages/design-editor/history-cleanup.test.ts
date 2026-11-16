import { describe, expect, it } from "vitest";

import { countRemovedPendingStyleEntries } from "./history-cleanup";

describe("pending style history cleanup", () => {
  it("counts one order marker for a removed multi-target entry beside a survivor", () => {
    const entries = [
      {
        edit: { screenId: "home", selector: ".a", updatedAt: 1 },
        groupedTargets: [
          {
            edit: { screenId: "home", selector: ".a", updatedAt: 1 },
          },
          {
            edit: { screenId: "home", selector: ".b", updatedAt: 1 },
          },
        ],
      },
      { edit: { screenId: "home", selector: ".c", updatedAt: 2 } },
    ];

    expect(
      countRemovedPendingStyleEntries(
        entries,
        new Set(["style:home:.a:1", "style:home:.b:1"]),
      ),
    ).toBe(1);
    expect(entries).toHaveLength(2);
  });
});
