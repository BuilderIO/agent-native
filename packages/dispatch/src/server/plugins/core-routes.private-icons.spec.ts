import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  use: vi.fn(),
  corePlugin: vi.fn(),
  iconHandler: vi.fn(),
  chatHandler: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  createCoreRoutesPlugin: () => mocks.corePlugin,
  getH3App: () => ({ use: mocks.use }),
}));
vi.mock("../lib/env-config.js", () => ({ envKeys: [] }));
vi.mock("../lib/onboarding-steps.js", () => ({
  registerDispatchOnboardingSteps: vi.fn(),
}));
vi.mock("../lib/private-icon-assets.js", () => ({
  createPrivateIconAssetsHandler: () => mocks.iconHandler,
}));
vi.mock("../lib/workspace-app-chat-proxy.js", () => ({
  createWorkspaceAppChatProxyHandler: () => mocks.chatHandler,
}));

import dispatchCoreRoutesPlugin from "./core-routes.js";

describe("Dispatch core route mounts", () => {
  it("mounts the private icon route consumed by the Dispatch template", () => {
    const nitroApp = {};
    dispatchCoreRoutesPlugin(nitroApp);
    expect(mocks.use).toHaveBeenCalledWith(
      "/_agent-native/private-icons",
      mocks.iconHandler,
    );
  });
});
