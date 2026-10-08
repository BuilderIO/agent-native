// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  blobToBase64,
  isReplayFrameRequest,
  replayFrameFailureReason,
} from "./session-replay-frame";
import { ReplayScreenshotAssetError } from "./session-replay-screenshot";

describe("isReplayFrameRequest", () => {
  it("needs a recording path, frame=1, and an agent link token", () => {
    expect(
      isReplayFrameRequest("/sessions/sr_1", "?frame=1&agent_access=tok"),
    ).toBe(true);
    expect(
      isReplayFrameRequest(
        "/sessions/sr_1/",
        "?agent_access=tok&frame=1&atMs=5",
      ),
    ).toBe(true);
  });

  it("never opens the unauthenticated frame without a token", () => {
    expect(isReplayFrameRequest("/sessions/sr_1", "?frame=1")).toBe(false);
    expect(
      isReplayFrameRequest("/sessions/sr_1", "?frame=1&agent_access="),
    ).toBe(false);
  });

  it("leaves every other page, and the normal viewer, alone", () => {
    expect(isReplayFrameRequest("/sessions/sr_1", "?agent_access=tok")).toBe(
      false,
    );
    expect(
      isReplayFrameRequest("/sessions/sr_1", "?frame=true&agent_access=t"),
    ).toBe(false);
    expect(isReplayFrameRequest("/sessions", "?frame=1&agent_access=t")).toBe(
      false,
    );
    expect(
      isReplayFrameRequest("/sessions/events", "?frame=1&agent_access=t"),
    ).toBe(false);
    expect(
      isReplayFrameRequest("/sessions/performance/", "?frame=1&agent_access=t"),
    ).toBe(false);
    expect(
      isReplayFrameRequest("/dashboards/d1", "?frame=1&agent_access=t"),
    ).toBe(false);
    expect(
      isReplayFrameRequest("/sessions/a/b", "?frame=1&agent_access=t"),
    ).toBe(false);
  });
});

describe("replayFrameFailureReason", () => {
  it("names uncapturable assets without echoing the message", () => {
    expect(replayFrameFailureReason(new ReplayScreenshotAssetError())).toBe(
      "assets_not_capturable",
    );
  });

  it("collapses and bounds other errors", () => {
    expect(replayFrameFailureReason(new Error("offset_out_of_range"))).toBe(
      "offset_out_of_range",
    );
    expect(replayFrameFailureReason(new Error("a\n\n b"))).toBe("a b");
    expect(replayFrameFailureReason(new Error("x".repeat(500)))).toHaveLength(
      200,
    );
    expect(replayFrameFailureReason("boom")).toBe("boom");
    expect(replayFrameFailureReason(new Error(""))).toBe("unknown_error");
  });
});

describe("blobToBase64", () => {
  it("returns the bytes without the data URL prefix", async () => {
    const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
      type: "image/png",
    });
    expect(await blobToBase64(blob)).toBe("iVBORw==");
  });
});
