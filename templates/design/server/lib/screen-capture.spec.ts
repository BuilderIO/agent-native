import { describe, expect, it, vi } from "vitest";

vi.mock("../db/index.js", () => ({
  getDb: vi.fn(),
  schema: { designFiles: {} },
}));
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  and: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
}));
vi.mock("../source-workspace.js", () => ({ readLiveSourceFile: vi.fn() }));
vi.mock("./playwright-runtime.js", () => ({
  importPlaywright: vi.fn(),
  launchChromium: vi.fn(),
}));
vi.mock("./design-to-figma-svg.js", () => ({
  routeAllowedRenderRequests: vi.fn(async () => ({ blockedNavigations: [] })),
}));
vi.mock("./screenshot-readiness.js", () => ({
  prepareScreenshotPage: vi.fn(async () => {}),
}));

import { getDb } from "../db/index.js";
import { readLiveSourceFile } from "../source-workspace.js";
import { importPlaywright, launchChromium } from "./playwright-runtime.js";
import {
  fitsCapturePixelBudget,
  loadCaptureScreens,
  loadStatusScreens,
  pngSize,
  renderScreenPng,
  screenFingerprint,
  screenName,
  screenWidthPx,
  visibilityForRequest,
} from "./screen-capture.js";

describe("visibilityForRequest", () => {
  it("keeps public and private as Design stores them", () => {
    expect(visibilityForRequest("public", "org-1", null)).toBe("public");
    expect(visibilityForRequest("private", "org-1", "org-1")).toBe("private");
  });

  it("counts an organization share only for that organization", () => {
    expect(visibilityForRequest("org", "org-1", "org-1")).toBe("org");
    expect(visibilityForRequest("org", "org-1", "org-2")).toBe("private");
    expect(visibilityForRequest("org", null, "org-1")).toBe("private");
    expect(visibilityForRequest("org", "org-1", null)).toBe("private");
  });

  it("reads anything else as private", () => {
    expect(visibilityForRequest(undefined, null, null)).toBe("private");
    expect(visibilityForRequest("everyone", "org-1", "org-1")).toBe("private");
  });
});

describe("screenWidthPx", () => {
  it("prefers the screen's own width over its canvas frame", () => {
    expect(
      screenWidthPx(
        {
          screenMetadata: { s1: { width: 390 } },
          canvasFrames: { s1: { x: 0, y: 0, width: 320, height: 600 } },
        },
        "s1",
      ),
    ).toBe(390);
  });

  it("falls back to 1440 and keeps widths in range", () => {
    expect(screenWidthPx({}, "s1")).toBe(1440);
    expect(screenWidthPx({ screenMetadata: { s1: { width: 50 } } }, "s1")).toBe(
      200,
    );
    expect(
      screenWidthPx({ screenMetadata: { s1: { width: 9000 } } }, "s1"),
    ).toBe(3840);
    expect(screenWidthPx({ screenMetadata: "broken" }, "s1")).toBe(1440);
  });
});

describe("screenName", () => {
  it("names a screen by its file name", () => {
    expect(screenName("Checkout.html")).toBe("Checkout");
    expect(screenName("flows/cart/Summary.htm")).toBe("Summary");
    expect(screenName(".html")).toBe(".html");
  });
});

describe("screenFingerprint", () => {
  const data = { screenMetadata: { s1: { width: 1440 } } };

  it("is stable for the same screen", () => {
    const one = screenFingerprint({ content: "<main>Hi</main>" }, data, "s1");
    expect(one).toMatch(/^[a-f0-9]{12}$/);
    expect(screenFingerprint({ content: "<main>Hi</main>" }, data, "s1")).toBe(
      one,
    );
  });

  it("moves when the source or the screen's frame changes", () => {
    const one = screenFingerprint({ content: "<main>Hi</main>" }, data, "s1");
    expect(
      screenFingerprint({ content: "<main>Hello</main>" }, data, "s1"),
    ).not.toBe(one);
    expect(
      screenFingerprint(
        { content: "<main>Hi</main>" },
        { screenMetadata: { s1: { width: 390 } } },
        "s1",
      ),
    ).not.toBe(one);
  });

  it("ignores bookkeeping that doesn't change the picture", () => {
    const one = screenFingerprint({ content: "<main>Hi</main>" }, data, "s1");
    expect(
      screenFingerprint(
        { content: "<main>Hi</main>" },
        {
          screenMetadata: {
            s1: { width: 1440, lod: "full", status: "ready", title: "Pay" },
          },
        },
        "s1",
      ),
    ).toBe(one);
  });

  it("ignores the design's other screens", () => {
    const one = screenFingerprint({ content: "<main>Hi</main>" }, data, "s1");
    expect(
      screenFingerprint(
        { content: "<main>Hi</main>" },
        { screenMetadata: { s1: { width: 1440 }, s2: { width: 390 } } },
        "s1",
      ),
    ).toBe(one);
  });
});

