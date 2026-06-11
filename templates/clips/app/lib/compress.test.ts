import { describe, expect, it } from "vitest";
import {
  pickCompressedDimensions,
  pickVideoFilters,
  pickVideoRateLimit,
} from "./compress";

describe("pickCompressedDimensions", () => {
  it("caps landscape recordings at HandBrake-style 1080p", () => {
    expect(pickCompressedDimensions(3840, 2160)).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it("caps portrait recordings without changing aspect ratio", () => {
    expect(pickCompressedDimensions(1080, 1920)).toEqual({
      width: 1080,
      height: 1920,
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
      width: 1920,
      height: 1080,
    });
  });
});

describe("pickVideoRateLimit", () => {
  it("uses a HandBrake-like ceiling when duration is unknown", () => {
    expect(pickVideoRateLimit()).toEqual({
      maxrate: "6M",
      bufsize: "12M",
    });
  });

  it("lowers the VBV ceiling for multi-minute clips", () => {
    // Target is ~18 MB (kept under Builder's ~32 MB Cloud Run edge cap), so a
    // 4-minute 1080p clip is constrained to about 0.4 Mbps video plus audio.
    expect(pickVideoRateLimit(4 * 60_000)).toEqual({
      maxrate: "405k",
      bufsize: "810k",
    });
  });

  it("keeps a quality floor for longer clips", () => {
    expect(pickVideoRateLimit(30 * 60_000)).toEqual({
      maxrate: "350k",
      bufsize: "700k",
    });
  });
});

describe("pickVideoFilters", () => {
  it("adds a scale filter when needed", () => {
    expect(pickVideoFilters(2560, 1440)).toEqual([
      "scale=1920:1080:flags=lanczos",
    ]);
  });

  it("does not resize smaller recordings", () => {
    expect(pickVideoFilters(1280, 720)).toEqual([]);
  });
});
