import { describe, expect, it } from "vitest";

import {
  findMoofOffset,
  fragmentPtsSeconds,
  indexOfAscii,
  isFragmentedMp4Head,
  parseAvcCodec,
  parseInitSegment,
  parseTracks,
  readFragmentDecodeTime,
  readTopLevelBoxes,
} from "./fmp4";

const enc = new TextEncoder();

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

/** Build a box: 4-byte size, 4-byte type, payload. */
function box(type: string, payload: number[]): number[] {
  const size = 8 + payload.length;
  return [...u32(size), ...Array.from(enc.encode(type)), ...payload];
}

describe("indexOfAscii", () => {
  it("finds a marker and respects the from offset", () => {
    const bytes = new Uint8Array(enc.encode("__ftyp__ftyp"));
    expect(indexOfAscii(bytes, "ftyp")).toBe(2);
    expect(indexOfAscii(bytes, "ftyp", 3)).toBe(8);
    expect(indexOfAscii(bytes, "nope")).toBe(-1);
  });
});

describe("isFragmentedMp4Head", () => {
  it("detects the hlsf brand", () => {
    const ftyp = box("ftyp", [
      ...Array.from(enc.encode("isom")), // major brand
      ...u32(0), // minor version
      ...Array.from(enc.encode("iso5")),
      ...Array.from(enc.encode("hlsf")),
    ]);
    expect(isFragmentedMp4Head(new Uint8Array(ftyp))).toBe(true);
  });

  it("detects an mvex box", () => {
    const ftyp = box("ftyp", [...Array.from(enc.encode("isom")), ...u32(0)]);
    const moov = box("moov", box("mvex", []));
    expect(isFragmentedMp4Head(new Uint8Array([...ftyp, ...moov]))).toBe(true);
  });

  it("returns false for a classic (non-fragmented) mp4", () => {
    const ftyp = box("ftyp", [
      ...Array.from(enc.encode("isom")),
      ...u32(0),
      ...Array.from(enc.encode("mp42")),
    ]);
    const moov = box("moov", box("mvhd", u32(1000)));
    expect(isFragmentedMp4Head(new Uint8Array([...ftyp, ...moov]))).toBe(false);
  });

  it("returns false when classic mp4 binary data contains the bytes 'mvex' inside mvhd", () => {
    // A regular MP4 whose mvhd payload happens to contain the byte sequence
    // 0x6d766578 ("mvex") — a false positive the old raw-scan code would hit.
    const ftyp = box("ftyp", [
      ...Array.from(enc.encode("isom")),
      ...u32(0),
      ...Array.from(enc.encode("mp42")),
    ]);
    const mvexBytes = Array.from(enc.encode("mvex")); // 6d 76 65 78
    const moov = box("moov", box("mvhd", [...u32(0), ...mvexBytes, ...u32(0)]));
    expect(isFragmentedMp4Head(new Uint8Array([...ftyp, ...moov]))).toBe(false);
  });

  it("returns false when it is not an mp4", () => {
    expect(
      isFragmentedMp4Head(new Uint8Array(enc.encode("not an mp4 file"))),
    ).toBe(false);
  });
});

describe("readTopLevelBoxes", () => {
  it("walks sequential boxes", () => {
    const ftyp = box("ftyp", u32(0));
    const moov = box("moov", []);
    const boxes = readTopLevelBoxes(new Uint8Array([...ftyp, ...moov]));
    expect(boxes.map((b) => b.type)).toEqual(["ftyp", "moov"]);
    expect(boxes[1].start).toBe(ftyp.length);
    expect(boxes[1].size).toBe(moov.length);
  });
});

describe("parseAvcCodec", () => {
  it("builds avc1.PPCCLL from an avcC box", () => {
    // avcC payload: version=1, profile=0x4d, compat=0x40, level=0x1f
    const avcc = box("avcC", [0x01, 0x4d, 0x40, 0x1f, 0xff]);
    expect(parseAvcCodec(new Uint8Array(avcc))).toBe("avc1.4d401f");
  });

  it("returns null without an avcC box", () => {
    expect(parseAvcCodec(new Uint8Array(box("mvhd", u32(1))))).toBeNull();
  });
});

