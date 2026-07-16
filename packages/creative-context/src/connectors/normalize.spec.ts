import { describe, expect, it } from "vitest";

import {
  assertContextItemSqlTextLimits,
  MAX_METADATA_BYTES,
  MAX_MEDIA_TEXT_BYTES,
  MAX_NATIVE_CONTENT_BYTES,
  MAX_SEARCHABLE_CONTENT_BYTES,
  MAX_SUMMARY_BYTES,
  normalizeContextItem,
} from "./normalize.js";

describe("normalizeContextItem SQL text limits", () => {
  it("bounds emoji content and summaries by UTF-8 bytes without splitting code points", () => {
    const item = normalizeContextItem({
      externalId: "emoji",
      kind: "document",
      title: "Emoji",
      content: "🙂".repeat(20_000),
      summary: "🙂".repeat(3_000),
    });

    expect(Buffer.byteLength(item.content, "utf8")).toBe(
      MAX_SEARCHABLE_CONTENT_BYTES,
    );
    expect(Array.from(item.content)).toHaveLength(
      MAX_SEARCHABLE_CONTENT_BYTES / 4,
    );
    expect(Buffer.byteLength(item.summary!, "utf8")).toBe(MAX_SUMMARY_BYTES);
    expect(Array.from(item.summary!)).toHaveLength(MAX_SUMMARY_BYTES / 4);
    expect(item.content).not.toContain("�");
    expect(item.summary).not.toContain("�");
  });

  it("uses the largest complete CJK prefix that fits the UTF-8 byte budget", () => {
    const item = normalizeContextItem({
      externalId: "cjk",
      kind: "document",
      title: "CJK",
      content: "界".repeat(30_000),
    });

    const expectedCodePoints = Math.floor(MAX_SEARCHABLE_CONTENT_BYTES / 3);
    expect(Array.from(item.content)).toHaveLength(expectedCodePoints);
    expect(Buffer.byteLength(item.content, "utf8")).toBe(
      expectedCodePoints * 3,
    );
    expect(Buffer.byteLength(item.content, "utf8")).toBeLessThanOrEqual(
      MAX_SEARCHABLE_CONTENT_BYTES,
    );
  });

  it("rejects oversized native HTML intact instead of truncating its markup", () => {
    const html = `<div class="fmd-slide">${"界".repeat(MAX_NATIVE_CONTENT_BYTES / 3)}</div>`;

    expect(() =>
      normalizeContextItem({
        externalId: "oversized-native",
        kind: "google-slides-slide",
        title: "Oversized native slide",
        mimeType: "text/html",
        content: html,
        metadata: {
          nativeArtifact: { app: "slides", format: "slides-html" },
        },
      }),
    ).toThrow(/native content.*exceeds.*split the artifact/i);
  });

  it("rejects oversized structured metadata and media text before SQL writes", () => {
    const oversizedMetadata = normalizeContextItem({
      externalId: "oversized-metadata",
      kind: "presentation",
      title: "Oversized metadata",
      content: "small",
      metadata: { speakerNotes: "x".repeat(MAX_METADATA_BYTES) },
    });
    expect(() => assertContextItemSqlTextLimits(oversizedMetadata)).toThrow(
      /item metadata.*exceeds.*private blob storage/i,
    );

    const oversizedMedia = normalizeContextItem({
      externalId: "oversized-media",
      kind: "presentation",
      title: "Oversized media",
      content: "small",
      media: [
        {
          kind: "image",
          url: "https://example.com/image.png",
          ocrText: "x".repeat(MAX_MEDIA_TEXT_BYTES + 1),
          metadata: { providerPayload: "small" },
        },
      ],
    });
    expect(() => assertContextItemSqlTextLimits(oversizedMedia)).toThrow(
      /media OCR text.*exceeds.*private blob storage/i,
    );
  });
});
