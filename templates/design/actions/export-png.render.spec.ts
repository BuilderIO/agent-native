import { describe, expect, it, vi } from "vitest";

// Runs the real export-png through the real screenshot renderer, with only the
// browser, database and file storage replaced, to prove what a chat call
// renders and returns.

const playwrightMocks = vi.hoisted(() => ({
  importPlaywright: vi.fn(),
  launchChromium: vi.fn(),
}));

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

vi.mock("@agent-native/core/collab", () => ({
  getText: vi.fn(),
  hasCollabState: vi.fn().mockResolvedValue(false),
}));
vi.mock("@agent-native/core/file-upload", () => ({ uploadFile: vi.fn() }));
vi.mock(
  "@agent-native/core/server/request-context",
  async (importOriginal) => ({
    ...((await importOriginal()) as Record<string, unknown>),
    getRequestUserEmail: vi.fn().mockReturnValue("viewer@example.test"),
  }),
);
vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(() => ({ kind: "access-filter" })),
  registerShareableResource: vi.fn(),
}));
vi.mock("../server/db/index.js", () => ({
  getDb: mockGetDb,
  schema: {
    designFiles: {
      id: "id",
      designId: "design_id",
      filename: "filename",
      fileType: "file_type",
      content: "content",
    },
    designs: { id: "design_id", data: "data" },
    designShares: {},
  },
}));
vi.mock("../server/lib/design-to-figma-svg.js", () => ({
  isAllowedFigmaSvgRenderRequest: vi.fn(),
}));
vi.mock("../server/lib/playwright-runtime.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    importPlaywright: playwrightMocks.importPlaywright,
    launchChromium: playwrightMocks.launchChromium,
  };
});
vi.mock("../server/lib/screenshot-readiness.js", () => ({
  prepareScreenshotPage: vi.fn(async (page, html) => page.setContent(html)),
}));
vi.mock("../server/source-workspace.js", () => ({
  readLiveSourceFile: vi.fn(async () => ({ content: "<html></html>" })),
}));

import { uploadFile } from "@agent-native/core/file-upload";

import exportPng from "./export-png.js";

const diagnostics = {
  documentWidthPx: 390,
  documentHeightPx: 844,
  horizontalOverflowPx: 0,
  overflowingElements: [],
  lowContrastText: [],
  brokenImages: [],
  zeroSizeOrOffscreen: [],
};

function mockBrowser(screenshot: ReturnType<typeof vi.fn>, frameData: string) {
  // export-png reads the design's frames first, then the screenshot renderer
  // loads the screen itself.
  mockLimit.mockReset();
  mockLimit
    .mockResolvedValueOnce([{ fileId: "file_1", data: frameData }])
    .mockResolvedValueOnce([
      {
        id: "file_1",
        designId: "design_1",
        filename: "index.html",
        fileType: "html",
        content: "<html></html>",
      },
    ]);
  const page = {
    on: vi.fn(),
    setContent: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(diagnostics),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
    screenshot,
  };
  const context = {
    addInitScript: vi.fn().mockResolvedValue(undefined),
    route: vi.fn().mockResolvedValue(undefined),
    routeWebSocket: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
  };
  playwrightMocks.importPlaywright.mockResolvedValue({ chromium: {} });
  playwrightMocks.launchChromium.mockResolvedValue(browser);
  vi.mocked(uploadFile).mockResolvedValue({
    url: "https://files.example.test/screen.png",
  } as never);
  return { browser, page };
}

const mobileFrame = JSON.stringify({
  canvasFrames: { file_1: { x: 0, y: 0, width: 390, height: 844 } },
});

describe("export-png called from chat", () => {
  const chat = { caller: "tool", actionName: "export-png" } as const;

  it("renders the uploaded file at the 2x export scale and the screen's frame width", async () => {
    const png = Buffer.from("export png bytes");
    const { browser } = mockBrowser(
      vi.fn().mockResolvedValue(png),
      mobileFrame,
    );

    const result = await exportPng.run({ fileId: "file_1" } as never, chat);

    expect(browser.newContext).toHaveBeenCalledTimes(1);
    expect(browser.newContext).toHaveBeenCalledWith({
      viewport: { width: 390, height: expect.any(Number) },
      deviceScaleFactor: 2,
    });
    expect(vi.mocked(uploadFile)).toHaveBeenCalledWith(
      expect.objectContaining({ data: png, mimeType: "image/png" }),
    );
    expect(result).toMatchObject({
      ok: true,
      url: "https://files.example.test/screen.png",
      viewport: { widthPx: 390 },
    });
  });

  it("returns no inline image to the model, so no extra 1x capture is made for one", async () => {
    // Larger than the inline limit: the 1x agent path would re-capture as JPEG.
    const png = Buffer.alloc(1_600_000);
    const screenshot = vi.fn().mockResolvedValue(png);
    mockBrowser(screenshot, mobileFrame);

    const result = await exportPng.run({ fileId: "file_1" } as never, chat);

    expect(result).not.toHaveProperty("_agentImages");
    expect(result).not.toHaveProperty("message");
    expect(screenshot).toHaveBeenCalledTimes(1);
    expect(screenshot).toHaveBeenCalledWith(
      expect.objectContaining({ type: "png", fullPage: true }),
    );
  });
});
