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
