import { describe, expect, it } from "vitest";

import {
  isLegacyRecordingPath,
  isRecordingSharePath,
  isStandalonePublicPath,
} from "./public-ssr-paths";

describe("isStandalonePublicPath", () => {
  it("matches the /download page", () => {
    expect(isStandalonePublicPath("/download")).toBe(true);
    expect(isStandalonePublicPath("/download/")).toBe(true);
  });

  it("matches bug-report routes", () => {
    expect(isStandalonePublicPath("/bug-report")).toBe(true);
    expect(isStandalonePublicPath("/bug-report/done")).toBe(true);
  });

  it("matches /share/:shareId recording pages", () => {
    expect(isStandalonePublicPath("/share/abc123")).toBe(true);
    expect(isStandalonePublicPath("/share/abc123/")).toBe(true);
  });

  it("matches /embed/:shareId embed pages", () => {
    expect(isStandalonePublicPath("/embed/abc123")).toBe(true);
  });

  it("matches /invite/:token team invite pages", () => {
    expect(isStandalonePublicPath("/invite/tok456")).toBe(true);
  });

  it("does NOT match authenticated app paths", () => {
    expect(isStandalonePublicPath("/")).toBe(false);
    expect(isStandalonePublicPath("/library")).toBe(false);
    expect(isStandalonePublicPath("/settings")).toBe(false);
    expect(isStandalonePublicPath("/spaces/abc")).toBe(false);
  });

  it("does not treat /r/:recordingId as a standalone SSR page", () => {
    expect(isStandalonePublicPath("/r/abc123")).toBe(false);
  });
});

describe("isLegacyRecordingPath", () => {
  it("matches legacy recording links before the session gate", () => {
    expect(isLegacyRecordingPath("/r/abc123")).toBe(true);
    expect(isLegacyRecordingPath("/r/abc123/")).toBe(true);
  });

  it("does not match other authenticated paths", () => {
    expect(isLegacyRecordingPath("/r")).toBe(false);
    expect(isLegacyRecordingPath("/library")).toBe(false);
    expect(isLegacyRecordingPath("/share/abc123")).toBe(false);
  });
});

describe("isRecordingSharePath", () => {
  it("matches recording shares without matching meeting shares", () => {
    expect(isRecordingSharePath("/share/abc123")).toBe(true);
    expect(isRecordingSharePath("/share/abc123/")).toBe(true);
    expect(isRecordingSharePath("/share/meeting/meeting123")).toBe(false);
  });
});
