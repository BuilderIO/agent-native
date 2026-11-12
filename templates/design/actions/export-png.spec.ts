import { beforeEach, describe, expect, it, vi } from "vitest";

const takeDesignScreenshotRun = vi.hoisted(() => vi.fn());
const getScreenshotPngData = vi.hoisted(() => vi.fn());
const { mockGetDb, mockLimit } = vi.hoisted(() => {
  const limit = vi.fn();
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn(() => chain);
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = limit;
  return { mockGetDb: vi.fn(() => chain), mockLimit: limit };
});

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => ({ kind: "access-filter" })),
  registerShareableResource: vi.fn(),
}));
vi.mock("../server/db/index.js", () => ({
  getDb: mockGetDb,
  schema: {
    designFiles: { id: "id", designId: "design_id", filename: "filename" },
    designs: { id: "design_id", data: "data" },
    designShares: {},
  },
}));

vi.mock("./take-design-screenshot.js", () => ({
  default: { run: takeDesignScreenshotRun },
  getScreenshotPngData,
}));

import action from "./export-png.js";

function screenWithData(data: string, fileId = "file_1") {
  mockLimit.mockResolvedValue([{ fileId, data }]);
}

function mockRenderedScreen(widthPx: number) {
  takeDesignScreenshotRun.mockResolvedValueOnce({
    ok: true,
    designId: "design_1",
    fileId: "file_1",
    filename: "index.html",
    capturedAt: "2026-09-09T00:00:00.000Z",
    screenshots: [
      {
        viewport: { label: `width-${widthPx}`, widthPx, heightPx: 900 },
        url: "https://files.example.test/index.png",
        persisted: true,
        bytes: 10,
        diagnostics: {},
      },
    ],
  });
}

