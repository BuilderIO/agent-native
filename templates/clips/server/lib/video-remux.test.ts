import { describe, expect, it } from "vitest";

import {
  faststartMp4,
  isFfmpegAvailable,
  makeSeekable,
  normalizeTimelineToMp4,
  probeHasAudioStream,
  remuxWebmToSeekable,
  timelineNormalizationFfmpegArgs,
} from "./video-remux";

function atom(type: string, payload: Uint8Array = new Uint8Array()) {
  const bytes = new Uint8Array(8 + payload.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.byteLength);
  for (let i = 0; i < 4; i++) bytes[4 + i] = type.charCodeAt(i);
  bytes.set(payload, 8);
  return bytes;
}

function concat(...chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function firstTopLevelType(data: Uint8Array): string {
  return String.fromCharCode(data[4], data[5], data[6], data[7]);
}

function typeOffset(data: Uint8Array, type: string): number {
  const needle = new TextEncoder().encode(type);
  for (let i = 4; i <= data.byteLength - needle.byteLength; i++) {
    if (needle.every((byte, n) => data[i + n] === byte)) return i;
  }
  return -1;
}

describe("faststartMp4", () => {
  it("relocates a trailing moov ahead of mdat", () => {
    const input = concat(
      atom("ftyp", new TextEncoder().encode("isommp42")),
      atom("mdat", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
      atom("moov", new Uint8Array([0, 0, 0, 0])),
    );

    const result = faststartMp4(input);

    expect(result.changed).toBe(true);
    // ftyp still first, then moov must precede mdat now.
    expect(firstTopLevelType(result.bytes)).toBe("ftyp");
    const moovIdx = typeOffset(result.bytes, "moov");
    const mdatIdx = typeOffset(result.bytes, "mdat");
    expect(moovIdx).toBeGreaterThan(0);
    expect(moovIdx).toBeLessThan(mdatIdx);
  });

  it("leaves an already-faststarted mp4 unchanged", () => {
    const input = concat(
      atom("ftyp", new TextEncoder().encode("isommp42")),
      atom("moov", new Uint8Array([0, 0, 0, 0])),
      atom("mdat", new Uint8Array([1, 2, 3, 4])),
    );

    const result = faststartMp4(input);

    expect(result.changed).toBe(false);
    expect(result.bytes).toBe(input);
  });

  it("returns non-mp4 and empty input unchanged", () => {
    const empty = faststartMp4(new Uint8Array());
    expect(empty.changed).toBe(false);

    const notMp4 = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
    const result = faststartMp4(notMp4);
    expect(result.changed).toBe(false);
    expect(result.bytes).toBe(notMp4);
  });
});

describe("remuxWebmToSeekable", () => {
  it("returns empty input unchanged without invoking ffmpeg", async () => {
    const result = await remuxWebmToSeekable(new Uint8Array());
    expect(result.changed).toBe(false);
    expect(result.bytes.byteLength).toBe(0);
  });

  it("returns non-webm input unchanged (wrong magic bytes)", async () => {
    // MP4-looking bytes: no EBML magic, so we never touch ffmpeg.
    const notWebm = concat(atom("ftyp", new TextEncoder().encode("isommp42")));
    const result = await remuxWebmToSeekable(notWebm);
    expect(result.changed).toBe(false);
    expect(result.bytes).toBe(notWebm);
  });

  it("keeps the original bytes when the input cannot be remuxed", async () => {
    // Valid EBML magic but garbage body: whether ffmpeg is present (it fails)
    // or absent (guarded out), the fallback must preserve the input.
    const garbageEbml = new Uint8Array([
      0x1a, 0x45, 0xdf, 0xa3, 0x99, 0x88, 0x77, 0x66, 0x55, 0x44,
    ]);
    const result = await remuxWebmToSeekable(garbageEbml);
    expect(result.changed).toBe(false);
    expect(result.bytes).toBe(garbageEbml);
  });
});

describe("makeSeekable dispatch", () => {
  it("faststarts mp4 input", async () => {
    const input = concat(
      atom("ftyp", new TextEncoder().encode("isommp42")),
      atom("mdat", new Uint8Array([1, 2, 3, 4])),
      atom("moov", new Uint8Array([0, 0, 0, 0])),
    );
    const result = await makeSeekable({
      mediaBytes: input,
      videoFormat: "mp4",
    });
    expect(result.changed).toBe(true);
  });

  it("reports ffmpeg availability as a boolean", () => {
    expect(typeof isFfmpegAvailable()).toBe("boolean");
  });
});

describe("timeline normalization", () => {
  it("builds a CFR H.264/AAC faststart transcode that preserves optional audio", () => {
    const args = timelineNormalizationFfmpegArgs(
      "/tmp/input.webm",
      "/tmp/output.mp4",
    );

    expect(args).toContain("+genpts");
    expect(args).toContain("0:v:0");
    expect(args).toContain("0:a?");
    expect(args).toContain("fps=30");
    expect(args).toContain("libx264");
    expect(args).toContain("aac");
    expect(args).toContain("yuv420p");
    expect(args).toContain("+faststart");
    expect(args[args.length - 1]).toBe("/tmp/output.mp4");
  });

  it("leaves empty input untouched", async () => {
    const input = new Uint8Array();
    const result = await normalizeTimelineToMp4({
      mediaBytes: input,
      videoFormat: "webm",
    });

    expect(result).toEqual({ bytes: input, changed: false });
  });

  it("leaves undecodable input untouched", async () => {
    const input = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const result = await normalizeTimelineToMp4({
      mediaBytes: input,
      videoFormat: "webm",
    });

    expect(result.changed).toBe(false);
    expect(result.bytes).toBe(input);
  });
});

describe("probeHasAudioStream", () => {
  it("returns null for empty input without invoking ffmpeg", async () => {
    const result = await probeHasAudioStream(new Uint8Array(), "mp4");
    expect(result).toBeNull();
  });

  it("returns null (not false) for garbage bytes that ffmpeg can't demux", async () => {
    // Should never misreport an unreadable file as "confirmed no audio" —
    // callers treat null as "couldn't verify" and skip hard-fail checks.
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const result = await probeHasAudioStream(garbage, "mp4");
    expect(result).not.toBe(false);
  });
});
