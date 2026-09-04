import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());
const evaluateFeatureFlagStrictMock = vi.hoisted(() => vi.fn());
const validateFederatedMembershipMock = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
}));
vi.mock("../feature-flags/store.js", () => ({
  evaluateFeatureFlagStrict: evaluateFeatureFlagStrictMock,
}));
vi.mock("./federation.js", () => ({
  validateFederatedOrganizationMembershipForCurrentRequest:
    validateFederatedMembershipMock,
}));

const { isOrgMember } = await import("./membership.js");

describe("isOrgMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({ rows: [{ id: "member-1" }] });
    evaluateFeatureFlagStrictMock.mockResolvedValue(false);
  });

  it("keeps local membership semantics while federation is disabled", async () => {
    await expect(isOrgMember("org-1", " Alice@Example.com ")).resolves.toBe(
      true,
    );
    expect(evaluateFeatureFlagStrictMock).toHaveBeenCalledWith(
      "organization.cross-app-federation",
      {
        userEmail: "alice@example.com",
        userKey: "alice@example.com",
        orgId: "org-1",
      },
    );
    expect(validateFederatedMembershipMock).not.toHaveBeenCalled();
  });

  it("rejects a copied membership after the authority revokes it", async () => {
    evaluateFeatureFlagStrictMock.mockResolvedValue(true);
    validateFederatedMembershipMock.mockResolvedValue({
      active: false,
      role: null,
    });

    await expect(isOrgMember("org-1", "member@example.com")).resolves.toBe(
      false,
    );
    expect(validateFederatedMembershipMock).toHaveBeenCalledWith({
      orgId: "org-1",
      email: "member@example.com",
    });
  });

  it("does not turn an authority check failure into membership", async () => {
    evaluateFeatureFlagStrictMock.mockResolvedValue(true);
    validateFederatedMembershipMock.mockRejectedValue(
      new Error("identity authority unavailable"),
    );

    await expect(isOrgMember("org-1", "member@example.com")).rejects.toThrow(
      "identity authority unavailable",
    );
  });
});
