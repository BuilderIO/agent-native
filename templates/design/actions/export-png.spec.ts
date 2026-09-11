import { describe, expect, it, vi } from "vitest";

const takeDesignScreenshotRun = vi.hoisted(() => vi.fn());

vi.mock("./take-design-screenshot.js", () => ({
  default: { run: takeDesignScreenshotRun },
}));

import action from "./export-png.js";

describe("export-png", () => {
  it("is marked as a mutation because it uploads the rendered image", () => {
    expect(action.readOnly).toBe(false);
  });

  it("requires a design or file target", () => {
    expect(action.schema.safeParse({}).success).toBe(false);
    expect(action.schema.safeParse({ designId: "design_1" }).success).toBe(
      true,
    );
    expect(action.schema.safeParse({ fileId: "file_1" }).success).toBe(true);
  });

  it("exports one selected screen through the screenshot renderer", async () => {
    const diagnostics = { horizontalOverflowPx: 0 };
    takeDesignScreenshotRun.mockResolvedValueOnce({
      ok: true,
      designId: "design_1",
      fileId: "file_2",
      filename: "Quarterly results.html",
      capturedAt: "2026-09-09T00:00:00.000Z",
      screenshots: [
        {
          viewport: { label: "desktop-900", widthPx: 900, heightPx: 600 },
          url: "https://files.example.test/screen.png",
          persisted: true,
          bytes: 42,
          diagnostics,
        },
      ],
    });

    const result = await action.run({
      fileId: "file_2",
      filename: "index.html",
      width: 900,
      height: 600,
    });

    expect(takeDesignScreenshotRun).toHaveBeenCalledWith(
      {
        fileId: "file_2",
        filename: "index.html",
        widths: [900],
        heights: [600],
      },
      undefined,
    );
    expect(result).toMatchObject({
      ok: true,
      fileId: "file_2",
      screenFilename: "Quarterly results.html",
      filename: "Quarterly-results.png",
      url: "https://files.example.test/screen.png",
      mimeType: "image/png",
      diagnostics,
    });
  });

  it("defaults to one desktop render", async () => {
    takeDesignScreenshotRun.mockResolvedValueOnce({
      ok: true,
      designId: "design_1",
      fileId: "file_1",
      filename: "index.html",
      capturedAt: "2026-09-09T00:00:00.000Z",
      screenshots: [
        {
          viewport: { label: "desktop-1440", widthPx: 1440, heightPx: 900 },
          url: "https://files.example.test/index.png",
          persisted: true,
          bytes: 10,
          diagnostics: {},
        },
      ],
    });

    await action.run({ designId: "design_1", filename: "index.html" });

    expect(takeDesignScreenshotRun).toHaveBeenCalledWith(
      {
        designId: "design_1",
        filename: "index.html",
        widths: [1440],
      },
      undefined,
    );
  });

  it("preserves a structured Chromium-unavailable result", async () => {
    takeDesignScreenshotRun.mockResolvedValueOnce({
      ok: false,
      reason: "A headless Chromium browser is not available.",
    });

    await expect(
      action.run({ designId: "design_1", filename: "index.html" }),
    ).resolves.toEqual({
      ok: false,
      reason: "A headless Chromium browser is not available.",
    });
  });

  it("fails explicitly when storage cannot return the rendered PNG", async () => {
    takeDesignScreenshotRun.mockResolvedValueOnce({
      ok: true,
      designId: "design_1",
      fileId: "file_1",
      filename: "index.html",
      capturedAt: "2026-09-09T00:00:00.000Z",
      screenshots: [
        {
          viewport: { label: "desktop-1440", widthPx: 1440, heightPx: 900 },
          url: "",
          persisted: false,
          bytes: 10,
          diagnostics: {},
        },
      ],
    });

    await expect(
      action.run({ designId: "design_1", filename: "index.html" }),
    ).rejects.toMatchObject({
      errorCode: "file_storage_not_configured",
    });
  });

  it("preserves configured upload failures", async () => {
    takeDesignScreenshotRun.mockResolvedValueOnce({
      ok: true,
      designId: "design_1",
      fileId: "file_1",
      filename: "index.html",
      capturedAt: "2026-09-09T00:00:00.000Z",
      screenshots: [
        {
          viewport: { label: "desktop-1440", widthPx: 1440, heightPx: 900 },
          url: "",
          persisted: false,
          uploadError: {
            code: "file_upload_failed",
            message: "Configured file storage rejected the screenshot upload.",
          },
          bytes: 10,
          diagnostics: {},
        },
      ],
    });

    await expect(
      action.run({ designId: "design_1", filename: "index.html" }),
    ).rejects.toMatchObject({
      errorCode: "file_upload_failed",
    });
  });
});
