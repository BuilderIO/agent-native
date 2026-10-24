import { describe, expect, it } from "vitest";

import { decodeTextAttachmentData, sliceTextHead } from "./attachment-text.js";

function markdownDataUrl(text: string): string {
  return `data:text/markdown;base64,${Buffer.from(text).toString("base64")}`;
}

describe("sliceTextHead", () => {
  it("keeps a surrogate pair whole at the cut", () => {
    expect(sliceTextHead("ab😀c", 3)).toBe("ab");
    expect(sliceTextHead("ab😀c", 4)).toBe("ab😀");
    expect(sliceTextHead("abc", 0)).toBe("");
  });
});

describe("decodeTextAttachmentData", () => {
  it("decodes a text file near the 8 MB limit without overflowing the stack", () => {
    const text = "x".repeat(7 * 1024 * 1024);

    expect(
      decodeTextAttachmentData({
        name: "DESIGN.md",
        data: markdownDataUrl(text),
      }),
    ).toEqual({ kind: "text", text });
  });

  it("reports a direct data URL over 8 MB as too large without decoding it", () => {
    expect(
      decodeTextAttachmentData({
        name: "huge.md",
        data: `data:text/markdown;base64,${"A".repeat(12_000_000)}`,
      }),
    ).toEqual({
      kind: "undecodable",
      mediaType: "text/markdown",
      reason: "too-large",
    });
  });

  it("unwraps a stored copy that kept this file's own composer envelope", () => {
    const wrapped =
      '<attachment name="notes.md" contentType="text/markdown">\nbody\n</attachment>';
    expect(
      decodeTextAttachmentData({
        name: "notes.md",
        data: markdownDataUrl(wrapped),
      }),
    ).toEqual({ kind: "text", text: "body" });
    expect(
      decodeTextAttachmentData({
        name: "other.md",
        data: markdownDataUrl(wrapped),
      }),
    ).toEqual({ kind: "text", text: wrapped });
  });

  it.each(["aGVs*bG8=", "aGVsbG8", "aG=VsbG8="])(
    "reports %s as corrupt base64",
    (payload) => {
      expect(
        decodeTextAttachmentData({
          name: "notes.md",
          data: `data:text/markdown;base64,${payload}`,
        }),
      ).toEqual({
        kind: "undecodable",
        mediaType: "text/markdown",
        reason: "invalid-base64",
      });
    },
  );
});
