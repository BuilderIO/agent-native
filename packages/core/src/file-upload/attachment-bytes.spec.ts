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

// Every rejection below was measured against the live Builder gateway: each one
// returns `reason: invalid_request` with the opaque
// "Sorry, this was caused by an internal error. ERROR ID: ..." envelope, and
// takes the entire turn down, not just the one attachment.
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

  // A browser sets File.type from the extension, so a screenshot saved as .jpg
  // that holds PNG bytes is ordinary user data. Sending the declared label
  // killed the whole request; relabelling makes the image work.
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

  // Truncation is only claimed for formats with a fixed, spec-mandated
  // terminator. Guessing at JPEG or WebP would demote valid images carrying
  // trailing metadata, and losing a good image is worse than the rejection.
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
