import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authPlugin: vi.fn(),
  createAuthPlugin: vi.fn(),
  getDispatchConfig: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  createAuthPlugin: mocks.createAuthPlugin,
}));

vi.mock("../index.js", () => ({
  getDispatchConfig: mocks.getDispatchConfig,
}));

describe("dispatchAuthPlugin", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.authPlugin.mockReset();
    mocks.createAuthPlugin.mockReset();
    mocks.createAuthPlugin.mockReturnValue(mocks.authPlugin);
    mocks.getDispatchConfig.mockReset();
  });

  it("installs template public routes on the primary auth guard", async () => {
    const { default: dispatchAuthPlugin } = await import("./auth.js");
    const nitroApp = {};
    const publicPaths = [
      "/_agent-native/identity/authorize",
      "/_agent-native/org/apps",
    ];

    mocks.getDispatchConfig.mockReturnValue({
      auth: { googleOnly: true, publicPaths },
    });
    await dispatchAuthPlugin(nitroApp);

    expect(mocks.createAuthPlugin).toHaveBeenCalledOnce();
    expect(mocks.createAuthPlugin).toHaveBeenCalledWith(
      expect.objectContaining({ googleOnly: true, publicPaths }),
    );
    expect(mocks.authPlugin).toHaveBeenCalledWith(nitroApp);
  });
});
