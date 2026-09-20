import { describe, expect, it } from "vitest";

import {
  isCrossScreenIgnoreAutoLayoutHeldAtRelease,
  mergeCrossScreenReleaseModifiers,
  seedCrossScreenSKeyTimesAtStart,
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
  it("seeds a source-held S before host keyup can be observed", () => {
    expect(seedCrossScreenSKeyTimesAtStart(true, withoutTimes(), 100)).toEqual({
      downAt: 100,
      upAt: null,
    });
    const held = seedCrossScreenSKeyTimesAtStart(true, withoutTimes(), 100);
    expect(isCrossScreenIgnoreAutoLayoutHeldAtRelease(120, held, true)).toBe(
      true,
    );
    const released = seedCrossScreenSKeyTimesAtStart(
      true,
      { downAt: null, upAt: 130 },
      100,
    );
    expect(released).toEqual({ downAt: null, upAt: 130 });
    expect(
      isCrossScreenIgnoreAutoLayoutHeldAtRelease(140, released, true),
    ).toBe(false);
  });

  it("leaves a source-without-S gesture unchanged", () => {
    const times = { downAt: null, upAt: 90 };
    expect(seedCrossScreenSKeyTimesAtStart(false, times, 100)).toBe(times);
  });

  it("discards a stale prior-gesture keyup when seeding a new gesture", () => {
    expect(
      seedCrossScreenSKeyTimesAtStart(true, { downAt: null, upAt: 90 }, 100),
    ).toEqual({ downAt: 100, upAt: null });
  });

  it("lets release modifiers replace only fields present at release", () => {
    expect(
      mergeCrossScreenReleaseModifiers(
        {
          metaKey: true,
          ctrlKey: false,
          ignoreAutoLayout: true,
          forceNestedAutoLayout: true,
        },
        { ignoreAutoLayout: false },
      ),
    ).toEqual({
      metaKey: true,
      ctrlKey: false,
      ignoreAutoLayout: false,
      forceNestedAutoLayout: true,
    });
  });

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
