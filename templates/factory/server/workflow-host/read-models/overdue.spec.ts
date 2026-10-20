import { describe, expect, it } from "vitest";

import type { ItemState } from "../../workflow/contract.js";
import {
  OVERDUE_AFTER_MINUTES,
  findOverdueWakes,
  overdueAfterMinutes,
} from "./overdue.js";

const NOW = Date.parse("2026-10-19T12:00:00.000Z");
const minutesAgo = (minutes: number) =>
  new Date(NOW - minutes * 60_000).toISOString();

function parked(wake: ItemState["wake"], itemId = "item-1"): ItemState {
  return {
    workflowId: "wf-1",
    graphVersion: 1,
    itemId,
    parkedAtNode: "wait",
    ...(wake ? { wake } : {}),
    context: {},
    counters: {},
    updatedAt: minutesAgo(0),
  };
}

describe("overdue wake times", () => {
  it("never calls an item overdue that diagnostics would not, and from the shortest cadence on they agree", () => {
    expect(overdueAfterMinutes(5)).toBe(OVERDUE_AFTER_MINUTES);
    expect(overdueAfterMinutes(15)).toBe(30);
    expect(overdueAfterMinutes(1440)).toBe(2880);
    for (const cadence of [5, 10, 15, 60]) {
      expect(overdueAfterMinutes(cadence)).toBeGreaterThanOrEqual(
        OVERDUE_AFTER_MINUTES,
      );
    }
  });

  it("measures from the sooner of the deadline and the next check, counts those past the threshold, and reports the oldest", () => {
    const items = [
      parked({ wait: "time", dueAt: minutesAgo(11) }, "just late"),
      parked({ wait: "time", dueAt: minutesAgo(45) }, "late"),
      parked(
        { wait: "reply", dueAt: minutesAgo(-600), nextCheckAt: minutesAgo(70) },
        "check missed",
      ),
      parked({ wait: "reply", dueAt: minutesAgo(-5) }, "not due"),
      parked(undefined, "no wake"),
      parked({ wait: "time", dueAt: "not a date" }, "unreadable"),
    ];

    expect(findOverdueWakes(items, NOW, 5)).toEqual({
      count: 3,
      oldestLatenessMinutes: 70,
      thresholdMinutes: 10,
    });
    expect(findOverdueWakes(items, NOW, 15)).toEqual({
      count: 2,
      oldestLatenessMinutes: 70,
      thresholdMinutes: 30,
    });
    expect(findOverdueWakes(items, NOW, 60)).toBeNull();
    expect(findOverdueWakes([], NOW, 15)).toBeNull();
  });
});
