import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/server", () => ({
  signShortLivedToken: vi.fn(() => "signed-token"),
}));

import { resolvePlayerVideoUrl } from "./player-video-url";

describe("resolvePlayerVideoUrl", () => {
  it("keeps Loom playback behind the same-origin video route", () => {
    expect(
      resolvePlayerVideoUrl({
        id: "rec-1",
        sourceAppName: "Loom",
        sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
        videoUrl: "https://www.loom.com/embed/abcDEF_123456",
      }),
    ).toBe("/api/video/rec-1");
  });

  it("adds short-lived password tokens only to same-origin video routes", () => {
    expect(
      resolvePlayerVideoUrl(
        {
          id: "rec-1",
          password: "encrypted",
          videoUrl: "/api/uploads/rec-1/blob",
        },
        { addPasswordToken: true },
      ),
    ).toBe("/api/video/rec-1?t=signed-token");

    expect(
      resolvePlayerVideoUrl(
        {
          id: "rec-2",
          password: "encrypted",
          videoUrl: "https://cdn.example.com/clip.mp4",
        },
        { addPasswordToken: true },
      ),
    ).toBe("https://cdn.example.com/clip.mp4");
  });
});
