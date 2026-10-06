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

const { isMissingOrganizationTableError, isOrgMember, isOrgMemberForA2A } =
  await import("./membership.js");

describe("isOrgMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({
      rows: [
        {
          id: "member-1",
          identity_authority: null,
          identity_id: null,
        },
      ],
    });
    evaluateFeatureFlagStrictMock.mockResolvedValue(false);
  });

  it("does not consult federation rollout state for local organizations", async () => {
    await expect(isOrgMember("org-1", " Alice@Example.com ")).resolves.toBe(
      true,
    );
    expect(evaluateFeatureFlagStrictMock).not.toHaveBeenCalled();
    expect(validateFederatedMembershipMock).not.toHaveBeenCalled();
  });

  it("requires readable organization metadata at credential boundaries while preserving legacy lookup behavior", async () => {
    executeMock.mockImplementation(async ({ sql }: { sql: string }) => {
      if (sql.includes("FROM organizations")) {
        throw new Error('relation "organizations" does not exist');
      }
      return { rows: [{ role: "member" }] };
    });

    await expect(isOrgMember("org-1", "member@example.test")).resolves.toBe(
      true,
    );
    await expect(
      isOrgMember("org-1", "member@example.test", {
        requireOrganizationMetadata: true,
      }),
    ).rejects.toThrow('relation "organizations" does not exist');
  });

  it("refuses an orphaned membership when organization metadata is required", async () => {
    executeMock
      .mockResolvedValueOnce({ rows: [{ role: "member" }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      isOrgMember("org-1", "member@example.test", {
        requireOrganizationMetadata: true,
      }),
    ).resolves.toBe(false);
  });

  it("rejects a copied membership after the authority revokes it", async () => {
    executeMock.mockResolvedValue({
      rows: [
        {
          id: "member-1",
          identity_authority: "https://dispatch.example.test",
          identity_id: "dispatch-org-1",
        },
      ],
    });
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
    executeMock.mockResolvedValue({
      rows: [
        {
          id: "member-1",
          identity_authority: "https://dispatch.example.test",
          identity_id: "dispatch-org-1",
        },
      ],
    });
    evaluateFeatureFlagStrictMock.mockResolvedValue(true);
    validateFederatedMembershipMock.mockRejectedValue(
      new Error("identity authority unavailable"),
    );

    await expect(isOrgMember("org-1", "member@example.com")).rejects.toThrow(
      "identity authority unavailable",
    );
  });
});

describe("isOrgMemberForA2A", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    evaluateFeatureFlagStrictMock.mockResolvedValue(false);
  });

  it("uses the supplied org id and normalized subject for membership evidence", async () => {
    executeMock.mockResolvedValueOnce({ rows: [] });

    await expect(
      isOrgMemberForA2A("org-x", " Victim@Y.Example "),
    ).resolves.toBe(false);
    expect(executeMock.mock.calls[0]?.[0].args).toEqual([
      "org-x",
      "victim@y.example",
    ]);
  });

  it("accepts an active member of the resolved org", async () => {
    executeMock
      .mockResolvedValueOnce({ rows: [{ role: "member" }] })
      .mockResolvedValueOnce({
        rows: [{ identity_authority: null, identity_id: null }],
      });

    await expect(isOrgMemberForA2A("org-x", "alice@x.example")).resolves.toBe(
      true,
    );
  });

  it("rejects a membership row when its organization record is missing", async () => {
    executeMock
      .mockResolvedValueOnce({ rows: [{ role: "member" }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(isOrgMemberForA2A("org-x", "alice@x.example")).resolves.toBe(
      false,
    );
  });

  it("propagates unreadable organization metadata instead of treating it as membership", async () => {
    executeMock
      .mockResolvedValueOnce({ rows: [{ role: "member" }] })
      .mockRejectedValueOnce(
        new Error('relation "organizations" does not exist'),
      );

    await expect(isOrgMemberForA2A("org-x", "alice@x.example")).rejects.toThrow(
      'relation "organizations" does not exist',
    );
  });
});

describe("isMissingOrganizationTableError", () => {
  it("recognizes a Postgres missing-relation error wrapped by a query helper", () => {
    const cause = Object.assign(
      new Error('relation "organizations" does not exist'),
      { code: "42P01" },
    );
    const error = Object.assign(new Error("Failed query"), { cause });

    expect(isMissingOrganizationTableError(error)).toBe(true);
  });

  it("recognizes a missing org-members relation", () => {
    expect(
      isMissingOrganizationTableError(
        new Error('relation "org_members" does not exist'),
      ),
    ).toBe(true);
  });
});
