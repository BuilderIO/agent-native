import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "member" as string | null,
  request: undefined as
    | { isIntegrationCaller?: boolean; integration?: object }
    | undefined,
}));
vi.mock("../server/personal-provider-key-policy.js", () => ({
  readOrgMemberRole: vi.fn(async () => state.role),
}));
vi.mock("../server/request-context.js", () => ({
  getRequestContext: () => state.request,
}));

import { requireIntegrationScopeAccess } from "./scope-action-access.js";

const caller = {
  userEmail: "owner@example.com",
  orgId: "org-example",
  caller: "frontend" as const,
};

beforeEach(() => {
  state.role = "member";
  state.request = undefined;
});

describe("conversation scope action authorization", () => {
  it("requires authentication and scopes member reads", async () => {
    await expect(
      requireIntegrationScopeAccess(undefined),
    ).rejects.toMatchObject({ statusCode: 401 });
    await expect(requireIntegrationScopeAccess(caller)).resolves.toEqual({
      ownerEmail: caller.userEmail,
      orgId: caller.orgId,
    });
  });

  it.each(["member", null])(
    "rejects saves for unverified managers (%s)",
    async (role) => {
      state.role = role;
      await expect(
        requireIntegrationScopeAccess(caller, true),
      ).rejects.toMatchObject({ statusCode: 403 });
    },
  );

  it.each(["owner", "admin"])("permits verified %s saves", async (role) => {
    state.role = role;
    await expect(requireIntegrationScopeAccess(caller, true)).resolves.toEqual({
      ownerEmail: caller.userEmail,
      orgId: caller.orgId,
    });
  });

  it("permits the authenticated personal owner", async () => {
    await expect(
      requireIntegrationScopeAccess({ ...caller, orgId: null }, true),
    ).resolves.toEqual({
      ownerEmail: caller.userEmail,
      orgId: null,
    });
  });

  it.each([{ isIntegrationCaller: true }, { integration: {} }])(
    "rejects integration reads and saves (%j)",
    async (request) => {
      state.request = request;
      state.role = "owner";
      await expect(requireIntegrationScopeAccess(caller)).rejects.toMatchObject(
        { statusCode: 403 },
      );
      await expect(
        requireIntegrationScopeAccess(caller, true),
      ).rejects.toMatchObject({ statusCode: 403 });
    },
  );
});
