import { describe, expect, it } from "vitest";

import {
  buildRichRecordingManifest,
  finalizeRichRecordingSchema,
  sanitizeTrackMeta,
} from "./rich-recording-manifest";

const finalize = {
  startedAt: "2026-11-11T14:00:00.000-05:00",
  durationMs: 61_000,
  writer: {
    surface: "desktop-macos",
    app: "Clips",
    version: "1.4.0",
    os: "macOS 15.1",
  },
  clock: { host: "mach-host-time" },
  capture: { kind: "display" },
  compat: { offsetMs: 0, cursor: "in-pixels", camera: "bubble" },
  privacy: { keys: "shortcuts", pageInputs: "masked" },
  tracks: [
    {
      id: "screen",
      startMs: 0,
      endMs: 61_000,
      complete: true,
      meta: { codec: "avc1.640028", widthPx: 3024, secret: "drop me" },
    },
  ],
};

describe("finalizeRichRecordingSchema", () => {
  it("reads a recorder's finalize with its defaults", () => {
    const parsed = finalizeRichRecordingSchema.parse(finalize);
    expect(parsed.status).toBe("complete");
    expect(parsed.clock.pauses).toEqual([]);
    expect(parsed.capture.displays).toEqual([]);
  });

  it("refuses a track listed twice, a track that ends before it starts, and an unknown track", () => {
    const screen = finalize.tracks[0];
    for (const tracks of [
      [screen, screen],
      [{ ...screen, startMs: 5_000, endMs: 4_000 }],
      [{ ...screen, id: "manifest" }],
      [],
    ]) {
      expect(
        finalizeRichRecordingSchema.safeParse({ ...finalize, tracks }).success,
      ).toBe(false);
    }
  });

  it("refuses a start time without its offset", () => {
    expect(
      finalizeRichRecordingSchema.safeParse({
        ...finalize,
        startedAt: "2026-11-11T14:00:00",
      }).success,
    ).toBe(false);
  });
});

describe("sanitizeTrackMeta", () => {
  it("keeps the fields this version understands for the track's kind", () => {
    expect(
      sanitizeTrackMeta("screen", {
        codec: "avc1.640028",
        widthPx: 3024,
        secret: "drop me",
        sampleRate: 48_000,
      }),
    ).toEqual({ codec: "avc1.640028", widthPx: 3024 });
    expect(
      sanitizeTrackMeta("mic", { sampleRate: 48_000, channels: 1 }),
    ).toEqual({ sampleRate: 48_000, channels: 1 });
  });

  it("keeps nothing from fields of the wrong shape", () => {
    expect(sanitizeTrackMeta("screen", { widthPx: "wide" })).toEqual({});
    expect(sanitizeTrackMeta("input", undefined)).toEqual({});
  });
});

describe("buildRichRecordingManifest", () => {
  const { tracks: _tracks, ...input } =
    finalizeRichRecordingSchema.parse(finalize);
  const row = {
    contentType: "video/mp4",
    bytes: 1_000,
    startMs: 0,
    endMs: 61_000,
    complete: true,
    metaJson: "{}",
  };

  it("describes what was stored, in track order, with files named relative to it", () => {
    const manifest = buildRichRecordingManifest("rec-1", input, [
      {
        ...row,
        track: "mic",
        contentType: "audio/webm",
        bytes: 200,
        complete: false,
        metaJson: JSON.stringify({ sampleRate: 48_000, codec: 5 }),
      },
      {
        ...row,
        track: "screen",
        metaJson: JSON.stringify({ codec: "avc1.640028", secret: "x" }),
      },
    ]);

    expect(manifest).toMatchObject({
      format: "clips.rich-recording",
      version: 1,
      recordingId: "rec-1",
      status: "complete",
      durationMs: 61_000,
      compat: { offsetMs: 0, cursor: "in-pixels", camera: "bubble" },
    });
    expect(manifest.tracks).toEqual([
      {
        codec: "avc1.640028",
        id: "screen",
        kind: "screen",
        startMs: 0,
        endMs: 61_000,
        file: "screen.mp4",
        bytes: 1_000,
        complete: true,
      },
      {
        id: "mic",
        kind: "mic",
        startMs: 0,
        endMs: 61_000,
        file: "mic.webm",
        bytes: 200,
        complete: false,
      },
    ]);
  });

  it("never names where a track is stored", () => {
    const manifest = buildRichRecordingManifest("rec-1", input, [
      {
        ...row,
        track: "screen",
        metaJson: JSON.stringify({
          url: "https://storage.example.com/clips/rec-1.track-screen",
        }),
      },
    ]);
    expect(JSON.stringify(manifest)).not.toContain("storage.example.com");
  });

  it("leaves out a stored row that isn't a known track", () => {
    const manifest = buildRichRecordingManifest("rec-1", input, [
      { ...row, track: "screen" },
      { ...row, track: "hologram" },
    ]);
    expect(manifest.tracks.map((track) => track.id)).toEqual(["screen"]);
  });
});