describe("pngSize", () => {
  it("reads the size from the PNG header", () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    png.write("IHDR", 12, "ascii");
    png.writeUInt32BE(2880, 16);
    png.writeUInt32BE(1800, 20);
    expect(pngSize(png)).toEqual({ width: 2880, height: 1800 });
  });

  it("refuses bytes that aren't a PNG", () => {
    expect(() => pngSize(Buffer.from("not a png"))).toThrow("Not a PNG");
  });
});

describe("loadCaptureScreens", () => {
  it("reads each screen as its editors have it now, not as last saved", async () => {
    const saved = {
      id: "s1",
      designId: "d1",
      filename: "Pay.html",
      fileType: "html",
      content: "<main>Saved</main>",
      createdAt: null,
      updatedAt: null,
    };
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: () => ({
          where: async () => [saved, { ...saved, id: "s2", fileType: "css" }],
        }),
      }),
    } as never);
    vi.mocked(readLiveSourceFile).mockResolvedValueOnce({
      content: "<main>Live</main>",
    } as never);
    const screens = await loadCaptureScreens("d1", ["s1", "s2"]);
    expect([...screens.keys()]).toEqual(["s1"]);
    expect(screens.get("s1")).toEqual({
      id: "s1",
      filename: "Pay.html",
      content: "<main>Live</main>",
    });
    expect(readLiveSourceFile).toHaveBeenCalledWith(saved);
  });

  it("reads status past a screen whose live source can't be read", async () => {
    const saved = {
      id: "s1",
      designId: "d1",
      filename: "Pay.html",
      fileType: "html",
      content: "<main>Saved</main>",
      createdAt: null,
      updatedAt: null,
    };
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: () => ({
          where: async () => [saved, { ...saved, id: "s2" }],
        }),
      }),
    } as never);
    vi.mocked(readLiveSourceFile).mockImplementation(async (row) => {
      if (row.id === "s1") throw new Error("collab store is down");
      return { content: "<main>Live</main>" } as never;
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const screens = await loadStatusScreens("d1", ["s1", "s2"]);
    expect(screens.get("s1")).toBeNull();
    expect(screens.get("s2")?.content).toBe("<main>Live</main>");
    expect(warn).toHaveBeenCalledTimes(1);
    await expect(loadCaptureScreens("d1", ["s1", "s2"])).rejects.toThrow(
      "collab store is down",
    );
    warn.mockRestore();
    vi.mocked(readLiveSourceFile).mockReset();
  });
});

