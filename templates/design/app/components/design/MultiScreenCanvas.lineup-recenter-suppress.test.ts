import { describe, expect, it } from "vitest";

import {
  isLineupShrinkOnlyChange,
  LINEUP_RECENTER_SUPPRESS_MAX_AGE_MS,
  shouldSuppressLineupRecenter,
} from "./MultiScreenCanvas";

const arm = (atMs: number, fromCount: number, addedCount = 1) => ({
  atMs,
  fromCount,
  addedCount,
});

describe("shouldSuppressLineupRecenter (duplicate commits keep the camera still)", () => {
  it("suppresses the fromCount -> fromCount+1 transition while fresh (alt-drag)", () => {
    expect(
      shouldSuppressLineupRecenter({
        armed: arm(1_000, 5),
        nowMs: 1_400,
        screenCount: 6,
        deviceFrameChanged: false,
      }),
    ).toBe(true);
  });

  it("suppresses every intermediate transition of a multi-frame Cmd+D", () => {
    // 3 selected frames duplicated from a 5-screen board: 6, 7, 8 all land
    // one create-file round-trip at a time — every arrival keeps the camera.
    for (const screenCount of [6, 7, 8]) {
      expect(
        shouldSuppressLineupRecenter({
          armed: arm(1_000, 5, 3),
          nowMs: 1_500,
          screenCount,
          deviceFrameChanged: false,
        }),
      ).toBe(true);
    }
    // A 9th screen is NOT part of the armed duplicate — recenter runs.
    expect(
      shouldSuppressLineupRecenter({
        armed: arm(1_000, 5, 3),
        nowMs: 1_500,
        screenCount: 9,
        deviceFrameChanged: false,
      }),
    ).toBe(false);
  });

  it("never suppresses when nothing armed it (initial-load fit, toolbar add-screen)", () => {
    expect(
      shouldSuppressLineupRecenter({
        armed: null,
        nowMs: 1_000,
        screenCount: 6,
        deviceFrameChanged: false,
      }),
    ).toBe(false);
  });

  it("never suppresses a device-frame-preview-driven run, even when armed", () => {
    expect(
      shouldSuppressLineupRecenter({
        armed: arm(1_000, 5),
        nowMs: 1_200,
        screenCount: 6,
        deviceFrameChanged: true,
      }),
    ).toBe(false);
  });

  it("only suppresses counts inside the armed (fromCount, fromCount+addedCount] window", () => {
    // Count went DOWN (delete while armed) — not this helper's transition.
    expect(
      shouldSuppressLineupRecenter({
        armed: arm(1_000, 5),
        nowMs: 1_200,
        screenCount: 4,
        deviceFrameChanged: false,
      }),
    ).toBe(false);
    // Same count (id swap, no footprint change) — nothing to suppress.
    expect(
      shouldSuppressLineupRecenter({
        armed: arm(1_000, 5),
        nowMs: 1_200,
        screenCount: 5,
        deviceFrameChanged: false,
      }),
    ).toBe(false);
    // Two screens appeared but only one was armed (concurrent collaborator
    // add) — past the window, recenter runs.
    expect(
      shouldSuppressLineupRecenter({
        armed: arm(1_000, 5, 1),
        nowMs: 1_200,
        screenCount: 7,
        deviceFrameChanged: false,
      }),
    ).toBe(false);
  });

  it("expires: a stale armed flag from a failed duplicate cannot swallow a later recenter", () => {
    expect(
      shouldSuppressLineupRecenter({
        armed: arm(1_000, 5),
        nowMs: 1_000 + LINEUP_RECENTER_SUPPRESS_MAX_AGE_MS + 1,
        screenCount: 6,
        deviceFrameChanged: false,
      }),
    ).toBe(false);
    // Boundary: exactly at max age still counts as fresh.
    expect(
      shouldSuppressLineupRecenter({
        armed: arm(1_000, 5),
        nowMs: 1_000 + LINEUP_RECENTER_SUPPRESS_MAX_AGE_MS,
        screenCount: 6,
        deviceFrameChanged: false,
      }),
    ).toBe(true);
  });

  it("rejects a clock that ran backwards", () => {
    expect(
      shouldSuppressLineupRecenter({
        armed: arm(2_000, 5),
        nowMs: 1_000,
        screenCount: 6,
        deviceFrameChanged: false,
      }),
    ).toBe(false);
  });

  it("honors a custom maxAgeMs", () => {
    expect(
      shouldSuppressLineupRecenter({
        armed: arm(0, 3),
        nowMs: 50,
        screenCount: 4,
        deviceFrameChanged: false,
        maxAgeMs: 40,
      }),
    ).toBe(false);
  });
});

describe("isLineupShrinkOnlyChange (delete/undo never recenters)", () => {
  it("skips the recenter when the screen count shrank (delete, undo of duplicate)", () => {
    expect(
      isLineupShrinkOnlyChange({
        previousCount: 6,
        screenCount: 5,
        deviceFrameChanged: false,
      }),
    ).toBe(true);
  });

  it("does not skip the initial mount run", () => {
    expect(
      isLineupShrinkOnlyChange({
        previousCount: null,
        screenCount: 5,
        deviceFrameChanged: false,
      }),
    ).toBe(false);
  });

  it("does not skip growth (toolbar add-screen still recenters)", () => {
    expect(
      isLineupShrinkOnlyChange({
        previousCount: 5,
        screenCount: 6,
        deviceFrameChanged: false,
      }),
    ).toBe(false);
  });

  it("does not skip an equal-count re-run", () => {
    expect(
      isLineupShrinkOnlyChange({
        previousCount: 5,
        screenCount: 5,
        deviceFrameChanged: false,
      }),
    ).toBe(false);
  });

  it("device-frame-preview changes always recenter, even while shrinking", () => {
    expect(
      isLineupShrinkOnlyChange({
        previousCount: 6,
        screenCount: 5,
        deviceFrameChanged: true,
      }),
    ).toBe(false);
  });
});
