import { describe, expect, it } from "vitest";

import {
  removePendingHistoryOrderEntries,
  removedPendingVisualStyleHistoryEntries,
  retainPendingVisualStyleUndoTargets,
} from "./history-cleanup";

const styleEdit = (selector: string) => ({
  screenId: "home",
  filename: "home.tsx",
  screenName: "Home",
  selector,
  classes: [],
  styles: {},
  originalStyles: {},
  updatedAt: 1,
});

describe("pending style history cleanup", () => {
  it("keeps the unapplied head and rebuilds grouped targets after a partial Apply", () => {
    const entry = {
      edit: styleEdit(".a"),
      revertStyles: { color: "red" },
      groupedTargets: [
        {
          edit: styleEdit(".b"),
          revertStyles: { color: "blue" },
        },
      ],
    };

    expect(
      retainPendingVisualStyleUndoTargets(entry, new Set(["style:home:.a:1"])),
    ).toEqual({
      ...entry,
      edit: styleEdit(".b"),
      revertStyles: { color: "blue" },
      groupedTargets: undefined,
    });
  });

  it("returns the marker only when every target in a grouped entry was applied", () => {
    const entries = [
      {
        edit: styleEdit(".a"),
        revertStyles: {},
        historyOrderEntry: { kind: "pending-style" as const, id: "group" },
        groupedTargets: [
          {
            edit: styleEdit(".a"),
            revertStyles: {},
          },
          {
            edit: styleEdit(".b"),
            revertStyles: {},
          },
        ],
      },
    ];

    expect(
      removedPendingVisualStyleHistoryEntries(
        entries,
        new Set(["style:home:.a:1", "style:home:.b:1"]),
      ).map((entry) => entry.id),
    ).toEqual(["group"]);
  });

  it("keeps the entry marker while any grouped target survives", () => {
    const entries = [
      {
        edit: styleEdit(".a"),
        revertStyles: {},
        historyOrderEntry: { kind: "pending-style" as const, id: "group" },
        groupedTargets: [
          {
            edit: styleEdit(".b"),
            revertStyles: {},
          },
        ],
      },
    ];

    expect(
      removedPendingVisualStyleHistoryEntries(
        entries,
        new Set(["style:home:.a:1"]),
      ),
    ).toEqual([]);
  });

  it("removes the older applied marker and keeps a newer pending entry's marker", () => {
    const order = [
      { kind: "pending-style" as const, id: "older" },
      { kind: "pending-live" as const, id: "middle" },
      { kind: "pending-style" as const, id: "newer" },
    ];

    expect(removePendingHistoryOrderEntries(order, new Set(["older"]))).toEqual(
      [order[1], order[2]],
    );
  });
});
