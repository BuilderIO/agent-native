import { describe, expect, it } from "vitest";

import {
  CHAT_DOCUMENT_ATTACHMENT_ACCEPT,
  formatAttachmentError,
  MAX_TEXT_ATTACHMENT_BYTES,
  PROMPT_DOCUMENT_ATTACHMENT_ACCEPT,
  TextAttachmentAdapter,
  TEXT_ATTACHMENT_ACCEPT,
} from "./attachment-accept.js";

describe("attachment accept lists", () => {
  it("keeps SVGs out of standalone prompt composer document uploads", () => {
    const accept = PROMPT_DOCUMENT_ATTACHMENT_ACCEPT.split(",");

    expect(accept).not.toContain("image/svg+xml");
    expect(accept).not.toContain(".svg");
  });

  it("allows SVGs in the main chat document upload path", () => {
    const accept = CHAT_DOCUMENT_ATTACHMENT_ACCEPT.split(",");

    expect(accept).toContain("image/svg+xml");
    expect(accept).toContain(".svg");
  });

  it("allows Excel workbooks in both composer paths", () => {
    for (const accept of [
      PROMPT_DOCUMENT_ATTACHMENT_ACCEPT,
      CHAT_DOCUMENT_ATTACHMENT_ACCEPT,
    ]) {
      expect(accept.split(",")).toContain(".xlsx");
      expect(accept.split(",")).toContain(".xls");
    }
  });

  it("accepts email exports as readable text attachments", () => {
    const accept = TEXT_ATTACHMENT_ACCEPT.split(",");

    expect(accept).toContain("message/rfc822");
    expect(accept).toContain(".eml");
  });

  it("hides assistant-ui rejection details behind the composer fallback", () => {
    const fallback = "Could not attach that file.";

    expect(
      formatAttachmentError(
        new Error("No matching adapter found for file"),
        fallback,
      ),
    ).toBe(fallback);
    expect(
      formatAttachmentError(
        new Error(
          "File type message/rfc822 is not accepted. Accepted types: image/*,application/pdf",
        ),
        fallback,
      ),
    ).toBe(fallback);
    expect(formatAttachmentError(new Error("Reader failed"), fallback)).toBe(
      "Reader failed",
    );
  });

  it("rejects oversized text files before reading them", async () => {
    const file = new File(
      [new Uint8Array(MAX_TEXT_ATTACHMENT_BYTES + 1)],
      "large.eml",
      { type: "message/rfc822" },
    );

    await expect(new TextAttachmentAdapter().add({ file })).rejects.toThrow(
      '"large.eml" is 3.0 MB - text attachments are capped at 3.0 MB to stay within message limits. Please reduce the file size or split it into smaller parts.',
    );
  });
});
