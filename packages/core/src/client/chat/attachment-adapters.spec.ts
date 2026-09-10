import { describe, expect, it } from "vitest";

import {
  BinaryDocumentAttachmentAdapter,
  DownscalingImageAttachmentAdapter,
  estimateAttachmentBodyBytes,
  getAttachmentBodyStrings,
  isTextLikeFile,
  MAX_TEXT_ATTACHMENT_BYTES,
  serializeAttachmentContentPart,
  serializeQueuedAttachments,
} from "./attachment-adapters.js";

describe("DownscalingImageAttachmentAdapter", () => {
  it("preserves the uploaded image MIME type", async () => {
    const adapter = new DownscalingImageAttachmentAdapter();
    const attachment = await adapter.add({
      file: new File(["jpeg"], "photo.jpg", { type: "image/jpeg" }),
    });

    expect(attachment.contentType).toBe("image/jpeg");
  });
});

describe("BinaryDocumentAttachmentAdapter", () => {
  it("accepts SVGs as document attachments in the main chat UI", () => {
    const adapter = new BinaryDocumentAttachmentAdapter();

    expect(adapter.accept.split(",")).toContain("image/svg+xml");
    expect(adapter.accept.split(",")).toContain(".svg");
  });

  it("rejects oversized PDFs when they are added", async () => {
    const adapter = new BinaryDocumentAttachmentAdapter();
    const file = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "large.pdf", {
      type: "application/pdf",
    });

    await expect(adapter.add({ file })).rejects.toThrow(
      '"large.pdf" is 4.0 MB - documents are capped at 4 MB to stay within message limits. Please reduce the file size or split it into smaller parts.',
    );
  });
});

describe("isTextLikeFile", () => {
  it("does not route SVGs through the inline text attachment adapter", () => {
    expect(
      isTextLikeFile(
        new File(["<svg />"], "logo.svg", { type: "image/svg+xml" }),
      ),
    ).toBe(false);
  });

  it("routes EML exports through the inline text attachment path", () => {
    expect(
      isTextLikeFile(
        new File(["From: sender@example.com\n\nHello"], "message.eml", {
          type: "message/rfc822",
        }),
      ),
    ).toBe(true);
  });

  it("rejects oversized readable files before reading their contents", async () => {
    const file = new File(
      [new Uint8Array(MAX_TEXT_ATTACHMENT_BYTES + 1)],
      "large.eml",
      { type: "message/rfc822" },
    );

    await expect(
      serializeQueuedAttachments([{ name: file.name, file }]),
    ).rejects.toThrow(
      '"large.eml" is 3.5 MB - text attachments are capped at 3.5 MB to stay within message limits. Please reduce the file size or split it into smaller parts.',
    );
  });
});

describe("attachment body size estimation", () => {
  it("counts text and inline file payloads alongside images", () => {
    const attachments = [
      {
        type: "file",
        name: "message.eml",
        content: [{ type: "text", text: "mail body" }],
      },
      {
        type: "file",
        name: "report.pdf",
        content: [{ type: "file", data: "data:application/pdf;base64,abc" }],
      },
    ] as any;

    expect(getAttachmentBodyStrings(attachments)).toEqual([
      "mail body",
      "data:application/pdf;base64,abc",
    ]);
    expect(estimateAttachmentBodyBytes(["é"])).toBeCloseTo(2.3);
  });
});

describe("serializeAttachmentContentPart", () => {
  it("keeps hosted file URLs when a persisted thread is re-queued", () => {
    expect(
      serializeAttachmentContentPart({
        type: "file",
        url: "https://cdn.example.com/report.pdf",
        mimeType: "application/pdf",
        filename: "report.pdf",
      }),
    ).toEqual({
      type: "file",
      url: "https://cdn.example.com/report.pdf",
      mimeType: "application/pdf",
      filename: "report.pdf",
    });
  });
});

describe("serializeQueuedAttachments", () => {
  it("keeps display-only file descriptors without reading file bytes", async () => {
    await expect(
      serializeQueuedAttachments([
        {
          type: "file",
          name: "reference.pdf",
          contentType: "application/pdf",
          displayOnly: true,
        },
        {
          type: "file",
          name: "pasted-text-1.txt",
          contentType: "text/plain",
          displayOnly: true,
          text: "pasted outline",
        },
      ]),
    ).resolves.toEqual([
      expect.objectContaining({
        name: "reference.pdf",
        content: [],
        metadata: { displayOnly: true },
      }),
      expect.objectContaining({
        name: "pasted-text-1.txt",
        content: [{ type: "text", text: "pasted outline" }],
        metadata: { displayOnly: true },
      }),
    ]);
  });

  it("serializes EML exports as text instead of an unsupported binary file", async () => {
    await expect(
      serializeQueuedAttachments([
        {
          id: "message.eml",
          type: "document",
          name: "message.eml",
          contentType: "message/rfc822",
          file: new File(["From: sender@example.com\n\nHello"], "message.eml", {
            type: "message/rfc822",
          }),
        },
      ]),
    ).resolves.toEqual([
      expect.objectContaining({
        name: "message.eml",
        type: "file",
        contentType: "message/rfc822",
        content: [
          {
            type: "text",
            text: expect.stringContaining("Hello"),
          },
        ],
      }),
    ]);
  });
});
