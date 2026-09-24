/**
 * Tests for the org-scope authorization added to provider-api-register.
 *
 * Plan 014 (advisor-plans/014-custom-registry-scope-authorization.md): this
 * action previously let ANY authenticated org member upsert/delete an
 * ORG-scoped custom API provider with no owner/admin check. These tests
 * assert that org-scope upsert/delete now require the caller to be an org
 * owner or admin, while user-scope calls and org-scope reads remain
 * unaffected.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCredentialContext: vi.fn(),
  execute: vi.fn(),
  upsertCustomProvider: vi.fn(),
  deleteCustomProvider: vi.fn(),
  listCustomProviders: vi.fn(),
  getCustomProvider: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getCredentialContext: mocks.getCredentialContext,
}));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute: mocks.execute }),
}));

// Keep the real `assertCanMutateCustomProviderScope` (it's the guard under
// test's downstream enforcement point) and only mock the DB-backed CRUD
// functions, mirroring the `importOriginal` partial-mock pattern used in
// packages/dispatch/src/server/lib/vault-store.spec.ts.
vi.mock("@agent-native/core/provider-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/provider-api")>();
  return {
    ...actual,
    upsertCustomProvider: mocks.upsertCustomProvider,
    deleteCustomProvider: mocks.deleteCustomProvider,
    listCustomProviders: mocks.listCustomProviders,
    getCustomProvider: mocks.getCustomProvider,
  };
});

const action = (await import("./provider-api-register.js")).default;

function mockOrgRole(role: string | null): void {
  mocks.execute.mockResolvedValue({ rows: role ? [{ role }] : [] });
}

const baseUpsertInput = {
  operation: "upsert" as const,
  id: "my-api",
  label: "My API",
  baseUrl: "https://api.example.com",
  auth: { type: "none" as const },
};

describe("provider-api-register org-scope authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCredentialContext.mockReturnValue({
      userEmail: "member@example.com",
      orgId: "org-a",
    });
    mocks.upsertCustomProvider.mockResolvedValue("my-api");
    mocks.deleteCustomProvider.mockResolvedValue(true);
  });

  it("rejects an org-scope upsert from a plain member", async () => {
    mockOrgRole("member");

    await expect(
      action.run({ ...baseUpsertInput, scope: "org" }),
    ).rejects.toThrow(/owners and admins/i);
    expect(mocks.upsertCustomProvider).not.toHaveBeenCalled();
  });

  it("rejects an org-scope delete from a plain member", async () => {
    mockOrgRole("member");

    await expect(
      action.run({ operation: "delete", id: "my-api", scope: "org" }),
    ).rejects.toThrow(/owners and admins/i);
    expect(mocks.deleteCustomProvider).not.toHaveBeenCalled();
  });

  it("rejects an org-scope delete when the caller has no membership row", async () => {
    mockOrgRole(null);

    await expect(
      action.run({ operation: "delete", id: "my-api", scope: "org" }),
    ).rejects.toThrow(/owners and admins/i);
    expect(mocks.deleteCustomProvider).not.toHaveBeenCalled();
  });

  it("allows an org-scope upsert from an owner and passes orgRole through", async () => {
    mockOrgRole("owner");

    await action.run({ ...baseUpsertInput, scope: "org" });

    expect(mocks.upsertCustomProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "org",
        scopeId: "org-a",
        orgRole: "owner",
      }),
    );
  });

  it("allows an org-scope delete from an admin and passes orgRole through", async () => {
    mockOrgRole("admin");

    await action.run({ operation: "delete", id: "my-api", scope: "org" });

    expect(mocks.deleteCustomProvider).toHaveBeenCalledWith(
      "org",
      "org-a",
      "my-api",
      "admin",
    );
  });

  it("does not require an org role for user-scope upsert/delete", async () => {
    await action.run({ ...baseUpsertInput, scope: "user" });
    await action.run({ operation: "delete", id: "my-api", scope: "user" });

    expect(mocks.upsertCustomProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "user",
        scopeId: "member@example.com",
        orgRole: null,
      }),
    );
    expect(mocks.deleteCustomProvider).toHaveBeenCalledWith(
      "user",
      "member@example.com",
      "my-api",
      null,
    );
    // No membership lookup should even happen for user-scope calls.
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("allows an org-scope upsert/delete when the caller has no active org", async () => {
    // No org at all — `resolveOrgId` never wired, or a genuinely org-less
    // solo user. `scopeId` collapses to the caller's own email (same as
    // scope: "user"), so there's no other org member to protect against;
    // this must not hard-reject the action's own default scope.
    mocks.getCredentialContext.mockReturnValue({
      userEmail: "solo@example.com",
      orgId: null,
    });

    await action.run({ ...baseUpsertInput, scope: "org" });
    await action.run({ operation: "delete", id: "my-api", scope: "org" });

    expect(mocks.upsertCustomProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "org",
        scopeId: "solo@example.com",
        orgRole: "owner",
      }),
    );
    expect(mocks.deleteCustomProvider).toHaveBeenCalledWith(
      "org",
      "solo@example.com",
      "my-api",
      "owner",
    );
    // No org, so no membership lookup should happen either.
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("does not gate org-scope list/get reads on org role", async () => {
    mocks.listCustomProviders.mockResolvedValue([]);
    mocks.getCustomProvider.mockResolvedValue(null);

    await action.run({ operation: "list", scope: "org" });
    await action.run({ operation: "get", id: "my-api", scope: "org" });

    expect(mocks.listCustomProviders).toHaveBeenCalledWith("org", "org-a");
    expect(mocks.getCustomProvider).toHaveBeenCalledWith(
      "org",
      "org-a",
      "my-api",
    );
    // Reads are intentionally out of scope for the role gate (plan 014).
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
