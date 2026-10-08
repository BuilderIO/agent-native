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
    // The template's own public routes must reach the auth guard, and the
    // Dispatch workspace root must stay public alongside them.
    expect(mocks.createAuthPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        googleOnly: true,
        publicPaths: [...publicPaths, "/_agent-native/private-icons"],
        workspaceAppPublicPaths: ["/"],
      }),
    );
    expect(mocks.authPlugin).toHaveBeenCalledWith(nitroApp);
  });

  it("merges consumer marketing overrides with package defaults", async () => {
    const { default: dispatchAuthPlugin } = await import("./auth.js");

    mocks.getDispatchConfig.mockReturnValue({
      auth: {
        marketing: {
          learnMoreUrl: "https://agent-native.com/apps/dispatch",
        },
      },
    });
    await dispatchAuthPlugin({});

    expect(mocks.createAuthPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        marketing: expect.objectContaining({
          appName: "Dispatch",
          tagline:
            "Your AI agent manages secrets, orchestrates other agents, and routes messages across your workspace.",
          learnMoreUrl: "https://agent-native.com/apps/dispatch",
        }),
      }),
    );
  });
});
