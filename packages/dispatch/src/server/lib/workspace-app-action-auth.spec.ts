import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyA2AToken: vi.fn(),
  isOrgMember: vi.fn(),
  resolveOrgByDomain: vi.fn(),
  resolveOrgIdForEmail: vi.fn(),
}));

vi.mock("@agent-native/core/a2a", () => ({
  verifyA2AToken: mocks.verifyA2AToken,
}));

vi.mock("@agent-native/core/org", () => ({
  isOrgMember: mocks.isOrgMember,
  resolveOrgByDomain: mocks.resolveOrgByDomain,
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
    context: {},
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
    mocks.resolveOrgByDomain.mockResolvedValue({
      orgId: "org-builder",
      orgName: "Builder.io",
    });
    mocks.isOrgMember.mockResolvedValue(true);

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
    expect(mocks.resolveOrgByDomain).toHaveBeenCalledWith("builder.io");
    expect(mocks.isOrgMember).toHaveBeenCalledWith(
      "org-builder",
      "steve@builder.io",
    );
    expect(mocks.resolveOrgIdForEmail).not.toHaveBeenCalled();
  });

  it("uses the original mounted pathname after the route prefix is stripped", async () => {
    mocks.verifyA2AToken.mockResolvedValue({
      email: "steve@builder.io",
      orgDomain: "builder.io",
    });
    mocks.resolveOrgByDomain.mockResolvedValue({
      orgId: "org-builder",
      orgName: "Builder.io",
    });
    mocks.isOrgMember.mockResolvedValue(true);
    const event = eventFor("/", "Bearer mounted");
    event.context = {
      _mountedPathname: WORKSPACE_APPS_ACTION_PATH,
    };

    await expect(
      workspaceAppActionRouteAuth.resolveCaller?.(event),
    ).resolves.toMatchObject({
      owner: "steve@builder.io",
      orgId: "org-builder",
    });
    expect(mocks.verifyA2AToken).toHaveBeenCalledWith(
      "mounted",
      expect.anything(),
    );
  });

  it("keeps legacy email-derived scope when the token has no org domain", async () => {
    mocks.verifyA2AToken.mockResolvedValue({
      email: "steve@builder.io",
      orgDomain: null,
    });
    mocks.resolveOrgIdForEmail.mockResolvedValue("org-by-email");

    await expect(
      workspaceAppActionRouteAuth.resolveCaller?.(
        eventFor(WORKSPACE_APPS_ACTION_PATH, "Bearer legacy"),
      ),
    ).resolves.toMatchObject({ orgId: "org-by-email" });
    expect(mocks.resolveOrgIdForEmail).toHaveBeenCalledWith("steve@builder.io");
  });

  it("preserves a signed org id when the token has no resolvable domain", async () => {
    mocks.verifyA2AToken.mockResolvedValue({
      email: "steve@builder.io",
      orgDomain: null,
      orgId: "org-builder",
    });
    mocks.isOrgMember.mockResolvedValue(true);

    await expect(
      workspaceAppActionRouteAuth.resolveCaller?.(
        eventFor(WORKSPACE_APPS_ACTION_PATH, "Bearer scoped"),
      ),
    ).resolves.toMatchObject({ orgId: "org-builder" });
    expect(mocks.isOrgMember).toHaveBeenCalledWith(
      "org-builder",
      "steve@builder.io",
    );
    expect(mocks.resolveOrgIdForEmail).not.toHaveBeenCalled();
  });

  it("rejects mismatched domain and org id claims", async () => {
    mocks.verifyA2AToken.mockResolvedValue({
      email: "steve@builder.io",
      orgDomain: "builder.io",
      orgId: "org-other",
    });
    mocks.resolveOrgByDomain.mockResolvedValue({
      orgId: "org-builder",
      orgName: "Builder.io",
    });

    await expect(
      workspaceAppActionRouteAuth.resolveCaller?.(
        eventFor(WORKSPACE_APPS_ACTION_PATH, "Bearer mismatched"),
      ),
    ).rejects.toThrow("Invalid workspace registry authorization");
    expect(mocks.isOrgMember).not.toHaveBeenCalled();
  });

  it("rejects a verified domain that is not registered locally", async () => {
    mocks.verifyA2AToken.mockResolvedValue({
      email: "steve@builder.io",
      orgDomain: "unknown.example",
    });
    mocks.resolveOrgByDomain.mockResolvedValue(null);

    await expect(
      workspaceAppActionRouteAuth.resolveCaller?.(
        eventFor(WORKSPACE_APPS_ACTION_PATH, "Bearer unmapped"),
      ),
    ).rejects.toThrow("Invalid workspace registry authorization");
  });

  it("rejects a global-token caller who is not a member of the claimed org", async () => {
    mocks.verifyA2AToken.mockResolvedValue({
      email: "outsider@example.com",
      orgDomain: "builder.io",
    });
    mocks.resolveOrgByDomain.mockResolvedValue({
      orgId: "org-builder",
      orgName: "Builder.io",
    });
    mocks.isOrgMember.mockResolvedValue(false);

    await expect(
      workspaceAppActionRouteAuth.resolveCaller?.(
        eventFor(WORKSPACE_APPS_ACTION_PATH, "Bearer global-token"),
      ),
    ).rejects.toThrow("Invalid workspace registry authorization");
    expect(mocks.isOrgMember).toHaveBeenCalledWith(
      "org-builder",
      "outsider@example.com",
    );
  });
});
