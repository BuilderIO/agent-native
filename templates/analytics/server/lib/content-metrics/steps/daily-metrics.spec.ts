import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ previous: vi.fn() }));
vi.mock("../store.js", () => ({ lastSucceededContentRun: mocks.previous }));

import type { ContentCollection } from "../store.js";
import { collectionWindow } from "./daily-metrics.js";

describe("collectionWindow", () => {
  it.each([
    [null, "2026-07-23"],
    ["2026-10-18", "2026-10-18"],
    ["2026-10-05", "2026-10-06"],
    ["2026-01-01", "2026-07-23"],
  ])(
    "recovers from coverage through %s within the backfill bound",
    async (windowEnd, startDate) => {
      mocks.previous.mockResolvedValue(windowEnd ? { windowEnd } : null);
      expect(
        await collectionWindow(
          {} as ContentCollection,
          "ga4",
          new Date("2026-10-21T00:00:00Z"),
          3,
        ),
      ).toEqual({ startDate, endDate: "2026-10-20" });
    },
  );
});
