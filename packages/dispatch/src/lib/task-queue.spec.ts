import { describe, expect, it } from "vitest";

import {
  formatQueueAgeSeconds,
  normalizeTaskQueueStats,
  ZERO_TASK_QUEUE_STATS,
} from "./task-queue";

describe("normalizeTaskQueueStats", () => {
  it("returns zeros for invalid payloads", () => {
    expect(normalizeTaskQueueStats(null)).toEqual(ZERO_TASK_QUEUE_STATS);
    expect(normalizeTaskQueueStats("bad")).toEqual(ZERO_TASK_QUEUE_STATS);
  });

  it("normalizes numeric fields and recent failures", () => {
    expect(
      normalizeTaskQueueStats({
        pending: "2",
        processing: 1,
        completed_last_hour: 4,
        failed_last_hour: "1",
        oldest_pending_age_seconds: 90,
        recent_failures: [
          {
            id: "f1",
            platform: "slack",
            error: "rate limited",
            attempts: "3",
          },
        ],
      }),
    ).toEqual({
      pending: 2,
      processing: 1,
      completed_last_hour: 4,
      failed_last_hour: 1,
      oldest_pending_age_seconds: 90,
      recent_failures: [
        {
          id: "f1",
          platform: "slack",
          error: "rate limited",
          attempts: 3,
        },
      ],
    });
  });
});

describe("formatQueueAgeSeconds", () => {
  it("formats common ages", () => {
    expect(formatQueueAgeSeconds(0)).toBe("none");
    expect(formatQueueAgeSeconds(12)).toBe("12s");
    expect(formatQueueAgeSeconds(120)).toBe("2m");
    expect(formatQueueAgeSeconds(7200)).toBe("2.0h");
  });
});
