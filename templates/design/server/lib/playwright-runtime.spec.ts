import { afterEach, describe, expect, it, vi } from "vitest";

const serverMocks = vi.hoisted(() => ({
  requestBuilderBrowserConnection: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => serverMocks);

import { launchChromium, type PlaywrightModule } from "./playwright-runtime.js";

afterEach(() => vi.resetAllMocks());

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
});
