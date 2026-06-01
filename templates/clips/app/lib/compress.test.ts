import { describe, expect, it } from "vitest";
import { pickVideoBitrate } from "./compress";

describe("pickVideoBitrate", () => {
  it("caps short 1080p recordings at the resolution bitrate", () => {
    expect(pickVideoBitrate(1920, 1080, 30_000)).toEqual({
      bitrate: "3M",
      maxrate: "3.8M",
      bufsize: "6M",
    });
  });

  it("lowers bitrate for multi-minute clips to stay near the upload target", () => {
    // Target is ~22 MB (kept under Builder's ~32 MB Cloud Run edge cap), so a
    // 4-minute 1080p clip is budgeted down to ~0.7 Mbps.
    expect(pickVideoBitrate(1920, 1080, 4 * 60_000)).toEqual({
      bitrate: "0.7M",
      maxrate: "0.8M",
      bufsize: "1.3M",
    });
  });

  it("keeps a quality floor for longer clips", () => {
    expect(pickVideoBitrate(1920, 1080, 30 * 60_000)).toEqual({
      bitrate: "0.5M",
      maxrate: "0.6M",
      bufsize: "0.9M",
    });
  });
});