describe("renderScreenPng", () => {
  it("refuses a screen with live effects before starting a browser", async () => {
    await expect(
      renderScreenPng(
        {
          id: "s1",
          filename: "Glow.html",
          content:
            '<main>Glow</main><script type="application/x-agent-native-effects">{bad}</script>',
        },
        1440,
      ),
    ).rejects.toMatchObject({ errorCode: "design_screen_live_effects" });
    expect(importPlaywright).not.toHaveBeenCalled();
  });

  it("refuses a screen that shows a running app from its address", async () => {
    await expect(
      renderScreenPng(
        {
          id: "s1",
          filename: "Pricing.html",
          content: "  http://localhost:3000/pricing\n",
        },
        1440,
      ),
    ).rejects.toMatchObject({ errorCode: "design_screen_live_app" });
    expect(importPlaywright).not.toHaveBeenCalled();
  });

  function fakeBrowser(pageArea: number, { hang = false } = {}) {
    const scales: number[] = [];
    const viewports: { width: number; height: number }[] = [];
    const screenshot = vi.fn(async () => Buffer.alloc(100));
    const evaluate = vi.fn();
    vi.mocked(importPlaywright).mockResolvedValue({ chromium: {} } as never);
    vi.mocked(launchChromium).mockImplementation(async () => {
      let markClosed: () => void = () => {};
      const closed = new Promise<void>((resolve) => {
        markClosed = resolve;
      });
      return {
        newContext: vi.fn(
          async ({
            viewport,
            deviceScaleFactor,
          }: {
            viewport: { width: number; height: number };
            deviceScaleFactor: number;
          }) => {
            scales.push(deviceScaleFactor);
            viewports.push(viewport);
            return {
              addInitScript: vi.fn(async () => {}),
              routeWebSocket: vi.fn(async () => {}),
              newPage: vi.fn(async () => ({
                evaluate: async () => {
                  evaluate();
                  if (!hang) return pageArea;
                  await closed;
                  throw new Error(
                    "Target page, context or browser has been closed",
                  );
                },
                screenshot,
              })),
              close: vi.fn(async () => {}),
            };
          },
        ),
        close: vi.fn(async () => markClosed()),
      } as never;
    });
    return { scales, viewports, screenshot, evaluate };
  }

  const tallScreen = {
    id: "s1",
    filename: "Tall.html",
    content: "<main>Tall</main>",
  };

  it("takes a screen that fits the pixel budget at twice its size", async () => {
    const { scales, screenshot } = fakeBrowser(1440 * 6000);
    await expect(renderScreenPng(tallScreen, 1440)).resolves.toHaveLength(100);
    expect(scales).toEqual([2]);
    expect(screenshot).toHaveBeenCalledTimes(1);
  });

  it("drops to its own size when twice its size is over the pixel budget", async () => {
    const { scales, screenshot } = fakeBrowser(1440 * 8000);
    await expect(renderScreenPng(tallScreen, 1440)).resolves.toHaveLength(100);
    expect(scales).toEqual([2, 1]);
    expect(screenshot).toHaveBeenCalledTimes(1);
  });

  it("refuses a screen over the pixel budget before taking any screenshot", async () => {
    const { scales, screenshot } = fakeBrowser(1440 * 30_000);
    await expect(renderScreenPng(tallScreen, 1440)).rejects.toMatchObject({
      errorCode: "design_screen_too_large",
    });
    expect(scales).toEqual([2, 1]);
    expect(screenshot).not.toHaveBeenCalled();
  });
  it("opens each screen at the window height Design's canvas gives its width", async () => {
    const { viewports } = fakeBrowser(390 * 2000);
    await renderScreenPng(tallScreen, 390);
    await renderScreenPng(tallScreen, 768);
    await renderScreenPng(tallScreen, 1440);
    expect(viewports).toEqual([
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ]);
  });

  it("gives up on screens whose page work never settles and frees their slots", async () => {
    vi.useFakeTimers();
    try {
      const page = fakeBrowser(1440 * 6000, { hang: true });
      const stuck = [
        renderScreenPng(tallScreen, 1440),
        renderScreenPng(tallScreen, 1440),
      ].map((render) =>
        expect(render).rejects.toMatchObject({
          errorCode: "design_screen_render_timeout",
        }),
      );
      await vi.waitFor(() => expect(page.evaluate).toHaveBeenCalledTimes(2));
      await vi.advanceTimersByTimeAsync(50_000);
      await Promise.all(stuck);
    } finally {
      vi.useRealTimers();
    }
    fakeBrowser(1440 * 6000);
    await expect(renderScreenPng(tallScreen, 1440)).resolves.toHaveLength(100);
  });

  it("stops a render the caller called off and frees its slot", async () => {
    const page = fakeBrowser(1440 * 6000, { hang: true });
    const controller = new AbortController();
    const stuck = [
      renderScreenPng(tallScreen, 1440, controller.signal),
      renderScreenPng(tallScreen, 1440, controller.signal),
    ].map((render) =>
      expect(render).rejects.toMatchObject({
        errorCode: "design_screen_render_timeout",
      }),
    );
    await vi.waitFor(() => expect(page.evaluate).toHaveBeenCalledTimes(2));
    controller.abort();
    await Promise.all(stuck);
    fakeBrowser(1440 * 6000);
    await expect(renderScreenPng(tallScreen, 1440)).resolves.toHaveLength(100);
  });

  it("takes two screens at a time and asks a third to try again", async () => {
    const { screenshot } = fakeBrowser(1440 * 6000);
    let finish: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    screenshot.mockImplementation(async () => {
      await held;
      return Buffer.alloc(100);
    });
    const first = renderScreenPng(tallScreen, 1440);
    const second = renderScreenPng(tallScreen, 1440);
    await expect(renderScreenPng(tallScreen, 1440)).rejects.toMatchObject({
      errorCode: "design_screen_render_busy",
    });
    finish();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    await expect(renderScreenPng(tallScreen, 1440)).resolves.toHaveLength(100);
  });
});

describe("fitsCapturePixelBudget", () => {
  it("counts device pixels and refuses a size it can't read", () => {
    expect(fitsCapturePixelBudget(1440 * 6000, 2)).toBe(true);
    expect(fitsCapturePixelBudget(1440 * 8000, 2)).toBe(false);
    expect(fitsCapturePixelBudget(1440 * 8000, 1)).toBe(true);
    expect(fitsCapturePixelBudget(Number.NaN, 1)).toBe(false);
  });
});
