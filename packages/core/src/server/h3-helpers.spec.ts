import { describe, expect, it } from "vitest";

import {
  isAllowedUploadMimeType,
  DEFAULT_CHAT_MAX_BODY_BYTES,
  DEFAULT_UPLOAD_MAX_FILE_BYTES,
  MAX_CHAT_ATTACHMENTS_PER_MESSAGE,
} from "./h3-helpers.js";

describe("isAllowedUploadMimeType", () => {
  it("allows common image types", () => {
    expect(isAllowedUploadMimeType("image/jpeg")).toBe(true);
    expect(isAllowedUploadMimeType("image/png")).toBe(true);
    expect(isAllowedUploadMimeType("image/gif")).toBe(true);
    expect(isAllowedUploadMimeType("image/webp")).toBe(true);
    expect(isAllowedUploadMimeType("image/heic")).toBe(true);
  });

  it("allows document types", () => {
    expect(isAllowedUploadMimeType("application/pdf")).toBe(true);
    expect(isAllowedUploadMimeType("application/json")).toBe(true);
    expect(isAllowedUploadMimeType("text/plain")).toBe(true);
    expect(isAllowedUploadMimeType("text/csv")).toBe(true);
  });

  it("allows archive types", () => {
    expect(isAllowedUploadMimeType("application/zip")).toBe(true);
    expect(isAllowedUploadMimeType("application/gzip")).toBe(true);
  });

  it("rejects executable types", () => {
    expect(isAllowedUploadMimeType("application/x-msdownload")).toBe(false);
    expect(isAllowedUploadMimeType("application/x-executable")).toBe(false);
    expect(isAllowedUploadMimeType("application/x-sh")).toBe(false);
    expect(isAllowedUploadMimeType("application/x-bat")).toBe(false);
    expect(isAllowedUploadMimeType("application/x-msdos-program")).toBe(false);
  });

  it("rejects unrecognized mime types not in any allow prefix", () => {
    expect(isAllowedUploadMimeType("application/x-custom-something")).toBe(
      false,
    );
  });

  it("is case-insensitive", () => {
    expect(isAllowedUploadMimeType("IMAGE/JPEG")).toBe(true);
    expect(isAllowedUploadMimeType("Application/PDF")).toBe(true);
  });

  it("strips charset parameters before matching", () => {
    expect(isAllowedUploadMimeType("text/plain; charset=utf-8")).toBe(true);
  });
});

describe("size constants", () => {
  it("default chat body limit is 25 MB", () => {
    expect(DEFAULT_CHAT_MAX_BODY_BYTES).toBe(25 * 1024 * 1024);
  });

  it("default upload file limit is 25 MB", () => {
    expect(DEFAULT_UPLOAD_MAX_FILE_BYTES).toBe(25 * 1024 * 1024);
  });

  it("max chat attachments per message is a positive integer", () => {
    expect(MAX_CHAT_ATTACHMENTS_PER_MESSAGE).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_CHAT_ATTACHMENTS_PER_MESSAGE)).toBe(true);
  });
});
