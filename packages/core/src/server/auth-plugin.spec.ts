import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  autoMountAuth: vi.fn(),
  awaitBootstrap: vi.fn(),
  getH3App: vi.fn(),
  markDefaultPluginProvided: vi.fn(),
  trackPluginInit: vi.fn(),
}));

vi.mock("./auth.js", () => ({
  autoMountAuth: mocks.autoMountAuth,
}));

vi.mock("./framework-request-handler.js", () => ({
  awaitBootstrap: mocks.awaitBootstrap,
  getH3App: mocks.getH3App,
  markDefaultPluginProvided: mocks.markDefaultPluginProvided,
  trackPluginInit: mocks.trackPluginInit,
}));

import { createAuthPlugin } from "./auth-plugin.js";

describe("createAuthPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.awaitBootstrap.mockResolvedValue(undefined);
    mocks.autoMountAuth.mockResolvedValue(true);
  });

  it("tracks auth initialization before its routes mount", async () => {
    const nitroApp = {};
    const h3App = { use: vi.fn() };
    const options = { publicPaths: ["/public"] };
    mocks.getH3App.mockReturnValue(h3App);

    const result = createAuthPlugin(options)(nitroApp);

    expect(result).toBeUndefined();
    expect(mocks.markDefaultPluginProvided).toHaveBeenCalledWith(
      nitroApp,
      "auth",
    );
    expect(mocks.trackPluginInit).toHaveBeenCalledWith(
      nitroApp,
      expect.any(Promise),
      { paths: ["/_agent-native/auth"] },
    );

    const initPromise = mocks.trackPluginInit.mock.calls[0]?.[1];
    await initPromise;

    expect(mocks.awaitBootstrap).toHaveBeenCalledWith(nitroApp);
    expect(mocks.autoMountAuth).toHaveBeenCalledWith(h3App, options);
  });
});
