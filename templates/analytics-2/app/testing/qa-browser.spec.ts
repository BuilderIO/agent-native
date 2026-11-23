import { beforeEach, describe, expect, it, vi } from "vitest";

const { launch, connectOverCDP, startProxy, closeProxy, closeBrowser } =
  vi.hoisted(() => ({
    launch: vi.fn(),
    connectOverCDP: vi.fn(),
    startProxy: vi.fn(),
    closeProxy: vi.fn(),
    closeBrowser: vi.fn(),
  }));

vi.mock("@playwright/test", () => ({
  chromium: { launch, connectOverCDP },
}));
vi.mock("../../e2e/qa-cdp-proxy.js", () => ({
  qaBrowserEndpoint: vi.fn(),
  startOwnedQaCdpProxy: startProxy,
}));

import { openQaBrowser } from "../../e2e/qa-browser.js";

describe("report A2-CORE-QA-BROWSER-CUSTODY-1121", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startProxy.mockResolvedValue({
      endpoint: "http://127.0.0.1:1234",
      close: closeProxy,
    });
    connectOverCDP.mockResolvedValue({ close: closeBrowser, on: vi.fn() });
  });

  it("connects through the owned proxy and closes the connection without launching a browser", async () => {
    const browser = await openQaBrowser();
    expect(launch).not.toHaveBeenCalled();
    expect(connectOverCDP).toHaveBeenCalledWith("http://127.0.0.1:1234");
    await browser.close();
    expect(closeBrowser).toHaveBeenCalledOnce();
    expect(closeProxy).toHaveBeenCalledOnce();
  });

  it("closes the owned proxy when connecting fails", async () => {
    connectOverCDP.mockRejectedValueOnce(new Error("connection failed"));
    await expect(openQaBrowser()).rejects.toThrow("connection failed");
    expect(closeProxy).toHaveBeenCalledOnce();
    expect(launch).not.toHaveBeenCalled();
  });
});
