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

  it("keeps reuploaded Loom imports behind the same-origin video route", () => {
    expect(
      resolvePlayerVideoUrl({
        id: "rec-1",
        sourceAppName: "Loom",
        sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
        videoUrl: "https://cdn.example.com/reuploaded.mp4",
      }),
    ).toBe("/api/video/rec-1?loomMedia=1");
  });

  it("can app-prefix reuploaded Loom media routes once", () => {
    expect(
      resolvePlayerVideoUrl(
        {
          id: "rec-1",
          sourceAppName: "Loom",
          sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
          videoUrl: "https://cdn.example.com/reuploaded.mp4",
        },
        { appPath: (path) => `/clips${path}` },
      ),
    ).toBe("/clips/api/video/rec-1?loomMedia=1");
  });

  it("keeps non-Loom provider URLs direct", () => {
    expect(
      resolvePlayerVideoUrl({
        id: "rec-1",
        sourceAppName: "Screen Recorder",
        videoUrl: "https://cdn.example.com/reuploaded.mp4",
      }),
    ).toBe("https://cdn.example.com/reuploaded.mp4");
  });

  it("can proxy non-Loom provider URLs through the same-origin video route", () => {
    expect(
      resolvePlayerVideoUrl(
        {
          id: "rec-1",
          sourceAppName: "Screen Recorder",
          videoUrl: "https://cdn.example.com/reuploaded.mp4",
        },
        { proxyRemoteMedia: true },
      ),
    ).toBe("/api/video/rec-1");
  });

  it("can app-prefix proxied non-Loom provider URLs", () => {
    expect(
      resolvePlayerVideoUrl(
        {
          id: "rec-1",
          sourceAppName: "Screen Recorder",
          videoUrl: "https://cdn.example.com/reuploaded.mp4",
        },
        { appPath: (path) => `/clips${path}`, proxyRemoteMedia: true },
      ),
    ).toBe("/clips/api/video/rec-1");
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

    expect(
      resolvePlayerVideoUrl(
        {
          id: "rec-2",
          password: "encrypted",
          videoUrl: "https://cdn.example.com/clip.mp4",
        },
        { addPasswordToken: true, proxyRemoteMedia: true },
      ),
    ).toBe("/api/video/rec-2?t=signed-token");

    expect(
      resolvePlayerVideoUrl(
        {
          id: "rec-3",
          password: "encrypted",
          sourceAppName: "Loom",
          sourceWindowTitle: "https://www.loom.com/share/abcDEF_123456",
          videoUrl: "https://cdn.example.com/loom.mp4",
        },
        { addPasswordToken: true },
      ),
    ).toBe("/api/video/rec-3?loomMedia=1&t=signed-token");
  });
});
