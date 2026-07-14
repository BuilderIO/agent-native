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
  });

  it("tracks auth initialization before awaiting bootstrap", async () => {
    let releaseBootstrap: () => void = () => {};
    mocks.awaitBootstrap.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseBootstrap = resolve;
        }),
    );
    const nitroApp = {};
    const h3App = {};
    mocks.getH3App.mockReturnValue(h3App);

    const pluginPromise = createAuthPlugin({ publicPaths: ["/public"] })(
      nitroApp,
    );

    expect(mocks.markDefaultPluginProvided).toHaveBeenCalledWith(
      nitroApp,
      "auth",
    );
    expect(mocks.trackPluginInit).toHaveBeenCalledTimes(1);
    expect(mocks.trackPluginInit).toHaveBeenCalledWith(
      nitroApp,
      expect.any(Promise),
      expect.objectContaining({
        paths: expect.arrayContaining([
          "/_agent-native/auth",
          "/_agent-native/sign-in",
        ]),
      }),
    );
    expect(mocks.autoMountAuth).not.toHaveBeenCalled();

    releaseBootstrap();
    await pluginPromise;

    expect(mocks.autoMountAuth).toHaveBeenCalledWith(h3App, {
      publicPaths: ["/public"],
    });
    await expect(
      mocks.trackPluginInit.mock.calls[0][1],
    ).resolves.toBeUndefined();
  });

  it("rejects the tracked readiness promise when auth mounting fails", async () => {
    const error = new Error("auth failed");
    mocks.awaitBootstrap.mockResolvedValue(undefined);
    mocks.getH3App.mockReturnValue({});
    mocks.autoMountAuth.mockRejectedValue(error);

    const pluginPromise = createAuthPlugin()({});
    const trackedPromise = mocks.trackPluginInit.mock
      .calls[0][1] as Promise<void>;

    await expect(pluginPromise).rejects.toThrow("auth failed");
    await expect(trackedPromise).rejects.toThrow("auth failed");
  });
});
