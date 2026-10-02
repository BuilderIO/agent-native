import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const playwrightMocks = vi.hoisted(() => ({
  importPlaywright: vi.fn(),
  launchChromium: vi.fn(),
}));

vi.mock("../server/lib/playwright-runtime.js", () => ({
  importPlaywright: playwrightMocks.importPlaywright,
  launchChromium: playwrightMocks.launchChromium,
}));

let action: (typeof import("./render-export-png.js"))["default"];

function makePage(evaluateResults: unknown[]) {
  const page = {
    setContent: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(),
    screenshot: vi.fn(),
  };
  for (const result of evaluateResults) {
    page.evaluate.mockResolvedValueOnce(result);
  }
  const png = Buffer.alloc(24);
  png[0] = 0x89;
  png.write("PNG", 1, "ascii");
  png.write("IHDR", 12, "ascii");
  png.writeUInt32BE(800, 16);
  png.writeUInt32BE(600, 20);
  page.screenshot.mockResolvedValue(png);
  return page;
}

function makeContext(page: ReturnType<typeof makePage>) {
  return {
    route: vi.fn().mockResolvedValue(undefined),
    routeWebSocket: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeBrowser(contexts: ReturnType<typeof makeContext>[]) {
  let nextContext = 0;
  return {
    isConnected: vi.fn().mockReturnValue(true),
    on: vi.fn(),
    newContext: vi
      .fn()
      .mockImplementation(() => Promise.resolve(contexts[nextContext++])),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

const completeResources = {
  marker: null,
  brokenImages: [],
  failedFonts: [],
  loadingFonts: [],
};
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/0yoAAAAASUVORK5CYII=",
  "base64",
);

function makeRenderer(evaluateResults: unknown[]) {
  const page = makePage(evaluateResults);
  const context = makeContext(page);
  const browser = makeBrowser([context]);
  playwrightMocks.importPlaywright.mockResolvedValue({ chromium: {} });
  playwrightMocks.launchChromium.mockResolvedValue(browser);
  return { page, context, browser };
}

function runAction(
  overrides: Partial<{
    clip: { x: number; y: number; width: number; height: number };
    html: string;
    height: number;
    scale: number;
    width: number;
  }> = {},
) {
  return action.run(
    {
      html: "<!doctype html><html><body>Design</body></html>",
      width: 800,
      height: 600,
      scale: 1,
      ...overrides,
    },
    { caller: "frontend" },
  );
}

describe("render-export-png action", () => {
  beforeEach(async () => {
    playwrightMocks.importPlaywright.mockReset();
    playwrightMocks.launchChromium.mockReset();
    vi.resetModules();
    ({ default: action } = await import("./render-export-png.js"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects an oversized embedded image before launching Chromium", async () => {
    const png = Buffer.from(onePixelPng);
    png.writeUInt32BE(20_000, 16);
    png.writeUInt32BE(2_000, 20);

    await expect(
      runAction({
        html: `<div style="background-image:url(data:image/png;base64,${png.toString("base64")})"></div>`,
      }),
    ).rejects.toMatchObject({ errorCode: "export_too_large", statusCode: 413 });
    expect(playwrightMocks.launchChromium).not.toHaveBeenCalled();
  });

  it("accepts bounded embedded PNG images", async () => {
    makeRenderer([undefined, completeResources, { width: 800, height: 600 }]);

    await expect(
      runAction({
        html: `<img src="data:image/png;base64,${onePixelPng.toString("base64")}">`,
      }),
    ).resolves.toMatchObject({ status: 200 });
    expect(playwrightMocks.launchChromium).toHaveBeenCalledOnce();
  });

  it("rejects a full-page raster over the pixel cap even when the viewport fits", async () => {
    const { page } = makeRenderer([
      undefined,
      completeResources,
      { width: 10_000, height: 7_000 },
    ]);

    await expect(
      action.run(
        {
          html: "<!doctype html><html><body></body></html>",
          width: 5_000,
          height: 5_000,
          scale: 1,
        },
        { caller: "frontend" },
      ),
    ).rejects.toThrow("PNG export exceeds the maximum raster size.");
    expect(page.screenshot).not.toHaveBeenCalled();
  });

  it("rasterizes only the requested crop from a document larger than the full-page cap", async () => {
    const { page } = makeRenderer([
      undefined,
      completeResources,
      { width: 10_000, height: 7_000 },
    ]);
    const clip = { x: 4_000, y: 6_000, width: 100, height: 80 };

    await runAction({ width: 5_000, height: 900, scale: 2, clip });

    expect(page.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({ clip, fullPage: false }),
    );
  });

  it("rejects a viewport over the pixel cap even when its crop fits", async () => {
    await expect(
      runAction({
        width: 10_000,
        height: 7_000,
        scale: 1,
        clip: { x: 4_000, y: 6_000, width: 100, height: 80 },
      }),
    ).rejects.toMatchObject({ errorCode: "export_too_large", statusCode: 413 });
    expect(playwrightMocks.launchChromium).not.toHaveBeenCalled();
  });

  it("rejects fonts that are still loading after the readiness timeout", async () => {
    const { page } = makeRenderer([
      undefined,
      {
        ...completeResources,
        loadingFonts: ["Wrenfield Display"],
      },
    ]);

    await expect(runAction()).rejects.toThrow(
      /PNG export snapshot has resources that could not be rendered exactly/,
    );
    expect(page.evaluate).toHaveBeenCalledTimes(2);
    expect(page.screenshot).not.toHaveBeenCalled();
  });

  it("maps browser launch failures to the typed Chromium-unavailable failure", async () => {
    playwrightMocks.importPlaywright.mockResolvedValue({ chromium: {} });
    playwrightMocks.launchChromium.mockRejectedValue(
      new Error("download failed"),
    );

    await expect(runAction()).rejects.toMatchObject({
      errorCode: "export_chromium_unavailable",
      statusCode: 503,
    });
  });

  it("returns a typed timeout before the serverless execution ceiling and closes a late browser", async () => {
    vi.useFakeTimers();
    const { browser } = makeRenderer([
      undefined,
      completeResources,
      { width: 800, height: 600 },
    ]);
    let resolveLaunch!: (value: typeof browser) => void;
    const launch = new Promise<typeof browser>((resolve) => {
      resolveLaunch = resolve;
    });
    playwrightMocks.launchChromium.mockReturnValue(launch);

    const request = runAction();
    const rejected = expect(request).rejects.toMatchObject({
      errorCode: "export_render_timeout",
      statusCode: 504,
    });
    await vi.advanceTimersByTimeAsync(45_000);
    await rejected;

    resolveLaunch(browser);
    await vi.waitFor(() => expect(browser.close).toHaveBeenCalledOnce());
  });

  it("reuses one browser while giving each call its own context", async () => {
    const firstPage = makePage([
      undefined,
      completeResources,
      { width: 800, height: 600 },
    ]);
    const secondPage = makePage([
      undefined,
      completeResources,
      { width: 800, height: 600 },
    ]);
    const contexts = [makeContext(firstPage), makeContext(secondPage)];
    const browser = makeBrowser(contexts);
    playwrightMocks.importPlaywright.mockResolvedValue({ chromium: {} });
    playwrightMocks.launchChromium.mockResolvedValue(browser);

    await runAction();
    await runAction();

    expect(playwrightMocks.launchChromium).toHaveBeenCalledOnce();
    expect(browser.newContext).toHaveBeenCalledTimes(2);
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(contexts[1].close).toHaveBeenCalledOnce();
    expect(browser.close).not.toHaveBeenCalled();
  });

  it("rejects render requests above the per-process concurrency cap", async () => {
    let finishSetContent!: () => void;
    const setContentGate = new Promise<void>((resolve) => {
      finishSetContent = resolve;
    });
    const firstPage = makePage([
      undefined,
      completeResources,
      { width: 800, height: 600 },
    ]);
    const secondPage = makePage([
      undefined,
      completeResources,
      { width: 800, height: 600 },
    ]);
    firstPage.setContent.mockReturnValue(setContentGate);
    secondPage.setContent.mockReturnValue(setContentGate);
    const browser = makeBrowser([
      makeContext(firstPage),
      makeContext(secondPage),
    ]);
    playwrightMocks.importPlaywright.mockResolvedValue({ chromium: {} });
    playwrightMocks.launchChromium.mockResolvedValue(browser);

    const first = runAction();
    const second = runAction();
    await vi.waitFor(() => expect(browser.newContext).toHaveBeenCalledTimes(2));

    await expect(runAction()).rejects.toMatchObject({
      errorCode: "export_render_busy",
      statusCode: 503,
    });

    finishSetContent();
    await Promise.all([first, second]);
  });

  it("holds a timed-out render slot until its context cleanup finishes", async () => {
    vi.useFakeTimers();
    let finishFirstSetContent!: () => void;
    let finishFirstClose!: () => void;
    const firstSetContent = new Promise<void>((resolve) => {
      finishFirstSetContent = resolve;
    });
    const firstContextClose = new Promise<void>((resolve) => {
      finishFirstClose = resolve;
    });
    let finishSecondSetContent!: () => void;
    const secondSetContent = new Promise<void>((resolve) => {
      finishSecondSetContent = resolve;
    });

    const firstPage = makePage([
      undefined,
      completeResources,
      { width: 800, height: 600 },
    ]);
    const firstContext = makeContext(firstPage);
    firstPage.setContent.mockReturnValue(firstSetContent);
    firstContext.close.mockReturnValue(firstContextClose);
    const firstBrowser = makeBrowser([firstContext]);
    let firstContextStarted!: () => void;
    const firstContextReady = new Promise<void>((resolve) => {
      firstContextStarted = resolve;
    });
    firstBrowser.newContext.mockImplementation(() => {
      firstContextStarted();
      return Promise.resolve(firstContext);
    });

    const secondPage = makePage([
      undefined,
      completeResources,
      { width: 800, height: 600 },
    ]);
    const secondContext = makeContext(secondPage);
    secondPage.setContent.mockReturnValue(secondSetContent);
    const sparePage = makePage([
      undefined,
      completeResources,
      { width: 800, height: 600 },
    ]);
    const spareContext = makeContext(sparePage);
    const secondBrowser = makeBrowser([secondContext, spareContext]);
    let secondContextStarted!: () => void;
    let secondContextCount = 0;
    const secondContextReady = new Promise<void>((resolve) => {
      secondContextStarted = resolve;
    });
    secondBrowser.newContext.mockImplementation(() => {
      secondContextStarted();
      return Promise.resolve(
        secondContextCount++ === 0 ? secondContext : spareContext,
      );
    });
    playwrightMocks.importPlaywright.mockResolvedValue({ chromium: {} });
    playwrightMocks.launchChromium
      .mockResolvedValueOnce(firstBrowser)
      .mockResolvedValueOnce(secondBrowser);

    const firstRequest = runAction();
    const firstTimeout = expect(firstRequest).rejects.toMatchObject({
      errorCode: "export_render_timeout",
      statusCode: 504,
    });
    await firstContextReady;
    await vi.advanceTimersByTimeAsync(45_000);
    await firstTimeout;

    const secondRequest = runAction();
    await secondContextReady;
    await expect(runAction()).rejects.toMatchObject({
      errorCode: "export_render_busy",
      statusCode: 503,
    });

    finishSecondSetContent();
    await secondRequest;
    finishFirstSetContent();
    finishFirstClose();
    await vi.advanceTimersByTimeAsync(0);
    await runAction();
  });

  it("preserves the typed rendering failure when context cleanup also fails", async () => {
    const { context } = makeRenderer([
      undefined,
      {
        ...completeResources,
        brokenImages: ["data:image/png;base64,broken"],
      },
    ]);
    context.close.mockRejectedValue(new Error("context cleanup failed"));

    await expect(runAction()).rejects.toMatchObject({
      errorCode: "export_resources_unavailable",
      statusCode: 424,
    });
  });
});
