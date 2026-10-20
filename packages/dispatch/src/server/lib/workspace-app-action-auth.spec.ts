import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  diagnoseA2ATokenFailure: vi.fn(),
  verifyA2AToken: vi.fn(),
  isOrgMember: vi.fn(),
  resolveOrgByDomain: vi.fn(),
  resolveOrgIdForEmail: vi.fn(),
}));

vi.mock("@agent-native/core/a2a", () => ({
  diagnoseA2ATokenFailure: mocks.diagnoseA2ATokenFailure,
  verifyA2AToken: mocks.verifyA2AToken,
}));

vi.mock("@agent-native/core/org", () => ({
  isOrgMember: mocks.isOrgMember,
  resolveOrgByDomain: mocks.resolveOrgByDomain,
  resolveOrgIdForEmail: mocks.resolveOrgIdForEmail,
}));

import {
  workspaceAppActionRouteAuth,
  WORKSPACE_APP_CLAIM_ACTION_PATH,
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

  describe("refuses every bad registry bearer the same way and logs why", () => {
    const REFUSED = "Invalid workspace registry authorization";
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      warn.mockRestore();
    });

    async function refusalFor(authorization: string) {
      return workspaceAppActionRouteAuth
        .resolveCaller?.(eventFor(WORKSPACE_APPS_ACTION_PATH, authorization))
        .then(
          () => null,
          (error: unknown) => error as Error,
        );
    }

    // The caller sees one fixed refusal, so no answer tells an unauthenticated
    // caller which credential check a guess got past.
    function expectBareRefusal(refusal: Error | null | undefined) {
      expect(refusal).toBeInstanceOf(Error);
      expect(refusal?.message).toBe(REFUSED);
      expect(Object.keys(refusal as Error)).toEqual([]);
    }

    function expectLogged(entry: { reason: string; cause?: string }) {
      expect(warn).toHaveBeenCalledWith(
        "[workspace-registry-auth] refused caller",
        entry,
      );
    }

    it("logs which check an unverified token failed, and tells the caller nothing more", async () => {
      mocks.verifyA2AToken.mockResolvedValue({ email: null, orgDomain: null });
      mocks.diagnoseA2ATokenFailure.mockResolvedValue("signature");

      expectBareRefusal(await refusalFor("Bearer wrong-secret"));

      expect(mocks.diagnoseA2ATokenFailure).toHaveBeenCalledWith(
        "wrong-secret",
        expect.anything(),
      );
      expectLogged({ reason: "token-not-verified", cause: "signature" });
    });

    it("logs a verified token that was demoted to an organization principal", async () => {
      mocks.verifyA2AToken.mockResolvedValue({
        email: null,
        orgDomain: "builder.io",
        orgId: "org-builder",
        identityAssurance: "organization",
      });

      expectBareRefusal(await refusalFor("Bearer demoted"));

      expect(mocks.diagnoseA2ATokenFailure).not.toHaveBeenCalled();
      expectLogged({ reason: "token-without-user", cause: undefined });
    });

    it("logs an organization that does not exist here", async () => {
      mocks.verifyA2AToken.mockResolvedValue({
        email: "steve@builder.io",
        orgDomain: "builder.io",
      });
      mocks.resolveOrgByDomain.mockResolvedValue(null);

      expectBareRefusal(await refusalFor("Bearer verified"));

      expectLogged({ reason: "org-unknown", cause: undefined });
    });

    it("logs a caller who is not a member of the organization", async () => {
      mocks.verifyA2AToken.mockResolvedValue({
        email: "steve@builder.io",
        orgDomain: "builder.io",
      });
      mocks.resolveOrgByDomain.mockResolvedValue({
        orgId: "org-builder",
        orgName: "Builder.io",
      });
      mocks.isOrgMember.mockResolvedValue(false);

      expectBareRefusal(await refusalFor("Bearer verified"));

      expectLogged({ reason: "not-org-member", cause: undefined });
    });

    it("logs an organization claim that names a different organization", async () => {
      mocks.verifyA2AToken.mockResolvedValue({
        email: "steve@builder.io",
        orgDomain: "builder.io",
        orgId: "org-claimed",
      });
      mocks.resolveOrgByDomain.mockResolvedValue({
        orgId: "org-local",
        orgName: "Builder.io",
      });

      expectBareRefusal(await refusalFor("Bearer verified"));

      expectLogged({ reason: "org-mismatch", cause: undefined });
    });

    it("logs a malformed authorization header", async () => {
      expectBareRefusal(await refusalFor("Basic abc"));

      expectLogged({ reason: "malformed-authorization", cause: undefined });
    });

    it("logs each distinct refusal once, not once per request", async () => {
      mocks.verifyA2AToken.mockResolvedValue({ email: null, orgDomain: null });
      mocks.diagnoseA2ATokenFailure.mockResolvedValue("expired");

      await refusalFor("Bearer old-one");
      await refusalFor("Bearer old-two");

      const expired = warn.mock.calls.filter(
        ([, entry]) => (entry as { cause?: string }).cause === "expired",
      );
      expect(expired).toHaveLength(1);
    });
  });

  it.each([WORKSPACE_APPS_ACTION_PATH, WORKSPACE_APP_CLAIM_ACTION_PATH])(
    "returns the verified caller and local org scope for %s",
    async (actionPath) => {
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
          eventFor(actionPath, "Bearer verified"),
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
    },
  );

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
