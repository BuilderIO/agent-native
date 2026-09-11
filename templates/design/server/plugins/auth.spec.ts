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
  it("lets signed-out viewers open presentation routes", () => {
    expect(authPlugin).toMatchObject({ kind: "auth-plugin" });
    expect(mocks.createAuthPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceAppPublicPaths: expect.arrayContaining(["/present"]),
      }),
    );
  });

  it("lets signed-out viewers read designs, assets, and review comments", () => {
    expect(mocks.createAuthPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        publicPaths: expect.arrayContaining([
          "/_agent-native/actions/get-design",
          "/_agent-native/actions/list-design-native-assets",
          "/_agent-native/actions/list-review-comments",
        ]),
      }),
    );
  });

  it("does not expose review comment mutations", () => {
    const options = mocks.createAuthPlugin.mock.calls[0]?.[0];

    expect(options.publicPaths).not.toEqual(
      expect.arrayContaining([
        "/_agent-native/actions/create-review-comment",
        "/_agent-native/actions/reply-review-comment",
        "/_agent-native/actions/resolve-review-thread",
        "/_agent-native/actions/delete-review-comment",
      ]),
    );
  });
});
