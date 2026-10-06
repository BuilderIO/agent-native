import { describe, expect, it } from "vitest";

import {
  describeAttachmentBytesVerdict,
  reconcileImageBytes,
  reconcilePdfBytes,
  sniffAttachmentMediaType,
} from "./attachment-bytes.js";
import {
  GIF_BASE64,
  JPEG_BASE64,
  makePngBuffer,
  PDF_BASE64,
  PNG_BASE64,
  WEBP_BASE64,
} from "./test-image-fixtures.js";

describe("sniffAttachmentMediaType", () => {
  it("recognizes every media type a provider decodes inline", () => {
    expect(sniffAttachmentMediaType(PNG_BASE64)).toBe("image/png");
    expect(sniffAttachmentMediaType(JPEG_BASE64)).toBe("image/jpeg");
    expect(sniffAttachmentMediaType(GIF_BASE64)).toBe("image/gif");
    expect(sniffAttachmentMediaType(WEBP_BASE64)).toBe("image/webp");
    expect(sniffAttachmentMediaType(PDF_BASE64)).toBe("application/pdf");
  });

  it("reads only the head, so a large attachment is not decoded to classify it", () => {
    const large = makePngBuffer(200).toString("base64");
    expect(large.length).toBeGreaterThan(100_000);
    expect(sniffAttachmentMediaType(large)).toBe("image/png");
  });

  it("returns null for bytes no provider decodes", () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
      "utf8",
    ).toString("base64");
    const docx = Buffer.from("PK\u0003\u0004binary-office-zip").toString(
      "base64",
    );
    expect(sniffAttachmentMediaType(svg)).toBeNull();
    expect(sniffAttachmentMediaType(docx)).toBeNull();
    expect(sniffAttachmentMediaType("")).toBeNull();
    expect(sniffAttachmentMediaType(undefined)).toBeNull();
  });

  it("does not mistake a non-WebP RIFF container for an image", () => {
    const wav = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from("WAVEfmt ", "ascii"),
    ]).toString("base64");
    expect(sniffAttachmentMediaType(wav)).toBeNull();
  });
});

describe("reconcileImageBytes", () => {
  it("accepts an image whose label matches its bytes", () => {
    expect(
      reconcileImageBytes({ base64: PNG_BASE64, declared: "image/png" }),
    ).toEqual({ kind: "ok", mediaType: "image/png" });
  });

  it("relabels an image to the type its bytes actually are", () => {
    expect(
      reconcileImageBytes({ base64: PNG_BASE64, declared: "image/jpeg" }),
    ).toEqual({ kind: "ok", mediaType: "image/png" });
    expect(
      reconcileImageBytes({ base64: JPEG_BASE64, declared: "image/webp" }),
    ).toEqual({ kind: "ok", mediaType: "image/jpeg" });
  });

  it("rejects bytes that decode to no supported image format", () => {
    const verdict = reconcileImageBytes({
      base64: Buffer.from("not an image at all").toString("base64"),
      declared: "image/png",
    });
    expect(verdict.kind).toBe("undecodable");
  });

  it("rejects an empty payload rather than sending an empty image block", () => {
    expect(reconcileImageBytes({ base64: "", declared: "image/png" })).toEqual({
      kind: "undecodable",
      declared: "image/png",
    });
  });

  it("rejects PDF bytes handed over as an image", () => {
    expect(
      reconcileImageBytes({ base64: PDF_BASE64, declared: "image/png" }),
    ).toEqual({
      kind: "wrong-kind",
      declared: "image/png",
      actual: "application/pdf",
    });
  });

  it("rejects a PNG whose IEND chunk never arrived", () => {
    const full = makePngBuffer(16).toString("base64");
    const cut = full.slice(0, Math.floor(full.length / 2));
    expect(reconcileImageBytes({ base64: cut, declared: "image/png" })).toEqual(
      { kind: "truncated", mediaType: "image/png" },
    );
  });

  it("rejects a GIF missing its trailer", () => {
    const cut = Buffer.from(GIF_BASE64, "base64").subarray(0, 20);
    expect(
      reconcileImageBytes({
        base64: cut.toString("base64"),
        declared: "image/gif",
      }),
    ).toEqual({ kind: "truncated", mediaType: "image/gif" });
  });

  it("does not claim truncation for formats with no fixed terminator", () => {
    const jpegWithTrailingBytes = Buffer.concat([
      Buffer.from(JPEG_BASE64, "base64"),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
    ]).toString("base64");
    expect(
      reconcileImageBytes({
        base64: jpegWithTrailingBytes,
        declared: "image/jpeg",
      }),
    ).toEqual({ kind: "ok", mediaType: "image/jpeg" });
  });
});

