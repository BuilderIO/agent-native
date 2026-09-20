import { describe, expect, it } from "vitest";

import {
  isCrossScreenIgnoreAutoLayoutHeldAtRelease,
  shouldClearCrossScreenSKeyTimesOnWindowBlur,
  type CrossScreenSKeyTimes,
} from "./cross-screen-modifiers";

const withoutTimes = (): CrossScreenSKeyTimes => ({
  downAt: null,
  upAt: null,
});

const timesAfterBlur = (
  times: CrossScreenSKeyTimes,
  documentHasFocus: boolean,
): CrossScreenSKeyTimes =>
  shouldClearCrossScreenSKeyTimesOnWindowBlur(documentHasFocus)
    ? withoutTimes()
    : times;

describe("cross-screen Ignore Auto Layout release timing", () => {
  it("uses S state at source-end creation, regardless of keyup delivery order", () => {
    const heldThenReleased = { downAt: 100, upAt: 130 };

    expect(
      isCrossScreenIgnoreAutoLayoutHeldAtRelease(120, heldThenReleased, false),
    ).toBe(true);
    expect(
      isCrossScreenIgnoreAutoLayoutHeldAtRelease(140, heldThenReleased, true),
    ).toBe(false);
  });

  it("honors a host keyup when source iframe owned the keydown", () => {
    expect(
      isCrossScreenIgnoreAutoLayoutHeldAtRelease(
        140,
        { downAt: null, upAt: 130 },
        true,
      ),
    ).toBe(false);
    expect(
      isCrossScreenIgnoreAutoLayoutHeldAtRelease(
        120,
        { downAt: null, upAt: 130 },
        true,
      ),
    ).toBe(true);
  });

  it("clears S timing after a real window blur but preserves iframe-focus handoff", () => {
    const held = { downAt: 100, upAt: null };

    expect(
      isCrossScreenIgnoreAutoLayoutHeldAtRelease(
        120,
        timesAfterBlur(held, false),
        false,
      ),
    ).toBe(false);
    expect(
      isCrossScreenIgnoreAutoLayoutHeldAtRelease(
        120,
        timesAfterBlur(held, true),
        false,
      ),
    ).toBe(true);
  });
});
