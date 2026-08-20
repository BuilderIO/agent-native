import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  autoMountAuth: vi.fn(),
  awaitBootstrap: vi.fn(),
  markFrameworkRoutesReadyBeforeBootstrap: vi.fn(),
  getH3App: vi.fn(),
  markDefaultPluginProvided: vi.fn(),
  runBetterAuthMigrations: vi.fn(),
  trackPluginInit: vi.fn(),
}));

vi.mock("./auth.js", () => ({
  autoMountAuth: mocks.autoMountAuth,
}));

vi.mock("./framework-request-handler.js", () => ({
  FRAMEWORK_AUTH_EARLY_PATHS: [
    "/_agent-native/auth",
    "/_agent-native/sign-in",
    "/_agent-native/login",
    "/_agent-native/signup",
  ],
  awaitBootstrap: mocks.awaitBootstrap,
  getH3App: mocks.getH3App,
  markDefaultPluginProvided: mocks.markDefaultPluginProvided,
  markFrameworkRoutesReadyBeforeBootstrap:
    mocks.markFrameworkRoutesReadyBeforeBootstrap,
  trackPluginInit: mocks.trackPluginInit,
}));

vi.mock("./better-auth-migrations.js", () => ({
  runBetterAuthMigrations: mocks.runBetterAuthMigrations,
}));

import { createAuthPlugin } from "./auth-plugin.js";

describe("createAuthPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.awaitBootstrap.mockResolvedValue(undefined);
    mocks.runBetterAuthMigrations.mockResolvedValue(undefined);
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
      {
        paths: [
          "/_agent-native/auth",
          "/_agent-native/sign-in",
          "/_agent-native/login",
          "/_agent-native/signup",
        ],
      },
    );

    const initPromise = mocks.trackPluginInit.mock.calls[0]?.[1];
    await initPromise;

    expect(mocks.awaitBootstrap).toHaveBeenCalledWith(nitroApp);
    expect(mocks.runBetterAuthMigrations).toHaveBeenCalledWith(nitroApp);
    expect(mocks.autoMountAuth).toHaveBeenCalledWith(h3App, options);
  });

  it("mounts BYOA auth before bootstrap or Better Auth migrations", async () => {
    const nitroApp = {};
    const h3App = { use: vi.fn() };
    const options = {
      loginHtml: "<form id=custom-login></form>",
      getSession: vi.fn(),
    };
    mocks.getH3App.mockReturnValue(h3App);

    createAuthPlugin(options)(nitroApp);

    const initPromise = mocks.trackPluginInit.mock.calls[0]?.[1];
    await initPromise;

    expect(mocks.autoMountAuth).toHaveBeenCalledWith(h3App, options);
    expect(mocks.markFrameworkRoutesReadyBeforeBootstrap).toHaveBeenCalledWith(
      nitroApp,
      [
        "/_agent-native/auth",
        "/_agent-native/sign-in",
        "/_agent-native/login",
        "/_agent-native/signup",
      ],
    );
    expect(mocks.awaitBootstrap).not.toHaveBeenCalled();
    expect(mocks.runBetterAuthMigrations).not.toHaveBeenCalled();
  });
});
