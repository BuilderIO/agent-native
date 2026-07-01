import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAuthPlugin: vi.fn((options) => ({
    kind: "auth-plugin",
    options,
  })),
}));

vi.mock("@agent-native/core/server", () => ({
  createAuthPlugin: mocks.createAuthPlugin,
}));

import authPlugin from "./auth.js";

describe("design auth plugin", () => {
  it("lets signed-out public design pages load the native asset catalog", () => {
    expect(authPlugin).toMatchObject({ kind: "auth-plugin" });
    expect(mocks.createAuthPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        publicPaths: expect.arrayContaining([
          "/_agent-native/actions/get-design",
          "/_agent-native/actions/list-design-native-assets",
        ]),
      }),
    );
  });
});
