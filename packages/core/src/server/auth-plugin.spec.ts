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

  it("tracks auth initialization before waiting for async bootstrap", async () => {
    let releaseBootstrap: () => void = () => {};
    mocks.awaitBootstrap.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseBootstrap = resolve;
        }),
    );
    const nitroApp = {};
    const h3App = { use: vi.fn() };
    mocks.getH3App.mockReturnValue(h3App);
    const options = { publicPaths: ["/p"] };

    const init = createAuthPlugin(options)(nitroApp);

    expect(mocks.markDefaultPluginProvided).toHaveBeenCalledWith(
      nitroApp,
      "auth",
    );
    expect(mocks.trackPluginInit).toHaveBeenCalledWith(
      nitroApp,
      expect.any(Promise),
      {
        paths: [
          "/_agent-native/auth",
          "/_agent-native/sign-in",
          "/login",
          "/signup",
        ],
      },
    );
    expect(mocks.autoMountAuth).not.toHaveBeenCalled();

    releaseBootstrap();
    await init;

    expect(mocks.autoMountAuth).toHaveBeenCalledWith(h3App, options);
  });
});
