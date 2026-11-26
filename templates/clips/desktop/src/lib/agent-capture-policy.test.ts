import { describe, expect, it } from "vitest";

import {
  agentCaptureSourceRefusal,
  AgentCaptureRefusal,
  richTracksForCapture,
} from "./agent-capture-policy";

describe("agent capture source", () => {
  it("refuses a window source with a typed error instead of switching to full screen", () => {
    const refusal = agentCaptureSourceRefusal({
      source: "window",
      mode: "screen",
      nativeFullscreenAvailable: true,
    });
    expect(refusal).toBeInstanceOf(AgentCaptureRefusal);
    expect(refusal?.code).toBe("window_capture_unsupported");
    expect(refusal?.message).toContain("full screen only");
  });

  it("refuses a region and camera-only mode", () => {
    expect(
      agentCaptureSourceRefusal({
        source: "region",
        mode: "screen-camera",
        nativeFullscreenAvailable: true,
      })?.code,
    ).toBe("region_capture_unsupported");
    expect(
      agentCaptureSourceRefusal({
        source: "full-screen",
        mode: "camera",
        nativeFullscreenAvailable: true,
      })?.code,
    ).toBe("camera_only_unsupported");
  });

  it("refuses full screen when native capture is unavailable", () => {
    expect(
      agentCaptureSourceRefusal({
        source: "full-screen",
        mode: "screen",
        nativeFullscreenAvailable: false,
      })?.code,
    ).toBe("native_capture_unavailable");
  });

  it("allows native full screen", () => {
    expect(
      agentCaptureSourceRefusal({
        source: "full-screen",
        mode: "screen-camera",
        nativeFullscreenAvailable: true,
      }),
    ).toBeNull();
  });
});

describe("motion quality and rich tracks", () => {
  it("records rich tracks only at normal quality", () => {
    expect(
      richTracksForCapture({
        captureQuality: "normal",
        richTracksLabEnabled: true,
      }),
    ).toBe(true);
    expect(
      richTracksForCapture({
        captureQuality: "motion",
        richTracksLabEnabled: true,
      }),
    ).toBe(false);
    expect(
      richTracksForCapture({
        captureQuality: "normal",
        richTracksLabEnabled: false,
      }),
    ).toBe(false);
  });
});
