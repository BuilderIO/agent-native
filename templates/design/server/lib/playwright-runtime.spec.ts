import { afterEach, describe, expect, it, vi } from "vitest";

const serverMocks = vi.hoisted(() => ({
  requestBuilderBrowserConnection: vi.fn(),
}));
const serverlessChromiumMocks = vi.hoisted(() => ({
  chromiumPackUrl: vi.fn(),
  loadOptionalServerlessChromium: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => serverMocks);
vi.mock(
  "@agent-native/creative-context/connectors/serverless-chromium",
  () => serverlessChromiumMocks,
);

import {
  importPlaywright,
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
        launch: vi.fn(),
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
    expect(connectOverCDP).toHaveBeenCalledWith(
      "wss://browser.example.test/cdp",
    );
  });
});

describe("launchChromium", () => {
  it("uses Builder Browser before trying local Chromium", async () => {
    const browser = {};
    const connectOverCDP = vi.fn().mockResolvedValue(browser);
    const launch = vi.fn();
    const chromium = {
      connectOverCDP,
      launch,
    } as unknown as PlaywrightModule["chromium"];
    serverMocks.requestBuilderBrowserConnection.mockResolvedValue({
      wsUrl: "wss://browser.example.test/cdp",
    });

    await expect(launchChromium(chromium)).resolves.toBe(browser);

    expect(serverMocks.requestBuilderBrowserConnection).toHaveBeenCalledWith({
      sessionId: expect.stringMatching(/^design-render-/),
    });
    expect(connectOverCDP).toHaveBeenCalledWith(
      "wss://browser.example.test/cdp",
    );
    expect(launch).not.toHaveBeenCalled();
  });

  it("falls back to local Chromium when Builder Browser is unavailable", async () => {
    const browser = {};
    const launch = vi.fn().mockResolvedValue(browser);
    const chromium = {
      connectOverCDP: vi.fn(),
      launch,
    } as unknown as PlaywrightModule["chromium"];
    serverMocks.requestBuilderBrowserConnection.mockRejectedValue(
      new Error("Builder Browser unavailable"),
    );

    await expect(launchChromium(chromium)).resolves.toBe(browser);
    expect(launch).toHaveBeenCalledWith({ args: ["--no-sandbox"] });
  });

  it("launches the packaged Chromium binary when the host has no browser", async () => {
    const browser = {};
    const launch = vi
      .fn()
      .mockRejectedValueOnce(new Error("Executable doesn't exist at /missing"))
      .mockResolvedValueOnce(browser);
    const executablePath = vi.fn().mockResolvedValue("/tmp/chromium");
    const chromium = {
      connectOverCDP: vi.fn(),
      launch,
    } as unknown as PlaywrightModule["chromium"];
    serverMocks.requestBuilderBrowserConnection.mockRejectedValue(
      new Error("Builder Browser unavailable"),
    );
    serverlessChromiumMocks.chromiumPackUrl.mockReturnValue(
      "https://example.test/chromium.tar",
    );
    serverlessChromiumMocks.loadOptionalServerlessChromium.mockResolvedValue({
      args: ["--disable-dev-shm-usage"],
      executablePath,
    });

    await expect(launchChromium(chromium)).resolves.toBe(browser);

    expect(executablePath).toHaveBeenCalledWith(
      "https://example.test/chromium.tar",
    );
    expect(launch).toHaveBeenNthCalledWith(1, { args: ["--no-sandbox"] });
    expect(launch).toHaveBeenNthCalledWith(2, {
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
      executablePath: "/tmp/chromium",
    });
  });
});
