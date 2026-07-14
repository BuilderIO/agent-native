import { describe, expect, it } from "vitest";

import {
  findMoofOffset,
  indexOfAscii,
  isFragmentedMp4Head,
  parseAvcCodec,
  parseInitSegment,
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
