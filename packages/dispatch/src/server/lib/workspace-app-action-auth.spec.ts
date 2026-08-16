import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyA2AToken: vi.fn(),
  resolveOrgIdForEmail: vi.fn(),
}));

vi.mock("@agent-native/core/a2a", () => ({
  verifyA2AToken: mocks.verifyA2AToken,
}));

vi.mock("@agent-native/core/org", () => ({
  resolveOrgIdForEmail: mocks.resolveOrgIdForEmail,
}));

import {
  workspaceAppActionRouteAuth,
  WORKSPACE_APPS_ACTION_PATH,
} from "./workspace-app-action-auth.js";

afterEach(() => {
  vi.clearAllMocks();
});

function eventFor(path: string, authorization?: string) {
  return {
    path,
    node: {
      req: {
        headers: authorization ? { authorization } : {},
      },
    },
  };
}

describe("workspace app action auth", () => {
  it("only resolves the mounted workspace registry action", async () => {
    await expect(
      workspaceAppActionRouteAuth.resolveCaller?.(
        eventFor(
          "/_agent-native/actions/list-connected-agents",
          "Bearer token",
        ),
      ),
    ).resolves.toBeNull();
    expect(mocks.verifyA2AToken).not.toHaveBeenCalled();
  });

  it("rejects an invalid registry bearer instead of falling through to cookies", async () => {
    mocks.verifyA2AToken.mockResolvedValue({ email: null, orgDomain: null });

    await expect(
      workspaceAppActionRouteAuth.resolveCaller?.(
        eventFor(WORKSPACE_APPS_ACTION_PATH, "Bearer invalid"),
      ),
    ).rejects.toThrow("Invalid workspace registry authorization");
  });

  it("returns the verified caller and local org scope", async () => {
    mocks.verifyA2AToken.mockResolvedValue({
      email: "steve@builder.io",
      orgDomain: "builder.io",
    });
    mocks.resolveOrgIdForEmail.mockResolvedValue("org-builder");

    await expect(
      workspaceAppActionRouteAuth.resolveCaller?.(
        eventFor(WORKSPACE_APPS_ACTION_PATH, "Bearer verified"),
      ),
    ).resolves.toEqual({
      owner: "steve@builder.io",
      anonymous: false,
      orgId: "org-builder",
    });
    expect(mocks.verifyA2AToken).toHaveBeenCalledWith(
      "verified",
      expect.anything(),
    );
    expect(mocks.resolveOrgIdForEmail).toHaveBeenCalledWith("steve@builder.io");
  });
});
