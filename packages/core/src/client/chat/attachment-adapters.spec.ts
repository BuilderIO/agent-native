import { describe, expect, it } from "vitest";
import {
  BinaryDocumentAttachmentAdapter,
  isTextLikeFile,
} from "./attachment-adapters.js";

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
      '"large.pdf" is 4.0 MB — PDFs are capped at 4 MB',
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
});