describe("payloads that satisfy a magic number but still fail the provider", () => {
  it("rejects a PNG signature wrapped around no image", () => {
    const sigAndEnd = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from("IEND", "ascii"),
      Buffer.from([0xae, 0x42, 0x60, 0x82]),
    ]).toString("base64");
    expect(
      reconcileImageBytes({ base64: sigAndEnd, declared: "image/png" }).kind,
    ).toBe("undecodable");
  });

  it("rejects a JPEG whose end-of-image marker never arrived", () => {
    const noEoi = Buffer.from(JPEG_BASE64, "base64").subarray(0, 20);
    expect(
      reconcileImageBytes({
        base64: noEoi.toString("base64"),
        declared: "image/jpeg",
      }),
    ).toEqual({ kind: "truncated", mediaType: "image/jpeg" });
  });

  it("accepts a JPEG that carries trailing bytes after its marker", () => {
    const trailing = Buffer.concat([
      Buffer.from(JPEG_BASE64, "base64"),
      Buffer.alloc(16),
    ]).toString("base64");
    expect(
      reconcileImageBytes({ base64: trailing, declared: "image/jpeg" }),
    ).toEqual({ kind: "ok", mediaType: "image/jpeg" });
  });

  it("rejects a WebP whose RIFF header promises more bytes than arrived", () => {
    const lying = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([0xff, 0xff, 0x00, 0x00]),
      Buffer.from("WEBPVP8L", "ascii"),
      Buffer.from([1, 2, 3, 4]),
    ]).toString("base64");
    expect(
      reconcileImageBytes({ base64: lying, declared: "image/webp" }),
    ).toEqual({ kind: "truncated", mediaType: "image/webp" });
  });

  it("rejects a WebP declaring a size with the high bit set", () => {
    const highBit = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([0xff, 0xff, 0xff, 0xff]),
      Buffer.from("WEBPVP8L", "ascii"),
      Buffer.from([1, 2, 3, 4]),
    ]).toString("base64");
    expect(
      reconcileImageBytes({ base64: highBit, declared: "image/webp" }),
    ).toEqual({ kind: "truncated", mediaType: "image/webp" });
  });

  it("accepts a WebP whose declared size matches what arrived", () => {
    expect(
      reconcileImageBytes({ base64: WEBP_BASE64, declared: "image/webp" }),
    ).toEqual({ kind: "ok", mediaType: "image/webp" });
  });

  it("rejects a PDF cut off before its trailer", () => {
    const full = Buffer.from(PDF_BASE64, "base64");
    const cut = full.subarray(0, Math.floor(full.length * 0.6));
    expect(
      reconcilePdfBytes({
        base64: cut.toString("base64"),
        declared: "application/pdf",
      }),
    ).toEqual({ kind: "truncated", mediaType: "application/pdf" });
  });
});

describe("non-canonical base64", () => {
  const clean = PNG_BASE64;

  it.each([
    ["an illegal character", `${clean.slice(0, 40)}!${clean.slice(40)}`],
    ["an embedded space", `${clean.slice(0, 40)} ${clean.slice(40)}`],
    ["a line break", `${clean.slice(0, 40)}\n${clean.slice(40)}`],
    ["a length that is not a multiple of four", clean.slice(0, -1)],
  ])("rejects a payload carrying %s", (_label, value) => {
    expect(Buffer.from(value, "base64").length).toBeGreaterThan(0);
    expect(sniffAttachmentMediaType(value)).toBeNull();
    expect(
      reconcileImageBytes({ base64: value, declared: "image/png" }).kind,
    ).toBe("undecodable");
  });

  it("still accepts the canonical form of the same bytes", () => {
    expect(
      reconcileImageBytes({ base64: clean, declared: "image/png" }),
    ).toEqual({ kind: "ok", mediaType: "image/png" });
  });
});

describe("reconcilePdfBytes", () => {
  it("accepts real PDF bytes", () => {
    expect(
      reconcilePdfBytes({ base64: PDF_BASE64, declared: "application/pdf" }),
    ).toEqual({ kind: "ok", mediaType: "application/pdf" });
  });

  it("rejects an office document saved under a .pdf name", () => {
    expect(
      reconcilePdfBytes({
        base64: Buffer.from("PK\u0003\u0004zip-container").toString("base64"),
        declared: "application/pdf",
      }),
    ).toEqual({ kind: "undecodable", declared: "application/pdf" });
  });

  it("rejects image bytes sent as a document", () => {
    expect(
      reconcilePdfBytes({ base64: PNG_BASE64, declared: "application/pdf" }),
    ).toEqual({
      kind: "wrong-kind",
      declared: "application/pdf",
      actual: "image/png",
    });
  });
});

describe("describeAttachmentBytesVerdict", () => {
  it("keeps truncation and format problems distinct", () => {
    expect(
      describeAttachmentBytesVerdict({
        kind: "truncated",
        mediaType: "image/png",
      }),
    ).toContain("incomplete");
    expect(
      describeAttachmentBytesVerdict({
        kind: "wrong-kind",
        declared: "image/jpeg",
        actual: "image/png",
      }),
    ).toContain("image/png");
    expect(
      describeAttachmentBytesVerdict({
        kind: "undecodable",
        declared: "image/png",
      }),
    ).toContain("image/png");
  });
});
