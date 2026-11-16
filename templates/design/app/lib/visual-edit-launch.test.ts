import { afterEach, describe, expect, it, vi } from "vitest";

import { dispatchVisualEditBrowserLaunch } from "./visual-edit-launch.js";

const launch = {
  target: "system-browser" as const,
  status: "host-required" as const,
  browserUrl: "https://design.example.test/_agent-native/open?app=design",
  desktopUrl: "agentnative://open?app=design",
};
afterEach(() => {
  vi.unstubAllGlobals();
});
describe("visual edit browser host launch", () => {
  it("uses a host external opener when available", async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", { openai: { openExternal } });
    expect((await dispatchVisualEditBrowserLaunch(launch)).status).toBe(
      "dispatched",
    );
    expect(openExternal).toHaveBeenCalledWith({ href: launch.browserUrl });
  });
  it("reports unknown desktop installation without trying a protocol URL", async () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    expect(
      await dispatchVisualEditBrowserLaunch({ ...launch, target: "desktop" }),
    ).toMatchObject({
      status: "desktop-not-detected",
      browserUrl: launch.browserUrl,
    });
    expect(open).not.toHaveBeenCalled();
  });
  it("dispatches desktop launches through the desktop preload shell API", async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", {
      agentNativeDesktop: {},
      electronAPI: { shell: { openExternal } },
      location: { assign: vi.fn() },
    });
    expect(
      (await dispatchVisualEditBrowserLaunch({ ...launch, target: "desktop" }))
        .status,
    ).toBe("dispatched");
    expect(openExternal).toHaveBeenCalledWith(launch.desktopUrl);
  });

  it("preserves normal browser navigation when no external opener exists", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });
    expect((await dispatchVisualEditBrowserLaunch(launch)).status).toBe(
      "dispatched",
    );
    expect(assign).toHaveBeenCalledWith(launch.browserUrl);
  });
});
