import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
  validateMembership: vi.fn(),
}));

vi.mock("./request-context.js", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));
vi.mock("../org/federation.js", () => ({
  validateFederatedOrganizationMembershipForCurrentRequest:
    mocks.validateMembership,
}));

import {
  assertCurrentRequestUserIsOrgAdmin,
  currentRequestUserIsOrgAdmin,
} from "./org-admin.js";

describe("currentRequestUserIsOrgAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestOrgId.mockReturnValue("org-1");
    mocks.getRequestUserEmail.mockReturnValue("User@Example.com");
    mocks.validateMembership.mockResolvedValue({ active: true, role: "admin" });
  });

  it.each(["owner", "admin"])("accepts the %s role", async (role) => {
    mocks.validateMembership.mockResolvedValue({ active: true, role });

    await expect(currentRequestUserIsOrgAdmin()).resolves.toBe(true);
    expect(mocks.validateMembership).toHaveBeenCalledWith({
      orgId: "org-1",
      email: "user@example.com",
    });
  });

  it.each(["member", "", null])("rejects the %s role", async (role) => {
    mocks.validateMembership.mockResolvedValue({
      active: Boolean(role),
      role,
    });
    await expect(currentRequestUserIsOrgAdmin()).resolves.toBe(false);
  });

  it("rejects a locally cached admin after federated membership revocation", async () => {
    mocks.validateMembership.mockResolvedValue({ active: false, role: null });

    await expect(currentRequestUserIsOrgAdmin()).resolves.toBe(false);
  });

  it("uses a refreshed federated role instead of a stale local admin role", async () => {
    mocks.validateMembership.mockResolvedValueOnce({
      active: true,
      role: "member",
    });

    await expect(currentRequestUserIsOrgAdmin()).resolves.toBe(false);
  });

  it("fails closed without request identity or when the lookup fails", async () => {
    mocks.getRequestUserEmail.mockReturnValue(null);
    await expect(currentRequestUserIsOrgAdmin()).resolves.toBe(false);

    mocks.getRequestUserEmail.mockReturnValue("user@example.com");
    mocks.validateMembership.mockRejectedValue(
      new Error("identity authority unavailable"),
    );
    await expect(currentRequestUserIsOrgAdmin()).resolves.toBe(false);
  });

  it("provides an assertion helper", async () => {
    mocks.validateMembership.mockResolvedValue({
      active: true,
      role: "member",
    });
    await expect(assertCurrentRequestUserIsOrgAdmin()).rejects.toThrow(
      "Only organization owners and admins",
    );
  });
});
