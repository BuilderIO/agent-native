import { describe, expect, it } from "vitest";

import {
  hostedClipDurationLimitMs,
  reachedClipDurationLimit,
} from "./clip-duration-limit";

const caps = { maxClipDurationMs: 600_000 };

describe("desktop clip duration cap", () => {
  it("passes the hosted cap through and gives own storage none", () => {
    expect(hostedClipDurationLimitMs({ ...caps, mode: "hosted" })).toBe(
      600_000,
    );
    expect(hostedClipDurationLimitMs({ ...caps, mode: "own" })).toBeNull();
  });

  it("stops an unpaused take at the cap", () => {
    const live = { paused: false, elapsedMs: 600_000 };
    expect(reachedClipDurationLimit(live, 600_000)).toBe(true);
    expect(
      reachedClipDurationLimit({ ...live, elapsedMs: 599_999 }, 600_000),
    ).toBe(false);
  });

  it("never stops without a cap, with a zero cap, or while paused", () => {
    const live = { paused: false, elapsedMs: 9_999_999 };
    expect(reachedClipDurationLimit(live, null)).toBe(false);
    expect(reachedClipDurationLimit(live, 0)).toBe(false);
    expect(reachedClipDurationLimit({ ...live, paused: true }, 600_000)).toBe(
      false,
    );
  });
});
