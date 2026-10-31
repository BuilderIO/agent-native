import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  corePlugin: vi.fn(),
  createAuthPlugin: vi.fn((_options) => mocks.corePlugin),
}));

vi.mock("@agent-native/core/server", () => ({
  createAuthPlugin: mocks.createAuthPlugin,
}));

import authPlugin from "./auth.js";

describe("Content auth plugin", () => {
  it("lets only the scoped Trash worker bypass session auth", () => {
    const nitroApp = { hooks: { hook: vi.fn() } };
    void authPlugin(nitroApp);
    expect(mocks.corePlugin).toHaveBeenCalledWith(nitroApp);
    const options = mocks.createAuthPlugin.mock.calls[0]?.[0];
    expect(options.publicPaths).toContain(
      "/api/_agent-native-background/content-trash-purge-worker",
    );
    expect(options.publicPaths).not.toContain("/api/_agent-native-background");
    expect(options.publicPaths).not.toContain(
      "/api/_agent-native-background/other-worker",
    );
    expect(options.publicPaths).toContain("/api/private-icons/");
  });
});