describe("parseInitSegment", () => {
  it("returns init length and codecs for video+audio", () => {
    const avcc = box("avcC", [0x01, 0x64, 0x00, 0x28]);
    const stsd = box("stsd", [...box("avc1", avcc), ...box("mp4a", [])]);
    const moov = box("moov", stsd);
    const ftyp = box("ftyp", [...Array.from(enc.encode("isom")), ...u32(0)]);
    const bytes = new Uint8Array([...ftyp, ...moov, 0xaa, 0xbb]); // trailing media

    const parsed = parseInitSegment(bytes);
    expect(parsed).not.toBeNull();
    expect(parsed!.initLength).toBe(ftyp.length + moov.length);
    expect(parsed!.codecs).toBe("avc1.640028,mp4a.40.2");
    expect(parsed!.hasVideo).toBe(true);
    expect(parsed!.hasAudio).toBe(true);
  });

  it("omits audio when no mp4a box is present", () => {
    const avcc = box("avcC", [0x01, 0x42, 0xc0, 0x1e]);
    const moov = box("moov", box("stsd", box("avc1", avcc)));
    const ftyp = box("ftyp", u32(0));
    const parsed = parseInitSegment(new Uint8Array([...ftyp, ...moov]));
    expect(parsed!.codecs).toBe("avc1.42c01e");
    expect(parsed!.hasAudio).toBe(false);
  });

  it("returns null when moov is truncated", () => {
    const ftyp = box("ftyp", u32(0));
    // Declare a moov larger than the bytes provided.
    const truncatedMoov = [
      ...u32(999),
      ...Array.from(enc.encode("moov")),
      0x00,
    ];
    expect(
      parseInitSegment(new Uint8Array([...ftyp, ...truncatedMoov])),
    ).toBeNull();
  });
});

describe("findMoofOffset", () => {
  it("finds a validated moof box start (size field), not the ascii marker", () => {
    const prefix = [0x00, 0x11, 0x22, 0x33];
    const moof = box("moof", box("mfhd", [0, 0, 0, 1]));
    const mdat = box("mdat", [0xde, 0xad, 0xbe, 0xef]);
    const bytes = new Uint8Array([...prefix, ...moof, ...mdat]);
    expect(findMoofOffset(bytes)).toBe(prefix.length);
  });

  it("ignores a spurious 'moof' inside mdat payload", () => {
    // "moof" appears as raw bytes inside media data — must not be treated as a
    // box boundary (no mfhd child follows).
    const mdat = box("mdat", [...Array.from(enc.encode("moof")), 1, 2, 3, 4]);
    expect(findMoofOffset(new Uint8Array(mdat))).toBe(-1);
  });

  it("returns -1 when no moof is present", () => {
    expect(findMoofOffset(new Uint8Array(box("mdat", [1, 2, 3])))).toBe(-1);
  });
});

/** A `trak` with the version-0 layout Clips recordings use. */
function trak(trackId: number, timescale: number, kind: string): number[] {
  const tkhd = box("tkhd", [
    ...u32(0), // version 0 + flags
    ...u32(0), // creation time
    ...u32(0), // modification time
    ...u32(trackId),
  ]);
  const mdhd = box("mdhd", [
    ...u32(0), // version 0 + flags
    ...u32(0), // creation time
    ...u32(0), // modification time
    ...u32(timescale),
    ...u32(0), // duration
  ]);
  const hdlr = box("hdlr", [
    ...u32(0), // version + flags
    ...u32(0), // pre_defined
    ...Array.from(enc.encode(kind)),
  ]);
  return box("trak", [...tkhd, ...box("mdia", [...mdhd, ...hdlr])]);
}

function tfdtBox(base: number, version: 0 | 1): number[] {
  if (version === 1) {
    return box("tfdt", [
      1,
      0,
      0,
      0,
      ...u32(Math.floor(base / 4294967296)),
      ...u32(base >>> 0),
    ]);
  }
  return box("tfdt", [...u32(0), ...u32(base)]);
}

