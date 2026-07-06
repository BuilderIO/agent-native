import { describe, it, expect } from "vitest";

import {
  AGENT_IMAGES_FIELD,
  MAX_TOOL_RESULT_IMAGES,
  MAX_TOOL_RESULT_IMAGE_BASE64_CHARS,
  describeToolResultImages,
  extractAgentImagesFromActionResult,
  normalizeToolResultImages,
} from "./tool-result-images.js";

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUg=="; // small, valid-looking base64

describe("normalizeToolResultImages", () => {
  it("accepts https url images", () => {
    const { images, notes } = normalizeToolResultImages([
      { url: "https://cdn.example.com/shot.png", label: "dashboard" },
    ]);
    expect(images).toEqual([
      { url: "https://cdn.example.com/shot.png", label: "dashboard" },
    ]);
    expect(notes).toEqual([]);
  });

  it("rejects non-https urls with a note", () => {
    const { images, notes } = normalizeToolResultImages([
      { url: "http://cdn.example.com/shot.png" },
      { url: "ftp://x/y.png" },
    ]);
    expect(images).toEqual([]);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain("https://");
  });

  it("accepts base64 data with a supported mediaType", () => {
    const { images, notes } = normalizeToolResultImages([
      { data: PNG_B64, mediaType: "image/png" },
    ]);
    expect(images).toEqual([{ data: PNG_B64, mediaType: "image/png" }]);
    expect(notes).toEqual([]);
  });

  it("parses a full data URL into data + mediaType", () => {
    const { images } = normalizeToolResultImages([
      { data: `data:image/webp;base64,${PNG_B64}` },
    ]);
    expect(images).toEqual([{ data: PNG_B64, mediaType: "image/webp" }]);
  });

  it("rejects unsupported media types with a note", () => {
    const { images, notes } = normalizeToolResultImages([
      { data: PNG_B64, mediaType: "image/tiff" },
      { data: PNG_B64 },
    ]);
    expect(images).toEqual([]);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain("image/tiff");
    expect(notes[1]).toContain("(missing)");
  });

  it("replaces oversize base64 payloads with a size note", () => {
    const big = "A".repeat(MAX_TOOL_RESULT_IMAGE_BASE64_CHARS + 1);
    const { images, notes } = normalizeToolResultImages([
      { data: big, mediaType: "image/png", label: "huge" },
    ]);
    expect(images).toEqual([]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('"huge"');
    expect(notes[0]).toContain("exceeds");
  });

  it("caps the number of images per result", () => {
    const entries = Array.from({ length: MAX_TOOL_RESULT_IMAGES + 2 }, () => ({
      url: "https://cdn.example.com/a.png",
    }));
    const { images, notes } = normalizeToolResultImages(entries);
    expect(images).toHaveLength(MAX_TOOL_RESULT_IMAGES);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain(`max ${MAX_TOOL_RESULT_IMAGES}`);
  });

  it("ignores non-array input and non-object entries", () => {
    expect(normalizeToolResultImages("nope")).toEqual({
      images: [],
      notes: [],
    });
    expect(normalizeToolResultImages([null, 42, "x"])).toEqual({
      images: [],
      notes: [],
    });
  });

  it("rejects data that is not base64", () => {
    const { images, notes } = normalizeToolResultImages([
      { data: "!!not-base64!!", mediaType: "image/png" },
    ]);
    expect(images).toEqual([]);
    expect(notes[0]).toContain("not valid base64");
  });
});

describe("extractAgentImagesFromActionResult", () => {
  it("strips _agentImages from the result object and normalizes it", () => {
    const result = {
      ok: true,
      chartUrl: "https://app.example.com/c/1",
      [AGENT_IMAGES_FIELD]: [
        { url: "https://cdn.example.com/chart.png", label: "revenue chart" },
      ],
    };
    const extracted = extractAgentImagesFromActionResult(result);
    expect(extracted.value).toEqual({
      ok: true,
      chartUrl: "https://app.example.com/c/1",
    });
    expect(extracted.images).toEqual([
      { url: "https://cdn.example.com/chart.png", label: "revenue chart" },
    ]);
    expect(extracted.notes).toEqual([]);
    // Original result object is not mutated.
    expect(result).toHaveProperty(AGENT_IMAGES_FIELD);
  });

  it("passes through values without the field", () => {
    expect(extractAgentImagesFromActionResult({ a: 1 })).toEqual({
      value: { a: 1 },
      images: [],
      notes: [],
    });
    expect(extractAgentImagesFromActionResult("text")).toEqual({
      value: "text",
      images: [],
      notes: [],
    });
    expect(extractAgentImagesFromActionResult(null)).toEqual({
      value: null,
      images: [],
      notes: [],
    });
    expect(extractAgentImagesFromActionResult([1, 2])).toEqual({
      value: [1, 2],
      images: [],
      notes: [],
    });
  });

  it("still strips the field when every image is invalid, keeping notes", () => {
    const extracted = extractAgentImagesFromActionResult({
      done: true,
      [AGENT_IMAGES_FIELD]: [{ url: "http://insecure.example.com/x.png" }],
    });
    expect(extracted.value).toEqual({ done: true });
    expect(extracted.images).toEqual([]);
    expect(extracted.notes).toHaveLength(1);
  });
});

describe("describeToolResultImages", () => {
  it("keeps urls verbatim and reduces base64 to a byte-count placeholder", () => {
    const notes = describeToolResultImages([
      { url: "https://cdn.example.com/shot.png", label: "before" },
      { data: PNG_B64, mediaType: "image/png" },
    ]);
    expect(notes[0]).toContain("https://cdn.example.com/shot.png");
    expect(notes[0]).toContain('"before"');
    expect(notes[1]).toContain("image/png");
    expect(notes[1]).toMatch(/\d+ bytes/);
    expect(notes[1]).not.toContain(PNG_B64);
  });
});
