import { describe, expect, it } from "vitest";

import { stripInlineAttachmentPayloads } from "./attachments.js";

describe("stripInlineAttachmentPayloads", () => {
  it("removes attachment bytes without rewriting pasted data text", () => {
    const pastedSseLine = 'data: {"message":"hello"}';
    const inlineImageUrl = "data:image/png;base64,INLINE_IMAGE_BYTES";
    const snapshot = {
      parts: [
        { type: "text", text: pastedSseLine },
        {
          type: "image",
          name: "reference.png",
          data: inlineImageUrl,
          url: inlineImageUrl,
          referenceUrl: "https://files.example.test/reference.png",
        },
      ],
      note: pastedSseLine,
    };

    expect(stripInlineAttachmentPayloads(snapshot)).toEqual({
      parts: [
        { type: "text", text: pastedSseLine },
        {
          type: "image",
          name: "reference.png",
          referenceUrl: "https://files.example.test/reference.png",
        },
      ],
      note: pastedSseLine,
    });
  });

  it("removes nested image bytes and byte arrays from attachment metadata", () => {
    expect(
      stripInlineAttachmentPayloads({
        type: "image",
        metadata: {
          base64: "A".repeat(128),
          bytes: [1, 2, 3],
          preview: "data:image/png;base64,INLINE_PREVIEW",
          thumbnail: "B".repeat(128),
          url: "https://files.example.test/reference.png",
        },
      }),
    ).toEqual({
      type: "image",
      metadata: { url: "https://files.example.test/reference.png" },
    });
  });
});