/** A `moof` with an `mfhd` and one `traf` per (trackId, decode time) pair. */
function moof(
  trafs: { trackId: number; base: number; version?: 0 | 1 }[],
): number[] {
  const mfhd = box("mfhd", [...u32(0), ...u32(1)]);
  const body = trafs.flatMap((t) =>
    box("traf", [
      ...box("tfhd", [...u32(0), ...u32(t.trackId)]),
      ...tfdtBox(t.base, t.version ?? 0),
    ]),
  );
  return box("moof", [...mfhd, ...body]);
}

describe("parseTracks", () => {
  it("reads the id, timescale, and handler of every track", () => {
    const moov = box("moov", [
      ...trak(1, 600, "vide"),
      ...trak(2, 48000, "soun"),
    ]);
    expect(parseTracks(new Uint8Array(moov))).toEqual([
      { trackId: 1, timescale: 600, kind: "vide" },
      { trackId: 2, timescale: 48000, kind: "soun" },
    ]);
  });

  it("reads version-1 tkhd and mdhd layouts", () => {
    const tkhd = box("tkhd", [
      1,
      0,
      0,
      0, // version 1 + flags
      ...u32(0),
      ...u32(0), // 64-bit creation time
      ...u32(0),
      ...u32(0), // 64-bit modification time
      ...u32(7),
    ]);
    const mdhd = box("mdhd", [
      1,
      0,
      0,
      0,
      ...u32(0),
      ...u32(0),
      ...u32(0),
      ...u32(0),
      ...u32(90000),
    ]);
    const moov = box("moov", box("trak", [...tkhd, ...box("mdia", mdhd)]));
    expect(parseTracks(new Uint8Array(moov))).toEqual([
      { trackId: 7, timescale: 90000, kind: "" },
    ]);
  });

  it("skips a track with no readable timescale", () => {
    const moov = box(
      "moov",
      box("trak", box("tkhd", [...u32(0), ...u32(0), ...u32(0), ...u32(1)])),
    );
    expect(parseTracks(new Uint8Array(moov))).toEqual([]);
  });
});

describe("readFragmentDecodeTime", () => {
  it("reads the first traf's track id and decode time", () => {
    const bytes = new Uint8Array(moof([{ trackId: 1, base: 180_000 }]));
    expect(readFragmentDecodeTime(bytes, 0)).toEqual({
      trackId: 1,
      baseMediaDecodeTime: 180_000,
    });
  });

  it("reads a 64-bit version-1 tfdt", () => {
    const base = 4294967296 + 12345;
    const bytes = new Uint8Array(moof([{ trackId: 2, base, version: 1 }]));
    expect(readFragmentDecodeTime(bytes, 0)).toEqual({
      trackId: 2,
      baseMediaDecodeTime: base,
    });
  });

  it("returns null for a truncated moof", () => {
    const full = moof([{ trackId: 1, base: 600 }]);
    expect(
      readFragmentDecodeTime(new Uint8Array(full.slice(0, 12)), 0),
    ).toBeNull();
  });
});

describe("fragmentPtsSeconds", () => {
  const tracks = [
    { trackId: 1, timescale: 600, kind: "vide" },
    { trackId: 2, timescale: 48000, kind: "soun" },
  ];

  it("converts a decode time using that track's own timescale", () => {
    const video = new Uint8Array(moof([{ trackId: 1, base: 180_000 }]));
    expect(fragmentPtsSeconds(video, 0, tracks)).toBe(300);
  });

  it("does not fall back to another track's timescale", () => {
    // A fragment for a track absent from the init segment: answering with the
    // wrong timescale would be off by 80x here and send a seek nowhere near
    // its target, so it must report "unknown" instead.
    const orphan = new Uint8Array(moof([{ trackId: 9, base: 180_000 }]));
    expect(fragmentPtsSeconds(orphan, 0, tracks)).toBeNull();
  });

  it("reads a moof at a non-zero offset in a larger buffer", () => {
    const prefix = [0xaa, 0xbb, 0xcc, 0xdd];
    const bytes = new Uint8Array([
      ...prefix,
      ...moof([{ trackId: 2, base: 96_000 }]),
    ]);
    expect(fragmentPtsSeconds(bytes, prefix.length, tracks)).toBe(2);
  });
});