beforeEach(() => {
  mockGetDb.mockClear();
  takeDesignScreenshotRun.mockClear();
  screenWithData("{}");
});

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
    expect(
      action.schema.safeParse({
        fileId: "file_1",
        sampleContactValues: [{ field: "contact.firstname", value: "Alex" }],
      }).success,
    ).toBe(false);
  });

  it("exports one selected screen through the screenshot renderer", async () => {
    const diagnostics = { horizontalOverflowPx: 0 };
    const agentImages = [
      {
        data: "aGVsbG8=",
        mediaType: "image/png",
        label: "Quarterly results.html (desktop-900)",
      },
    ];
    getScreenshotPngData.mockReturnValueOnce(Buffer.from("hello"));
    takeDesignScreenshotRun.mockResolvedValueOnce({
      ok: true,
      designId: "design_1",
      fileId: "file_2",
      filename: "Quarterly results.html",
      capturedAt: "2026-09-09T00:00:00.000Z",
      preview: {
        mode: "hubspot-email",
        sampleValues: true,
        substitutedTokens: ["{{ site_settings.company_name }}"],
        unresolvedTokens: [],
      },
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

    const result = await action.run(
      {
        fileId: "file_2",
        filename: "index.html",
        width: 900,
        height: 600,
        templatePreview: "hubspot-email",
        sampleContactValues: [{ field: "contact.firstname", value: "Alex" }],
      },
      { caller: "mcp" },
    );

    expect(takeDesignScreenshotRun).toHaveBeenCalledWith(
      {
        fileId: "file_2",
        filename: "index.html",
        widths: [900],
        heights: [600],
        templatePreview: "hubspot-email",
        sampleContactValues: [{ field: "contact.firstname", value: "Alex" }],
      },
      { caller: "mcp" },
    );
    expect(result).toMatchObject({
      ok: true,
      fileId: "file_2",
      screenFilename: "Quarterly results.html",
      filename: "Quarterly-results.png",
      url: "https://files.example.test/screen.png",
      mimeType: "image/png",
      diagnostics,
      _agentImages: agentImages,
      preview: {
        mode: "hubspot-email",
        sampleValues: true,
        unresolvedTokens: [],
      },
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

  it("keeps the durable URL and explains when an inline PNG is too large", async () => {
    const png = Buffer.alloc(1_500_001);
    const toString = vi.spyOn(png, "toString");
    getScreenshotPngData.mockReturnValueOnce(png);
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
          bytes: 2_000_001,
          diagnostics: {},
        },
      ],
    });

    const result = await action.run(
      {
        designId: "design_1",
        filename: "index.html",
      },
      { caller: "mcp" },
    );

    expect(result).toMatchObject({
      url: "https://files.example.test/index.png",
      message:
        "The PNG exceeds the inline image limit; use its durable URL to view it.",
    });
    expect(result._agentImages).toBeUndefined();
    expect(toString).not.toHaveBeenCalled();
  });

  it("does not return inline image data or fallback messages to HTTP callers", async () => {
    getScreenshotPngData.mockClear();
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

    const result = await action.run(
      { designId: "design_1", filename: "index.html" },
      { caller: "http" },
    );

    expect(result).toMatchObject({
      url: "https://files.example.test/index.png",
    });
    expect(result._agentImages).toBeUndefined();
    expect(result.message).toBeUndefined();
    expect(getScreenshotPngData).not.toHaveBeenCalled();
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

describe("export-png width", () => {
  const mobileFrames = JSON.stringify({
    canvasFrames: { file_1: { x: 0, y: 0, width: 390, height: 844 } },
  });

  it("exports a mobile screen at its authored frame width when width is omitted", async () => {
    screenWithData(mobileFrames);
    mockRenderedScreen(390);

    await action.run({ fileId: "file_1", filename: "index.html" });

    expect(takeDesignScreenshotRun).toHaveBeenCalledWith(
      { fileId: "file_1", filename: "index.html", widths: [390] },
      undefined,
    );
  });

  it("finds the frame of the screen selected by designId and filename", async () => {
    screenWithData(mobileFrames);
    mockRenderedScreen(390);

    await action.run({ designId: "design_1", filename: "index.html" });

    expect(takeDesignScreenshotRun).toHaveBeenCalledWith(
      { designId: "design_1", filename: "index.html", widths: [390] },
      undefined,
    );
  });

  it("prefers the screen's metadata width over a scaled-down overview frame", async () => {
    screenWithData(
      JSON.stringify({
        canvasFrames: { file_1: { x: 0, y: 0, width: 320, height: 640 } },
        screenMetadata: { file_1: { width: 1280, height: 2560 } },
      }),
    );
    mockRenderedScreen(1280);

    await action.run({ fileId: "file_1", filename: "index.html" });

    expect(takeDesignScreenshotRun).toHaveBeenCalledWith(
      { fileId: "file_1", filename: "index.html", widths: [1280] },
      undefined,
    );
  });

  it("uses the frame when the metadata is for another screen or has no usable width", async () => {
    screenWithData(
      JSON.stringify({
        canvasFrames: { file_1: { x: 0, y: 0, width: 390, height: 844 } },
        screenMetadata: { other_file: { width: 1280 }, file_1: { width: 0 } },
      }),
    );
    mockRenderedScreen(390);

    await action.run({ fileId: "file_1", filename: "index.html" });

    expect(takeDesignScreenshotRun).toHaveBeenCalledWith(
      { fileId: "file_1", filename: "index.html", widths: [390] },
      undefined,
    );
  });

  it.each([
    ["metadata is not an object", { screenMetadata: [] }],
    [
      "the screen's metadata is not an object",
      { screenMetadata: { file_1: 7 } },
    ],
  ])("fails typed when %s", async (_label, data) => {
    screenWithData(JSON.stringify(data));

    await expect(
      action.run({ fileId: "file_1", filename: "index.html" }),
    ).rejects.toMatchObject({
      errorCode: "design_data_unreadable",
      noWrite: true,
    });
    expect(takeDesignScreenshotRun).not.toHaveBeenCalled();
  });

  it("lets an explicit width win over the authored frame without reading it", async () => {
    screenWithData(mobileFrames);
    mockRenderedScreen(900);

    await action.run({ fileId: "file_1", filename: "index.html", width: 900 });

    expect(mockGetDb).not.toHaveBeenCalled();
    expect(takeDesignScreenshotRun).toHaveBeenCalledWith(
      { fileId: "file_1", filename: "index.html", widths: [900] },
      undefined,
    );
  });

  it("falls back to 1440 when the design stores no frame for the screen", async () => {
    screenWithData(
      JSON.stringify({
        canvasFrames: { other_file: { x: 0, y: 0, width: 390, height: 844 } },
      }),
    );
    mockRenderedScreen(1440);

    await action.run({ fileId: "file_1", filename: "index.html" });

    expect(takeDesignScreenshotRun).toHaveBeenCalledWith(
      { fileId: "file_1", filename: "index.html", widths: [1440] },
      undefined,
    );
  });

  it("falls back to 1440 when a frame stores no usable width", async () => {
    screenWithData(
      JSON.stringify({ canvasFrames: { file_1: { x: 0, y: 0, width: 0 } } }),
    );
    mockRenderedScreen(1440);

    await action.run({ fileId: "file_1", filename: "index.html" });

    expect(takeDesignScreenshotRun).toHaveBeenCalledWith(
      { fileId: "file_1", filename: "index.html", widths: [1440] },
      undefined,
    );
  });

  it("keeps an authored width inside the action's width bounds", async () => {
    screenWithData(
      JSON.stringify({ canvasFrames: { file_1: { width: 5000 } } }),
    );
    mockRenderedScreen(3840);
    await action.run({ fileId: "file_1", filename: "index.html" });
    expect(takeDesignScreenshotRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ widths: [3840] }),
      undefined,
    );

    screenWithData(
      JSON.stringify({ canvasFrames: { file_1: { width: 160 } } }),
    );
    mockRenderedScreen(200);
    await action.run({ fileId: "file_1", filename: "index.html" });
    expect(takeDesignScreenshotRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ widths: [200] }),
      undefined,
    );
  });

  it("leaves a screen the caller cannot read to the screenshot's not-found error", async () => {
    mockLimit.mockResolvedValue([]);
    mockRenderedScreen(1440);

    await action.run({ fileId: "missing", filename: "index.html" });

    expect(takeDesignScreenshotRun).toHaveBeenCalledWith(
      { fileId: "missing", filename: "index.html", widths: [1440] },
      undefined,
    );
  });

  it.each(["{not json", "", "null", "[]"])(
    "fails typed instead of exporting at 1440 when the design data is unreadable (%j)",
    async (data) => {
      screenWithData(data);

      await expect(
        action.run({ fileId: "file_1", filename: "index.html" }),
      ).rejects.toMatchObject({
        errorCode: "design_data_unreadable",
        noWrite: true,
      });
      expect(takeDesignScreenshotRun).not.toHaveBeenCalled();
    },
  );

  it("still exports unreadable-data designs when the caller passes a width", async () => {
    screenWithData("{not json");
    mockRenderedScreen(600);

    await expect(
      action.run({ fileId: "file_1", filename: "index.html", width: 600 }),
    ).resolves.toMatchObject({ ok: true });
  });
});
