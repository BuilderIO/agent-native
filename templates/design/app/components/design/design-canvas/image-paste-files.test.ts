import { describe, expect, it } from "vitest";

import {
  filterPastedMediaFiles,
  hasSkippedImagePaste,
  MAX_IMAGE_PASTE_DATA_URL_CHARS,
  MAX_IMAGE_PASTE_FILE_MB,
  MAX_IMAGE_PASTE_FILES,
} from "./image-paste-files";

const PNG_PREFIX = "data:image/png;base64,";
const MIB = 1024 * 1024;

function pngFile(name: string, payload = "AAAA") {
  return { dataUrl: `${PNG_PREFIX}${payload}`, type: "image/png", name };
}

function pngFiles(count: number) {
  return Array.from({ length: count }, (_, index) => pngFile(`${index}.png`));
}

function oversizeFile(name: string) {
  return pngFile(
    name,
    "A".repeat(MAX_IMAGE_PASTE_DATA_URL_CHARS - PNG_PREFIX.length + 1),
  );
}

describe("filterPastedMediaFiles", () => {
  it("keeps nothing and skips nothing for an empty paste", () => {
    const result = filterPastedMediaFiles([]);
    expect(result.files).toEqual([]);
    expect(result.skipped).toEqual({ tooMany: 0, tooLarge: 0, invalid: 0 });
    expect(hasSkippedImagePaste(result.skipped)).toBe(false);
  });

  it("treats a message without a file list as an empty paste", () => {
    const result = filterPastedMediaFiles(undefined);
    expect(result.files).toEqual([]);
    expect(hasSkippedImagePaste(result.skipped)).toBe(false);
  });

  it("keeps all 20 files when exactly at the cap", () => {
    const input = pngFiles(MAX_IMAGE_PASTE_FILES);
    const result = filterPastedMediaFiles(input);
    expect(result.files).toEqual(input);
    expect(hasSkippedImagePaste(result.skipped)).toBe(false);
  });

  it("keeps the first 20 in order and counts the rest as too many", () => {
    const input = pngFiles(MAX_IMAGE_PASTE_FILES + 1);
    const result = filterPastedMediaFiles(input);
    expect(result.files.map((file) => file.name)).toEqual(
      input.slice(0, MAX_IMAGE_PASTE_FILES).map((file) => file.name),
    );
    expect(result.skipped).toEqual({ tooMany: 1, tooLarge: 0, invalid: 0 });
    expect(hasSkippedImagePaste(result.skipped)).toBe(true);
  });

  it("counts files past the cap as too many even when they are also oversize", () => {
    const input = [
      ...pngFiles(MAX_IMAGE_PASTE_FILES),
      oversizeFile("a.png"),
      oversizeFile("b.png"),
    ];
    const result = filterPastedMediaFiles(input);
    expect(result.files).toHaveLength(MAX_IMAGE_PASTE_FILES);
    expect(result.skipped).toEqual({ tooMany: 2, tooLarge: 0, invalid: 0 });
  });

  it("drops one oversize file and keeps the valid ones around it", () => {
    const result = filterPastedMediaFiles([
      pngFile("first.png"),
      oversizeFile("huge.png"),
      pngFile("last.png"),
    ]);
    expect(result.files.map((file) => file.name)).toEqual([
      "first.png",
      "last.png",
    ]);
    expect(result.skipped).toEqual({ tooMany: 0, tooLarge: 1, invalid: 0 });
  });

  it("keeps a data URL exactly at the limit and drops one character more", () => {
    const atLimit = pngFile(
      "at-limit.png",
      "A".repeat(MAX_IMAGE_PASTE_DATA_URL_CHARS - PNG_PREFIX.length),
    );
    const result = filterPastedMediaFiles([atLimit, oversizeFile("over.png")]);
    expect(result.files).toEqual([atLimit]);
    expect(result.skipped.tooLarge).toBe(1);
  });

  it("derives the displayed size limit from what real files do", () => {
    const underLimit = pngFile(
      "under.png",
      Buffer.alloc((MAX_IMAGE_PASTE_FILE_MB - 1) * MIB).toString("base64"),
    );
    const overLimit = pngFile(
      "over.png",
      Buffer.alloc((MAX_IMAGE_PASTE_FILE_MB + 1) * MIB).toString("base64"),
    );
    const result = filterPastedMediaFiles([underLimit, overLimit]);
    expect(result.files).toEqual([underLimit]);
    expect(result.skipped.tooLarge).toBe(1);
  });

  it("accepts video data URLs", () => {
    const video = {
      dataUrl: "data:video/mp4;base64,AAAA",
      type: "video/mp4",
      name: "clip.mp4",
    };
    const result = filterPastedMediaFiles([video]);
    expect(result.files).toEqual([video]);
    expect(hasSkippedImagePaste(result.skipped)).toBe(false);
  });

  it("counts entries that are not image or video data URLs as invalid", () => {
    const result = filterPastedMediaFiles([
      pngFile("ok.png"),
      { dataUrl: "data:text/html;base64,AAAA", type: "text/html", name: "x" },
      { dataUrl: "https://example.com/a.png", type: "image/png", name: "y" },
      { dataUrl: 42, type: "image/png", name: "z" },
      { type: "image/png", name: "no-data-url" },
      null,
      "data:image/png;base64,AAAA",
    ]);
    expect(result.files.map((file) => file.name)).toEqual(["ok.png"]);
    expect(result.skipped).toEqual({ tooMany: 0, tooLarge: 0, invalid: 6 });
  });

  it("reports every file when all of them are dropped", () => {
    const result = filterPastedMediaFiles([
      oversizeFile("big.png"),
      { dataUrl: "data:application/pdf;base64,AAAA", type: "x", name: "p" },
    ]);
    expect(result.files).toEqual([]);
    expect(result.skipped).toEqual({ tooMany: 0, tooLarge: 1, invalid: 1 });
    expect(hasSkippedImagePaste(result.skipped)).toBe(true);
  });
});
