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
          referenceUrl: "C".repeat(128),
        },
      }),
    ).toEqual({
      type: "image",
      metadata: { url: "https://files.example.test/reference.png" },
    });
  });

  it("preserves ordinary text and structured values in attachment fields", () => {
    const attachment = {
      name: "reference.txt",
      body: "Show the quarterly campaign summary.",
      data: { caption: "Use this copy", metadata: { source: "notes" } },
      payload: { kind: "text", content: "A short draft" },
    };

    expect(
      stripInlineAttachmentPayloads({ attachments: [attachment] }),
    ).toEqual({ attachments: [attachment] });
  });

  it("removes only actual inline payloads from attachment body fields", () => {
    expect(
      stripInlineAttachmentPayloads({
        attachments: [
          {
            name: "reference.png",
            body: "data:image/png;base64,INLINE_IMAGE_BYTES",
            data: "A".repeat(128),
            payload: new Uint8Array([1, 2, 3]),
          },
        ],
      }),
    ).toEqual({ attachments: [{ name: "reference.png" }] });
  });
});
