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

describe("brain auth plugin", () => {
  it("keeps workspace pages private while preserving signed ingest", () => {
    expect(authPlugin).toMatchObject({ kind: "auth-plugin" });
    expect(mocks.createAuthPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceAppAudience: "internal",
        workspaceAppPublicPaths: [],
        publicPaths: ["/api/_agent-native/brain/ingest"],
      }),
    );
  });
});
