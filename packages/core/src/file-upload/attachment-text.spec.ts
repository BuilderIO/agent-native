import { describe, expect, it } from "vitest";

import { decodeTextAttachmentData } from "./attachment-text.js";

function markdownDataUrl(text: string): string {
  return `data:text/markdown;base64,${Buffer.from(text).toString("base64")}`;
}

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
