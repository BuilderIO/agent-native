import { afterEach, describe, expect, it, vi } from "vitest";

const serverMocks = vi.hoisted(() => ({
  requestBuilderBrowserConnection: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => serverMocks);

import {
  ChromiumUnavailableError,
  importPlaywright,
  isMissingBrowserError,
  launchChromium,
  type PlaywrightModule,
} from "./playwright-runtime.js";

afterEach(() => vi.resetAllMocks());

describe("importPlaywright", () => {
  it("uses playwright-core when the serverless bundle omits playwright", async () => {
    const browser = {};
    const connectOverCDP = vi.fn().mockResolvedValue(browser);
    const imported = {
      chromium: {
        connectOverCDP,
        launch: vi.fn().mockResolvedValue(browser),
      } as unknown as PlaywrightModule["chromium"],
    };
    const attempts: string[] = [];
    serverMocks.requestBuilderBrowserConnection.mockResolvedValue({
      wsUrl: "wss://browser.example.test/cdp",
    });

    const result = await importPlaywright(async (specifier) => {
      attempts.push(specifier);
      if (specifier === "playwright-core") return imported;
      throw new Error(`Cannot find package '${specifier}'`);
    });

    expect(result).toBe(imported);
    expect(attempts).toEqual(["playwright", "playwright-core"]);
    await expect(launchChromium(result.chromium)).resolves.toBe(browser);
    expect(serverMocks.requestBuilderBrowserConnection).not.toHaveBeenCalled();
    expect(connectOverCDP).not.toHaveBeenCalled();
  });
});

describe("launchChromium", () => {
  it("uses sandboxed local Chromium without requesting a remote browser when available", async () => {
    const browser = {};
    const connectOverCDP = vi.fn().mockResolvedValue(browser);
    const launch = vi.fn().mockResolvedValue(browser);
    const chromium = {
      connectOverCDP,
      launch,
    } as unknown as PlaywrightModule["chromium"];
    serverMocks.requestBuilderBrowserConnection.mockResolvedValue({
      wsUrl: "wss://browser.example.test/cdp",
    });

    await expect(launchChromium(chromium)).resolves.toBe(browser);

    expect(launch).toHaveBeenCalledWith({ chromiumSandbox: true });
    expect(serverMocks.requestBuilderBrowserConnection).not.toHaveBeenCalled();
    expect(connectOverCDP).not.toHaveBeenCalled();
  });

  it("uses a bounded Builder Browser connection when local Chromium is unavailable", async () => {
    const browser = {};
    const launch = vi
      .fn()
      .mockRejectedValue(new Error("Executable doesn't exist"));
    const connectOverCDP = vi.fn().mockResolvedValue(browser);
    const chromium = {
      connectOverCDP,
      launch,
    } as unknown as PlaywrightModule["chromium"];
    serverMocks.requestBuilderBrowserConnection.mockResolvedValue({
      wsUrl: "wss://browser.example.test/cdp",
    });
    await expect(launchChromium(chromium)).resolves.toBe(browser);
    expect(launch).toHaveBeenCalledWith({ chromiumSandbox: true });
    expect(serverMocks.requestBuilderBrowserConnection).toHaveBeenCalledWith({
      sessionId: expect.stringMatching(/^design-render-/),
    });
    expect(connectOverCDP).toHaveBeenCalledWith(
      "wss://browser.example.test/cdp",
      { timeout: 30_000 },
    );
    expect(launch.mock.invocationCallOrder[0]).toBeLessThan(
      serverMocks.requestBuilderBrowserConnection.mock.invocationCallOrder[0],
    );
  });

  it("fails closed with a typed error when no safe renderer is available", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const launch = vi.fn().mockRejectedValue(new Error("sandbox unavailable"));
    const chromium = {
      connectOverCDP: vi.fn(),
      launch,
    } as unknown as PlaywrightModule["chromium"];
    serverMocks.requestBuilderBrowserConnection.mockRejectedValue(
      new Error("Builder Browser unavailable"),
    );
    const launchPromise = launchChromium(chromium);
    await expect(launchPromise).rejects.toBeInstanceOf(
      ChromiumUnavailableError,
    );
    await expect(launchPromise).rejects.toMatchObject({
      code: "chromium_unavailable",
      message: expect.stringContaining("Chromium unavailable:"),
    });
    await expect(launchPromise).rejects.toMatchObject({
      message: expect.stringContaining(
        "Builder Browser unavailable: Builder Browser unavailable; sandboxed local Chromium unavailable: sandbox unavailable",
      ),
    });
    expect(
      isMissingBrowserError(
        new ChromiumUnavailableError(new Error("connection unavailable")),
      ),
    ).toBe(true);
    expect(launch).toHaveBeenCalledWith({ chromiumSandbox: true });
    expect(errorLog).toHaveBeenCalledWith(
      "Design export could not launch sandboxed local Chromium:",
      expect.objectContaining({ message: "sandbox unavailable" }),
    );
  });
});
