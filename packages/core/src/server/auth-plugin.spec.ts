import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  autoMountAuth: vi.fn(),
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
    "/",
    "/sign-in",
    "/_agent-native/sign-in",
    "/_agent-native/login",
    "/_agent-native/signup",
    "/login",
    "/signup",
  ],
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
    mocks.runBetterAuthMigrations.mockResolvedValue(undefined);
    mocks.autoMountAuth.mockResolvedValue(true);
  });

  it("marks the default (Better Auth) branch's routes ready before mounting, without awaiting unrelated default-plugin bootstrap", async () => {
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
    // Regression guard for the cold-start fix: the default branch must mark
    // its own routes ready — and must NOT serialize behind the shared
    // default-plugin bootstrap promise the way it used to (there is no
    // `awaitBootstrap` import left in auth-plugin.ts to call).
    expect(mocks.markFrameworkRoutesReadyBeforeBootstrap).toHaveBeenCalledWith(
      nitroApp,
      [
        "/_agent-native/auth",
        "/",
        "/sign-in",
        "/_agent-native/sign-in",
        "/_agent-native/login",
        "/_agent-native/signup",
        "/login",
        "/signup",
      ],
    );
    expect(mocks.trackPluginInit).toHaveBeenCalledWith(
      nitroApp,
      expect.any(Promise),
      {
        paths: [
          "/_agent-native/auth",
          "/",
          "/sign-in",
          "/_agent-native/sign-in",
          "/_agent-native/login",
          "/_agent-native/signup",
          "/login",
          "/signup",
        ],
      },
    );

    const initPromise = mocks.trackPluginInit.mock.calls[0]?.[1];
    await initPromise;

    expect(mocks.runBetterAuthMigrations).toHaveBeenCalledWith(nitroApp);
    expect(mocks.autoMountAuth).toHaveBeenCalledWith(h3App, options);
  });

  it("waits for Better Auth migrations to finish before mounting (dev/long-lived runtimes must provision schema first)", async () => {
    const nitroApp = {};
    const h3App = { use: vi.fn() };
    mocks.getH3App.mockReturnValue(h3App);
    let resolveMigrations!: () => void;
    mocks.runBetterAuthMigrations.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveMigrations = resolve;
      }),
    );

    createAuthPlugin()(nitroApp);
    const initPromise = mocks.trackPluginInit.mock.calls[0]?.[1];

    // Routes are marked ready immediately, but the mount itself must not
    // reach autoMountAuth until migrations settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.autoMountAuth).not.toHaveBeenCalled();

    resolveMigrations();
    await initPromise;

    expect(mocks.autoMountAuth).toHaveBeenCalled();
  });

  it("mounts BYOA auth before Better Auth migrations, and never runs migrations for BYOA", async () => {
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
        "/",
        "/sign-in",
        "/_agent-native/sign-in",
        "/_agent-native/login",
        "/_agent-native/signup",
        "/login",
        "/signup",
      ],
    );
    expect(mocks.runBetterAuthMigrations).not.toHaveBeenCalled();
  });

  it("marks BYOA routes before an asynchronous mount promise settles", async () => {
    const nitroApp = {};
    const h3App = { use: vi.fn() };
    const options = { getSession: vi.fn() };
    let resolveMount!: (value: boolean) => void;
    mocks.autoMountAuth.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveMount = resolve;
      }),
    );
    mocks.getH3App.mockReturnValue(h3App);

    createAuthPlugin(options)(nitroApp);

    expect(mocks.markFrameworkRoutesReadyBeforeBootstrap).toHaveBeenCalledWith(
      nitroApp,
      [
        "/_agent-native/auth",
        "/",
        "/sign-in",
        "/_agent-native/sign-in",
        "/_agent-native/login",
        "/_agent-native/signup",
        "/login",
        "/signup",
      ],
    );

    resolveMount(true);
    await mocks.trackPluginInit.mock.calls[0]?.[1];
  });
});
