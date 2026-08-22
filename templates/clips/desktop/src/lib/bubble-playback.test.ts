import { describe, expect, it } from "vitest";

import {
  BUBBLE_RENDER_GRACE_MS,
  isRenderingWebrtc,
  shouldReportUnrendered,
} from "./bubble-playback";

const base = {
  trackArrivedAt: 1_000,
  now: 1_000 + BUBBLE_RENDER_GRACE_MS,
  paused: true,
  videoWidth: 0,
  alreadyReported: false,
};

describe("isRenderingWebrtc", () => {
  it("requires decoded frames, not just an unpaused element", () => {
    expect(isRenderingWebrtc({ paused: false, videoWidth: 0 })).toBe(false);
    expect(isRenderingWebrtc({ paused: false, videoWidth: 1280 })).toBe(true);
    expect(isRenderingWebrtc({ paused: true, videoWidth: 1280 })).toBe(false);
  });
});

describe("shouldReportUnrendered", () => {
  it("reports a track that never produced frames within the grace window", () => {
    expect(shouldReportUnrendered(base)).toBe(true);
  });

  it("keeps waiting while the grace window has not elapsed", () => {
    expect(shouldReportUnrendered({ ...base, now: base.now - 1 })).toBe(false);
  });

  it("stays quiet when there is no track to render", () => {
    expect(shouldReportUnrendered({ ...base, trackArrivedAt: null })).toBe(
      false,
    );
  });

  it("stays quiet once frames are on screen", () => {
    expect(
      shouldReportUnrendered({ ...base, paused: false, videoWidth: 1280 }),
    ).toBe(false);
  });

  it("reports a blocked element that WebKit left unpaused but frameless", () => {
    expect(shouldReportUnrendered({ ...base, paused: false })).toBe(true);
  });

  it("reports once per track so the fallback is not requested in a loop", () => {
    expect(shouldReportUnrendered({ ...base, alreadyReported: true })).toBe(
      false,
    );
  });
});
