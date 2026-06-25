import { describe, expect, it } from "vitest";

import {
  MAX_FIG_THUMBNAIL_BYTES,
  figThumbnailDataUrl,
  looksLikeFigFile,
} from "./index.js";

describe("looksLikeFigFile", () => {
  it("accepts modern fig-kiwi local copies", () => {
    expect(looksLikeFigFile(Buffer.from("fig-kiwi\0\0\0\0"))).toBe(true);
  });

  it("accepts legacy zip-format local copies", () => {
    expect(looksLikeFigFile(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
  });

  it("rejects unsupported zip-like prefixes", () => {
    expect(looksLikeFigFile(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(false);
  });

  it("rejects unrelated binary data", () => {
    expect(looksLikeFigFile(Buffer.from("%PDF-1.7"))).toBe(false);
  });
});

describe("figThumbnailDataUrl", () => {
  it("returns small thumbnails as data URLs", () => {
    expect(figThumbnailDataUrl(Buffer.from("png"))).toBe(
      "data:image/png;base64,cG5n",
    );
  });

  it("drops oversized thumbnails", () => {
    expect(
      figThumbnailDataUrl(Buffer.alloc(MAX_FIG_THUMBNAIL_BYTES + 1)),
    ).toBeNull();
  });
});
