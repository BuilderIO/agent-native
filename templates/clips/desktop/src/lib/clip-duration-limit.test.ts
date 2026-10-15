import { describe, expect, it } from "vitest";

import {
  currentTakeClipLimitMs,
  hostedClipDurationLimitMs,
  reachedClipDurationLimit,
  resolveTakeClipLimitMs,
  setTakeClipLimitMs,
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

  it("lets the cap from create-recording override the storage probe", () => {
    // Stale cached "configured" probe saw no cap; the server made it hosted.
    expect(resolveTakeClipLimitMs(600_000, null)).toBe(600_000);
    expect(resolveTakeClipLimitMs(600_000, 300_000)).toBe(600_000);
    // Own storage stays uncapped even if an earlier probe saw a hosted cap.
    expect(resolveTakeClipLimitMs(null, 600_000)).toBeNull();
    // Older servers omit the field, so the probe value is used.
    expect(resolveTakeClipLimitMs(undefined, 600_000)).toBe(600_000);
  });

  it("tracks the per-take cap from the create response until cleared", () => {
    setTakeClipLimitMs(600_000);
    expect(currentTakeClipLimitMs(null)).toBe(600_000);
    setTakeClipLimitMs(null);
    expect(currentTakeClipLimitMs(600_000)).toBeNull();
    setTakeClipLimitMs(undefined);
    expect(currentTakeClipLimitMs(300_000)).toBe(300_000);
  });
});
