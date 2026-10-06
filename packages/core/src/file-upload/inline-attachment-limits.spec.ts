import { describe, expect, it } from "vitest";

import {
  classifyInlineAttachment,
  describeInlineBlockReason,
  formatBase64CharBudget,
  isInlineVisionMediaType,
  MAX_INLINE_FILE_BASE64_CHARS,
  MAX_INLINE_IMAGE_BASE64_CHARS,
} from "./inline-attachment-limits.js";

function imageAtt(base64Chars: number, contentType = "image/jpeg") {
  return {
    type: "image",
    contentType,
    data: `data:${contentType};base64,${"A".repeat(base64Chars)}`,
  };
}

describe("inline attachment limits", () => {
  it("keeps the image ceiling well above the file ceiling", () => {
    expect(MAX_INLINE_IMAGE_BASE64_CHARS).toBeGreaterThan(
      MAX_INLINE_FILE_BASE64_CHARS,
    );
  });

  it("stays under the strictest provider image ceiling", () => {
    expect(MAX_INLINE_IMAGE_BASE64_CHARS).toBeLessThanOrEqual(5_242_880);
  });

  it("reports the decoded budget so model-visible copy can quote a number", () => {
    expect(formatBase64CharBudget(MAX_INLINE_IMAGE_BASE64_CHARS)).toBe(
      "3.6 MB",
    );
  });

  it("accepts only media types every vision provider takes inline", () => {
    expect(isInlineVisionMediaType("image/png")).toBe(true);
    expect(isInlineVisionMediaType("image/jpeg; charset=binary")).toBe(true);
    expect(isInlineVisionMediaType("image/heic")).toBe(false);
    expect(isInlineVisionMediaType(undefined)).toBe(false);
  });
});

describe("classifyInlineAttachment", () => {
  it("treats a multi-megabyte photo as readable", () => {
    expect(classifyInlineAttachment(imageAtt(2_500_000))).toBeNull();
  });

  it("flags an image past the image ceiling with the real numbers", () => {
    expect(
      classifyInlineAttachment(imageAtt(MAX_INLINE_IMAGE_BASE64_CHARS + 1)),
    ).toEqual({
      kind: "over-inline-limit",
      maxChars: MAX_INLINE_IMAGE_BASE64_CHARS,
      actualChars: MAX_INLINE_IMAGE_BASE64_CHARS + 1,
    });
  });

  it("flags an image format no vision provider decodes", () => {
    expect(classifyInlineAttachment(imageAtt(100, "image/heic"))).toEqual({
      kind: "unsupported-image-format",
      mediaType: "image/heic",
    });
  });

  it("does not call a generic binary readable just because it is small", () => {
    expect(
      classifyInlineAttachment({
        type: "file",
        name: "notes.docx",
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        data: "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,UEsDBA==",
      }),
    ).toMatchObject({ kind: "unsupported-file-format" });
  });

  it("keeps PDFs, text, and spreadsheets readable", () => {
    expect(
      classifyInlineAttachment({
        type: "file",
        name: "report.pdf",
        contentType: "application/pdf",
        data: "data:application/pdf;base64,JVBERi0x",
      }),
    ).toBeNull();
    expect(
      classifyInlineAttachment({
        type: "file",
        name: "budget.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        data: "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,UEsDBA==",
      }),
    ).toBeNull();
  });

  it("describes each block reason without implying storage would fix it", () => {
    expect(
      describeInlineBlockReason({
        kind: "over-inline-limit",
        maxChars: MAX_INLINE_IMAGE_BASE64_CHARS,
        actualChars: 9_000_000,
      }),
    ).toBe("over the 3.6 MB inline limit");
    expect(
      describeInlineBlockReason({
        kind: "unsupported-image-format",
        mediaType: "image/heic",
      }),
    ).toContain("image/heic");
  });

  it("holds files to the stricter file_url ceiling", () => {
    const under = {
      type: "file",
      contentType: "application/pdf",
      data: `data:application/pdf;base64,${"A".repeat(MAX_INLINE_FILE_BASE64_CHARS)}`,
    };
    expect(classifyInlineAttachment(under)).toBeNull();

    const over = {
      type: "file",
      contentType: "application/pdf",
      data: `data:application/pdf;base64,${"A".repeat(MAX_INLINE_FILE_BASE64_CHARS + 1)}`,
    };
    expect(classifyInlineAttachment(over)).toMatchObject({
      kind: "over-inline-limit",
      maxChars: MAX_INLINE_FILE_BASE64_CHARS,
    });
  });

  it("counts already-decoded text attachments as readable", () => {
    expect(
      classifyInlineAttachment({ type: "file", text: "hello" }),
    ).toBeNull();
  });

  it("reports missing bytes as no-data rather than a size problem", () => {
    expect(classifyInlineAttachment({ type: "image" })).toEqual({
      kind: "no-data",
    });
    expect(
      classifyInlineAttachment({ type: "file", referenceOnly: true }),
    ).toEqual({ kind: "no-data" });
  });
});
