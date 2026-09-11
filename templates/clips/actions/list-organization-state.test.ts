import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetCurrentOwnerEmail = vi.fn();
const mockGetActiveOrganizationId = vi.fn();
const mockRequireOrganizationAccess = vi.fn();
const mockDb = { select: vi.fn() };

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/org", () => ({
  organizations: { id: "organizations.id", name: "organizations.name" },
  orgInvitations: { id: "org_invitations.id" },
  orgMembers: { id: "org_members.id" },
}));

vi.mock("@agent-native/core/user-profile", () => ({
  isEmailDerivedName: () => false,
}));

vi.mock("@agent-native/core/user-profile/server", () => ({
  getUserProfiles: async () => new Map(),
}));

vi.mock("../server/lib/agent-recording-access.js", () => ({
  agentRecordingAccessFilter: () => ({ op: "access-filter" }),
  isAgentRecordingCaller: () => false,
}));

vi.mock("../server/lib/recordings.js", () => ({
  getActiveOrganizationId: (...args: unknown[]) =>
    mockGetActiveOrganizationId(...args),
  getCurrentOwnerEmail: () => mockGetCurrentOwnerEmail(),
  ownerEmailMatches: () => ({ op: "owner-email-match" }),
  requireOrganizationAccess: (...args: unknown[]) =>
    mockRequireOrganizationAccess(...args),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    organizationSettings: { organizationId: "organization_settings.orgId" },
    spaces: { organizationId: "spaces.organizationId", name: "spaces.name" },
    folders: {
      organizationId: "folders.organizationId",
      ownerEmail: "folders.ownerEmail",
      spaceId: "folders.spaceId",
      position: "folders.position",
    },
    recordings: { id: "recordings.id" },
    recordingShares: { id: "recording_shares.id" },
    recordingViewers: { id: "recording_viewers.id" },
    meetings: { recordingId: "meetings.recordingId" },
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ op: "and", args }),
  asc: (...args: unknown[]) => ({ op: "asc", args }),
  desc: (...args: unknown[]) => ({ op: "desc", args }),
  eq: (...args: unknown[]) => ({ op: "eq", args }),
  isNotNull: (...args: unknown[]) => ({ op: "isNotNull", args }),
  isNull: (...args: unknown[]) => ({ op: "isNull", args }),
  notInArray: (...args: unknown[]) => ({ op: "notInArray", args }),
  or: (...args: unknown[]) => ({ op: "or", args }),
  sql: () => ({ raw: "sql" }),
}));

import action from "./list-organization-state";

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.select.mockReset();
  mockGetCurrentOwnerEmail.mockReturnValue("owner@example.com");
});

describe("list-organization-state action", () => {
  it("returns the personal-scope state after the caller deletes their only organization", async () => {
    // Slack thread 1789039718.548769: deleting the last organization left
    // Settings > Organization showing "Couldn't load organization branding."
    // beside a create-organization card that already rendered the same state.
    // No org is absent, not unreadable, so this must not throw.
    mockGetActiveOrganizationId.mockResolvedValue(null);

    const result = await action.run({}, undefined);

    expect(result).toEqual({
      currentUserEmail: "owner@example.com",
      organization: null,
      members: [],
      spaces: [],
      folders: [],
      personalFolders: [],
      invitations: [],
    });
    expect(mockRequireOrganizationAccess).not.toHaveBeenCalled();
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("still enforces access when an organization is resolved", async () => {
    // An organization the caller may not read stays a real failure — the
    // no-org branch must not swallow a denied read into an empty result.
    mockGetActiveOrganizationId.mockResolvedValue("org_1");
    mockRequireOrganizationAccess.mockRejectedValue(
      Object.assign(new Error("Organization not found or access denied"), {
        statusCode: 403,
      }),
    );

    await expect(action.run({}, undefined)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockRequireOrganizationAccess).toHaveBeenCalledWith("org_1");
  });

  it("returns the personal-scope state when the resolved organization row is gone", async () => {
    mockGetActiveOrganizationId.mockResolvedValue("org_gone");
    mockRequireOrganizationAccess.mockResolvedValue({
      organizationId: "org_gone",
      email: "owner@example.com",
      role: "owner",
    });
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    });

    await expect(action.run({}, undefined)).resolves.toEqual({
      currentUserEmail: "owner@example.com",
      organization: null,
      members: [],
      spaces: [],
      folders: [],
      personalFolders: [],
      invitations: [],
    });
  });

  it("honors an explicit organizationId without re-resolving the active org", async () => {
    mockRequireOrganizationAccess.mockRejectedValue(
      Object.assign(new Error("denied"), { statusCode: 403 }),
    );

    await expect(
      action.run({ organizationId: "org_explicit" }, undefined),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(mockGetActiveOrganizationId).not.toHaveBeenCalled();
    expect(mockRequireOrganizationAccess).toHaveBeenCalledWith("org_explicit");
  });
});
