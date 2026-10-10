import { describe, expect, it } from "vitest";

import {
  nativeLocalExportCropMatchesOptions,
  nativeLocalExportCropSchema,
  nativeLocalExportOptionsSchema,
  nativeLocalExportRequestSchema,
  nativeVideoCodedDimensions,
} from "./native-local-export";

const viewport = { width: 640, height: 480 };
const settings = {
  durationSeconds: 3,
  startTimeSeconds: 0,
  fps: 60 as const,
  pixelRatio: 1,
  quality: "high" as const,
  matte: { r: 255, g: 255, b: 255 },
};

describe("native local export request bounds", () => {
  const crop = {
    nodeId: "frame-1",
    x: 218,
    y: 2069,
    width: 1162,
    height: 887,
  };
  const sourceViewport = { width: 1440, height: 3200 };

  it.each(["png", "jpg", "webp", "avif", "mp4"] as const)(
    "accepts a bounded %s crop only with a containing full-scene viewport",
    (format) => {
      const options =
        format === "mp4"
          ? {
              format,
              viewport: { width: crop.width, height: crop.height },
              settings,
            }
          : {
              format,
              viewport: { width: crop.width, height: crop.height },
              pixelRatio: 1,
            };
      expect(
        nativeLocalExportCropMatchesOptions(crop, options, sourceViewport),
      ).toBe(true);
      expect(nativeLocalExportCropMatchesOptions(crop, options)).toBe(false);
      expect(
        nativeLocalExportCropMatchesOptions(crop, options, {
          width: 1440,
          height: 2955,
        }),
      ).toBe(false);
      expect(
        nativeLocalExportCropMatchesOptions(
          { ...crop, x: -1 },
          options,
          sourceViewport,
        ),
      ).toBe(false);
      expect(
        nativeLocalExportCropMatchesOptions(
          { ...crop, y: -1 },
          options,
          sourceViewport,
        ),
      ).toBe(false);
      expect(
        nativeLocalExportCropMatchesOptions(
          { ...crop, x: Number.NaN },
          options,
          sourceViewport,
        ),
      ).toBe(false);
      expect(
        nativeLocalExportCropMatchesOptions(
          crop,
          { ...options, viewport },
          sourceViewport,
        ),
      ).toBe(false);
    },
  );

  it.each(["svg", "pdf", "html", "zip"] as const)(
    "preserves the existing selected %s viewport contract",
    (format) => {
      const options = {
        format,
        viewport: { width: crop.width, height: crop.height },
        pixelRatio: 1,
      };
      expect(nativeLocalExportCropMatchesOptions(crop, options)).toBe(true);
      expect(
        nativeLocalExportCropMatchesOptions(crop, options, sourceViewport),
      ).toBe(false);
    },
  );

  it("preserves the full-scene dimensions in strict request metadata", () => {
    const value = {
      designId: "design-1",
      fileId: "screen-1",
      expectedVersionHash: "v1",
      export: {
        format: "png",
        viewport: { width: crop.width, height: crop.height },
        pixelRatio: 1,
      },
      crop,
      sourceViewport,
    };
    expect(nativeLocalExportRequestSchema.parse(value)).toEqual(value);
    for (const malformed of [
      null,
      { width: 1440.5, height: 3200 },
      { width: 1440, height: 3200, extra: true },
      { width: 4096, height: 4096 },
    ])
      expect(
        nativeLocalExportRequestSchema.safeParse({
          ...value,
          sourceViewport: malformed,
        }).success,
      ).toBe(false);
    expect(
      nativeLocalExportCropSchema.safeParse({ ...crop, nodeId: "frame\n1" })
        .success,
    ).toBe(false);
    expect(
      nativeLocalExportCropSchema.safeParse({ ...crop, extra: true }).success,
    ).toBe(false);
  });

  it.each(["png", "mp4"] as const)(
    "bounds the %s full-scene pixels at the requested density",
    (format) => {
      const options =
        format === "mp4"
          ? {
              format,
              viewport: { width: 2, height: 2 },
              settings: { ...settings, pixelRatio: 2 },
            }
          : { format, viewport: { width: 2, height: 2 }, pixelRatio: 2 };
      const smallCrop = { nodeId: "frame-1", x: 0, y: 0, width: 2, height: 2 };
      expect(
        nativeLocalExportCropMatchesOptions(smallCrop, options, {
          width: 2048,
          height: 1024,
        }),
      ).toBe(true);
      expect(
        nativeLocalExportCropMatchesOptions(smallCrop, options, {
          width: 2049,
          height: 1024,
        }),
      ).toBe(false);
      expect(
        nativeLocalExportCropMatchesOptions(smallCrop, options, {
          width: 2048,
          height: 1025,
        }),
      ).toBe(false);
    },
  );

  it("does not pad the MP4 source viewport or infer it for whole-scene exports", () => {
    const options = {
      format: "mp4" as const,
      viewport: { width: 2, height: 2 },
      settings,
    };
    const smallCrop = { nodeId: "frame-1", x: 0, y: 0, width: 2, height: 2 };
    expect(
      nativeLocalExportCropMatchesOptions(smallCrop, options, {
        width: 3001,
        height: 2795,
      }),
    ).toBe(true);
    expect(nativeLocalExportCropMatchesOptions(undefined, options)).toBe(true);
    expect(
      nativeLocalExportCropMatchesOptions(undefined, options, options.viewport),
    ).toBe(false);
  });
  it.each(["png", "mp4"] as const)(
    "refuses a pixel-misaligned %s crop before queueing",
    (format) => {
      const options =
        format === "mp4"
          ? {
              format,
              viewport: { width: 10, height: 10 },
              settings: { ...settings, pixelRatio: 1.6 },
            }
          : { format, viewport: { width: 10, height: 10 }, pixelRatio: 1.6 };
      const smallCrop = {
        nodeId: "frame-1",
        x: 1,
        y: 0,
        width: 10,
        height: 10,
      };
      expect(
        nativeLocalExportCropMatchesOptions(smallCrop, options, {
          width: 20,
          height: 20,
        }),
      ).toBe(false);
      expect(
        nativeLocalExportCropMatchesOptions({ ...smallCrop, x: 0 }, options, {
          width: 20,
          height: 20,
        }),
      ).toBe(true);
    },
  );
  it.each(["svg", "pdf", "html", "zip"] as const)(
    "accepts a bounded same-scene %s foreground export and rejects oversized pixels",
    (format) => {
      expect(
        nativeLocalExportOptionsSchema.safeParse({
          format,
          viewport,
          pixelRatio: 1,
        }).success,
      ).toBe(true);
      expect(
        nativeLocalExportOptionsSchema.safeParse({
          format,
          viewport: { width: 4096, height: 4096 },
          pixelRatio: 1,
        }).success,
      ).toBe(false);
    },
  );
  it("accepts the exact three-second 60 fps local MP4 request", () => {
    expect(
      nativeLocalExportOptionsSchema.safeParse({
        format: "mp4",
        viewport,
        settings,
      }).success,
    ).toBe(true);
  });

  it("rejects fractional-frame duration instead of rounding it", () => {
    expect(
      nativeLocalExportOptionsSchema.safeParse({
        format: "mp4",
        viewport,
        settings: { ...settings, durationSeconds: 3.001 },
      }).success,
    ).toBe(false);
  });

  it("pads only the H.264 coded edge for odd dimensions and rejects coded limit overflow", () => {
    expect(
      nativeLocalExportOptionsSchema.safeParse({
        format: "png",
        viewport: { width: 2048, height: 1024 },
        pixelRatio: 2.1,
      }).success,
    ).toBe(false);
    expect(
      nativeLocalExportOptionsSchema.safeParse({
        format: "mp4",
        viewport: { width: 641, height: 480 },
        settings,
      }).success,
    ).toBe(true);
    expect(nativeVideoCodedDimensions(641, 479)).toEqual({
      width: 642,
      height: 480,
    });
    expect(nativeVideoCodedDimensions(640, 480)).toEqual({
      width: 640,
      height: 480,
    });
    expect(
      nativeLocalExportOptionsSchema.safeParse({
        format: "mp4",
        viewport: { width: 3001, height: 2795 },
        settings,
      }).success,
    ).toBe(false);
  });
});
