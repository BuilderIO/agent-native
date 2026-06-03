import { describe, expect, it } from "vitest";
import {
  pickCompressedDimensions,
  pickVideoBitrate,
  pickVideoFilters,
} from "./compress";

describe("pickCompressedDimensions", () => {
  it("caps landscape recordings at 720p", () => {
    expect(pickCompressedDimensions(3840, 2160)).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it("caps portrait recordings without changing aspect ratio", () => {
    expect(pickCompressedDimensions(1080, 1920)).toEqual({
      width: 720,
      height: 1280,
    });
  });

  it("leaves already-small recordings alone", () => {
    expect(pickCompressedDimensions(960, 540)).toEqual({
      width: 960,
      height: 540,
    });
  });

  it("keeps encoder dimensions even", () => {
    expect(pickCompressedDimensions(1921, 1081)).toEqual({
      width: 1280,
      height: 720,
    });
  });
});

describe("pickVideoBitrate", () => {
  it("caps short 1080p recordings at the 720p compression bitrate", () => {
    expect(pickVideoBitrate(1920, 1080, 30_000)).toEqual({
      bitrate: "1.6M",
      maxrate: "2M",
      bufsize: "3.2M",
    });
  });

  it("lowers bitrate for multi-minute clips to stay near the upload target", () => {
    // Target is ~18 MB (kept under Builder's ~32 MB Cloud Run edge cap), so a
    // 4-minute 1080p clip is budgeted down to ~0.5 Mbps.
    expect(pickVideoBitrate(1920, 1080, 4 * 60_000)).toEqual({
      bitrate: "0.5M",
      maxrate: "0.7M",
      bufsize: "1.1M",
    });
  });

  it("keeps a quality floor for longer clips", () => {
    expect(pickVideoBitrate(1920, 1080, 30 * 60_000)).toEqual({
      bitrate: "0.4M",
      maxrate: "0.4M",
      bufsize: "0.7M",
    });
  });
});

describe("pickVideoFilters", () => {
  it("caps frame rate and adds a scale filter when needed", () => {
    expect(pickVideoFilters(2560, 1440)).toEqual([
      "fps=24",
      "scale=1280:720:flags=lanczos",
    ]);
  });

  it("caps frame rate without resizing smaller recordings", () => {
    expect(pickVideoFilters(1280, 720)).toEqual(["fps=24"]);
  });
});
