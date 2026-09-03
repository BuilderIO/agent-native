import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveAccess: vi.fn(),
  isOrgMember: vi.fn(),
}));

vi.mock("./access.js", () => ({
  resolveAccess: (...args: unknown[]) => mocks.resolveAccess(...args),
}));

vi.mock("../org/membership.js", () => ({
  isOrgMember: (...args: unknown[]) => mocks.isOrgMember(...args),
}));

import { filterRecipientsByResourceAccess } from "./recipients.js";

beforeEach(() => {
  mocks.resolveAccess.mockReset().mockResolvedValue(null);
  mocks.isOrgMember.mockReset().mockResolvedValue(false);
});

describe("filterRecipientsByResourceAccess", () => {
  it("drops an address with no access to the resource", async () => {
    mocks.resolveAccess.mockImplementation(async (_type, _id, ctx) =>
      ctx.userEmail === "owner@example.com" ? { role: "owner" } : null,
    );

    const allowed = await filterRecipientsByResourceAccess({
      resourceType: "design",
      resourceId: "d1",
      emails: ["Owner@example.com", "outsider@evil.test"],
    });

    expect(allowed).toEqual(["owner@example.com"]);
  });

  it("never resolves an arbitrary address with the resource's org", async () => {
    mocks.resolveAccess.mockResolvedValue(null);

    await filterRecipientsByResourceAccess({
      resourceType: "design",
      resourceId: "d1",
      emails: ["outsider@evil.test"],
      orgId: "org_1",
    });

    // Only the no-org probe runs: a non-member never gets an org-scoped check.
    expect(mocks.resolveAccess).toHaveBeenCalledTimes(1);
    expect(mocks.resolveAccess.mock.calls[0][2]).toEqual({
      userEmail: "outsider@evil.test",
    });
  });

  it("lets an org member through on an org-visible resource", async () => {
    mocks.isOrgMember.mockResolvedValue(true);
    mocks.resolveAccess.mockImplementation(async (_type, _id, ctx) =>
      ctx.orgId ? { role: "viewer" } : null,
    );

    const allowed = await filterRecipientsByResourceAccess({
      resourceType: "design",
      resourceId: "d1",
      emails: ["teammate@example.com"],
      orgId: "org_1",
    });

    expect(allowed).toEqual(["teammate@example.com"]);
  });

  it("enforces the minimum role", async () => {
    mocks.resolveAccess.mockResolvedValue({ role: "viewer" });

    const allowed = await filterRecipientsByResourceAccess({
      resourceType: "design",
      resourceId: "d1",
      emails: ["viewer@example.com"],
      minimumRole: "editor",
    });

    expect(allowed).toEqual([]);
  });

  it("uses a supplied resolver instead of the sharing registry", async () => {
    const resolveRole = vi.fn().mockResolvedValue({ role: "viewer" });

    const allowed = await filterRecipientsByResourceAccess({
      resourceType: "custom",
      resourceId: "x1",
      emails: ["someone@example.com"],
      resolveRole,
    });

    expect(allowed).toEqual(["someone@example.com"]);
    expect(mocks.resolveAccess).not.toHaveBeenCalled();
  });
});
