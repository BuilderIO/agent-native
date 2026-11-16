import { describe, expect, it } from "vitest";

import {
  countRemovedPendingStyleEntries,
  retainPendingVisualStyleUndoTargets,
} from "./history-cleanup";

describe("pending style history cleanup", () => {
  it("keeps the unapplied head and rebuilds grouped targets after a partial Apply", () => {
    const entry = {
      edit: { screenId: "home", selector: ".a", updatedAt: 1 },
      revertStyles: { color: "red" },
      groupedTargets: [
        {
          edit: { screenId: "home", selector: ".b", updatedAt: 1 },
          revertStyles: { color: "blue" },
        },
      ],
    };

    expect(
      retainPendingVisualStyleUndoTargets(entry, new Set(["style:home:.a:1"])),
    ).toEqual({
      ...entry,
      edit: { screenId: "home", selector: ".b", updatedAt: 1 },
      revertStyles: { color: "blue" },
      groupedTargets: undefined,
    });
  });

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

  it("keeps the order marker while any target in a grouped entry survives", () => {
    const entries = [
      {
        edit: { screenId: "home", selector: ".a", updatedAt: 1 },
        groupedTargets: [
          { edit: { screenId: "home", selector: ".b", updatedAt: 1 } },
        ],
      },
    ];

    expect(
      countRemovedPendingStyleEntries(entries, new Set(["style:home:.a:1"])),
    ).toBe(0);
  });
});
