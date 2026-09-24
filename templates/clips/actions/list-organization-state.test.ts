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

type Builder = Record<string, unknown> & { label: string; thenCalls: number };

/**
 * A drizzle-like builder: chain methods return itself and awaiting it resolves
 * `rows`. `gate` holds every read open so a test can see which reads were
 * issued before any of them settled.
 */
function builder(
  label: string,
  rows: unknown[] = [],
  gate: Promise<void> = Promise.resolve(),
): Builder {
  const b: Builder = { label, thenCalls: 0 };
  for (const method of ["from", "where", "orderBy", "groupBy", "limit"]) {
    b[method] = () => b;
  }
  b.then = (
    resolve: (value: unknown) => unknown,
    reject: (e: unknown) => unknown,
  ) => {
    b.thenCalls += 1;
    return gate.then(() => rows).then(resolve, reject);
  };
  return b;
}

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
    mockDb.select.mockImplementation(() => builder("read"));

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

  it("issues every organization read in one round-trip window", async () => {
    mockGetActiveOrganizationId.mockResolvedValue("org_1");
    mockRequireOrganizationAccess.mockResolvedValue({
      organizationId: "org_1",
      email: "owner@example.com",
      role: "owner",
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const rowsByOrder: unknown[][] = [
      [], // meetings subquery (never awaited on its own)
      [{ id: "m1", email: "owner@example.com", role: "owner", joinedAt: 1 }],
      [{ id: "org_1", name: "Org", createdAt: 1 }],
      [], // settings
      [], // invitations
      [{ id: "s1", name: "Space", isAllCompany: 0 }],
      [{ id: "f1", name: "Folder", spaceId: null, position: 0 }],
      [{ folderId: "f1", recordingCount: 2 }],
    ];
    const builders: Builder[] = [];
    mockDb.select.mockImplementation(() => {
      const b = builder(
        `read-${builders.length}`,
        rowsByOrder[builders.length] ?? [],
        gate,
      );
      builders.push(b);
      return b;
    });

    const pending = action.run({}, undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // All seven awaited reads are in flight before any of them has settled.
    const awaited = builders.filter((b) => b.thenCalls > 0);
    expect(awaited).toHaveLength(7);
    // The members read feeds both the member list and the profile lookup,
    // but must hit the database once.
    expect(builders[1].thenCalls).toBe(1);

    release();
    const result = (await pending) as any;
    expect(result.organization).toMatchObject({ id: "org_1", name: "Org" });
    expect(result.members).toEqual([
      { id: "m1", email: "owner@example.com", role: "owner", joinedAt: 1 },
    ]);
    expect(result.folders).toEqual([
      expect.objectContaining({ id: "f1", recordingCount: 2 }),
    ]);
  });
});
