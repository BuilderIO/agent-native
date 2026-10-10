import type { NativeLocalExportState } from "@shared/native-local-export";
import { describe, expect, it, vi } from "vitest";

import { runNativeLocalExportDownload } from "./native-local-export-download";
import { NativeSceneExportError } from "./native-scene-export-client";

const request: NativeLocalExportState = {
  designId: "design-1",
  fileId: "screen-1",
  expectedVersionHash: "v2",
  export: {
    format: "png",
    viewport: { width: 640, height: 480 },
    pixelRatio: 2,
  },
  schemaVersion: 1,
  requestId: "00000000-0000-4000-8000-000000000001",
  tabId: "tab-1",
  status: "running",
  issuedAt: 1,
  expiresAt: Date.now() + 60_000,
};

describe("native local export download", () => {
  const crop = { nodeId: "frame-1", x: 218, y: 2069, width: 1162, height: 887 };
  const sourceViewport = { width: 1440, height: 3200 };

  it.each([
    "png",
    "jpg",
    "webp",
    "avif",
    "svg",
    "pdf",
    "mp4",
    "html",
    "zip",
  ] as const)(
    "forwards the exact claimed %s crop to its held-frame producer",
    async (format) => {
      const capture = vi.fn(async (_input: unknown) => new Blob([format]));
      const exportOptions =
        format === "mp4"
          ? {
              format,
              viewport: { width: crop.width, height: crop.height },
              settings: {
                durationSeconds: 1,
                startTimeSeconds: 0,
                fps: 30 as const,
                pixelRatio: 1,
                quality: "high" as const,
                matte: { r: 255, g: 255, b: 255 },
              },
            }
          : {
              format,
              viewport: { width: crop.width, height: crop.height },
              pixelRatio: 1,
            };
      await runNativeLocalExportDownload({
        request: {
          ...request,
          crop,
          sourceViewport: ["svg", "pdf", "html", "zip"].includes(format)
            ? undefined
            : sourceViewport,
          export: exportOptions,
        },
        signal: new AbortController().signal,
        capturePng: capture,
        captureSvg: capture,
        capturePdf: capture,
        captureMp4: capture,
        captureHtml: capture,
        captureZip: capture,
        download: vi.fn(),
      });
      expect(capture).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          crop,
          viewport: { width: 1162, height: 887 },
        }),
      );
      if (["svg", "pdf", "html", "zip"].includes(format))
        expect(capture.mock.calls[0][0]).not.toHaveProperty("sourceViewport");
      else
        expect(capture.mock.calls[0][0]).toHaveProperty(
          "sourceViewport",
          sourceViewport,
        );
    },
  );

  it("refuses mismatched crop geometry before any producer runs", async () => {
    const capture = vi.fn(async () => new Blob(["unused"]));
    for (const format of ["html", "zip", "png"] as const) {
      await expect(
        runNativeLocalExportDownload({
          request: {
            ...request,
            crop,
            export: {
              format,
              viewport: request.export.viewport,
              pixelRatio: 1,
            },
          },
          signal: new AbortController().signal,
          capturePng: capture,
          captureHtml: capture,
          captureZip: capture,
          download: vi.fn(),
        }),
      ).rejects.toMatchObject({ code: "scene-unavailable" });
    }
    expect(capture).not.toHaveBeenCalled();
  });
  it("refuses absent or out-of-bounds full-scene metadata before capture or download", async () => {
    const capture = vi.fn(async () => new Blob(["unused"]));
    const download = vi.fn();
    for (const format of ["png", "mp4"] as const) {
      const exportOptions =
        format === "mp4"
          ? {
              format,
              viewport: { width: crop.width, height: crop.height },
              settings: {
                durationSeconds: 1,
                startTimeSeconds: 0,
                fps: 30 as const,
                pixelRatio: 1,
                quality: "high" as const,
                matte: { r: 255, g: 255, b: 255 },
              },
            }
          : {
              format,
              viewport: { width: crop.width, height: crop.height },
              pixelRatio: 1,
            };
      for (const invalidSource of [
        undefined,
        { width: 1440, height: 2955 },
        { width: 1440, height: 3200.5 },
      ]) {
        await expect(
          runNativeLocalExportDownload({
            request: {
              ...request,
              crop,
              export: exportOptions,
              sourceViewport: invalidSource,
            },
            signal: new AbortController().signal,
            capturePng: capture,
            captureMp4: capture,
            download,
          }),
        ).rejects.toMatchObject({ code: "scene-unavailable" });
      }
    }
    expect(capture).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it("forwards the claimed PNG identity and exact version, then triggers only a local download", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    const capturePng = vi.fn(async () => blob);
    const download = vi.fn();
    await runNativeLocalExportDownload({
      request,
      signal: new AbortController().signal,
      capturePng,
      download,
    });
    expect(capturePng).toHaveBeenCalledWith(
      expect.objectContaining({
        designId: "design-1",
        fileId: "screen-1",
        viewport: { width: 640, height: 480 },
        pixelRatio: 2,
        expectedVersionHash: "v2",
        format: "png",
      }),
    );
    expect(download).toHaveBeenCalledWith(blob, "png");
  });

  it("uses the same selected-scene capture for each supported raster format", async () => {
    for (const format of ["jpg", "webp", "avif"] as const) {
      const blob = new Blob([format], {
        type: format === "jpg" ? "image/jpeg" : `image/${format}`,
      });
      const capturePng = vi.fn(async () => blob);
      const download = vi.fn();
      await runNativeLocalExportDownload({
        request: {
          ...request,
          export: {
            format,
            viewport: { width: 640, height: 480 },
            pixelRatio: 2,
          },
        },
        signal: new AbortController().signal,
        capturePng,
        download,
      });
      expect(capturePng).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedVersionHash: "v2",
          format,
        }),
      );
      expect(download).toHaveBeenCalledWith(blob, format);
    }
  });

  it.each(["svg", "pdf", "html", "zip"] as const)(
    "routes claimed %s through its canonical foreground producer and local download",
    async (format) => {
      const blob = new Blob([format]);
      const capture = vi.fn(async () => blob);
      const download = vi.fn();
      await runNativeLocalExportDownload({
        request: {
          ...request,
          export: {
            format,
            viewport: { width: 640, height: 480 },
            pixelRatio: 2,
          },
        },
        signal: new AbortController().signal,
        captureSvg: capture,
        capturePdf: capture,
        captureHtml: capture,
        captureZip: capture,
        download,
      });
      expect(capture).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          designId: "design-1",
          fileId: "screen-1",
          expectedVersionHash: "v2",
          pixelRatio: 2,
        }),
      );
      expect(download).toHaveBeenCalledWith(blob, format);
    },
  );

  it("forwards MP4 settings through the same claimed source and reports capture progress", async () => {
    const settings = {
      durationSeconds: 3,
      startTimeSeconds: 1,
      fps: 60 as const,
      pixelRatio: 1,
      quality: "high" as const,
      matte: { r: 255, g: 255, b: 255 },
    };
    const captureMp4 = vi.fn(async () => new Blob(["mp4"]));
    const onProgress = vi.fn();
    await runNativeLocalExportDownload({
      request: {
        ...request,
        export: { format: "mp4", viewport: request.export.viewport, settings },
      },
      signal: new AbortController().signal,
      captureMp4,
      onProgress,
      download: vi.fn(),
    });
    expect(captureMp4).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: "screen-1",
        expectedVersionHash: "v2",
        settings,
        onProgress,
      }),
    );
  });

  it("reports a changed source and never starts a download", async () => {
    const download = vi.fn();
    await expect(
      runNativeLocalExportDownload({
        request,
        signal: new AbortController().signal,
        capturePng: vi.fn(async () => {
          throw new NativeSceneExportError("source-stale", "Source changed.");
        }),
        download,
      }),
    ).rejects.toMatchObject({ code: "source-stale" });
    expect(download).not.toHaveBeenCalled();
  });

  it("preserves a bounded typed runtime failure from another realm", async () => {
    const runtimeFailure = Object.assign(Object.create(null), {
      name: "NativeSourceError",
      code: "composition-native-record-missing",
      message: "Full-scene capture omitted 32 visible native effect surfaces.",
    });
    const download = vi.fn();
    await expect(
      runNativeLocalExportDownload({
        request,
        signal: new AbortController().signal,
        capturePng: vi.fn(async () => {
          throw runtimeFailure;
        }),
        download,
      }),
    ).rejects.toMatchObject({
      code: "render-failed",
      message:
        "composition-native-record-missing: Full-scene capture omitted 32 visible native effect surfaces.",
      cause: runtimeFailure,
    });
    expect(download).not.toHaveBeenCalled();
  });

  it("preserves a bounded composition clock failure from the export iframe", async () => {
    const clockFailure = Object.assign(Object.create(null), {
      name: "NativeCompositionClockError",
      code: "composition-canvas-source",
      message:
        "An authored canvas needs an explicit deterministic source contract.",
    });
    const download = vi.fn();
    await expect(
      runNativeLocalExportDownload({
        request,
        signal: new AbortController().signal,
        capturePng: vi.fn(async () => {
          throw clockFailure;
        }),
        download,
      }),
    ).rejects.toMatchObject({
      code: "render-failed",
      message:
        "composition-canvas-source: An authored canvas needs an explicit deterministic source contract.",
      cause: clockFailure,
    });
    expect(download).not.toHaveBeenCalled();
  });

  it("does not read arbitrary or throwing error fields as a successful runtime status", async () => {
    const forgedFailure = {
      name: "NativeSourceError",
      code: "success\nforged",
      message: "x".repeat(600),
    };
    const unreadableFailure = Object.defineProperty({}, "message", {
      get: () => {
        throw new Error("unreadable getter");
      },
    });
    for (const [failure, message] of [
      [forgedFailure, "x".repeat(240)],
      [unreadableFailure, "Local export failure details are unreadable."],
    ] as const) {
      await expect(
        runNativeLocalExportDownload({
          request,
          signal: new AbortController().signal,
          capturePng: vi.fn(async () => {
            throw failure;
          }),
          download: vi.fn(),
        }),
      ).rejects.toMatchObject({
        code: "render-failed",
        message,
        cause: failure,
      });
    }
  });

  it("retains bounded messages from ordinary same-realm capture errors", async () => {
    class CaptureCleanupError extends Error {
      name = "CaptureCleanupError";
    }
    await expect(
      runNativeLocalExportDownload({
        request,
        signal: new AbortController().signal,
        capturePng: vi.fn(async () => {
          throw new CaptureCleanupError("Preview restoration failed.");
        }),
        download: vi.fn(),
      }),
    ).rejects.toMatchObject({
      code: "render-failed",
      message: "Preview restoration failed.",
    });
  });

  it("does not report success when the local download trigger fails", async () => {
    const blocked = new Error("Download blocked");
    await expect(
      runNativeLocalExportDownload({
        request,
        signal: new AbortController().signal,
        capturePng: vi.fn(async () => new Blob(["png"])),
        download: () => {
          throw blocked;
        },
      }),
    ).rejects.toMatchObject({ code: "download-failed", cause: blocked });
  });

  it("does not trigger a download when the lease is canceled during capture", async () => {
    const controller = new AbortController();
    const download = vi.fn();
    await expect(
      runNativeLocalExportDownload({
        request,
        signal: controller.signal,
        capturePng: vi.fn(async () => {
          controller.abort();
          return new Blob(["png"]);
        }),
        download,
      }),
    ).rejects.toMatchObject({ code: "canceled" });
    expect(download).not.toHaveBeenCalled();
  });

  it("does not initiate a download after the lease expires during capture", async () => {
    let now = 1000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    const download = vi.fn();
    try {
      await expect(
        runNativeLocalExportDownload({
          request: { ...request, expiresAt: 1500 },
          signal: new AbortController().signal,
          capturePng: vi.fn(async () => {
            now = 2000;
            return new Blob(["png"]);
          }),
          download,
        }),
      ).rejects.toMatchObject({ code: "client-unavailable" });
      expect(download).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });
});
