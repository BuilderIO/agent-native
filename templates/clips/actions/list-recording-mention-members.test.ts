import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveAccess = vi.hoisted(() => vi.fn());
const mockOrderBy = vi.hoisted(() => vi.fn());
const mockGetUserProfiles = vi.hoisted(() => vi.fn());
const mockIsEmailDerivedName = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/org", () => ({
  orgMembers: {
    email: "org_members.email",
    orgId: "org_members.org_id",
  },
}));

vi.mock("@agent-native/core/sharing", () => ({
  ForbiddenError: class ForbiddenError extends Error {},
  resolveAccess: (...args: unknown[]) => mockResolveAccess(...args),
}));

vi.mock("@agent-native/core/user-profile", () => ({
  isEmailDerivedName: (...args: unknown[]) => mockIsEmailDerivedName(...args),
}));

vi.mock("@agent-native/core/user-profile/server", () => ({
  getUserProfiles: (...args: unknown[]) => mockGetUserProfiles(...args),
}));

vi.mock("drizzle-orm", () => ({
  asc: (column: unknown) => ({ kind: "asc", column }),
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: (...args: unknown[]) => mockOrderBy(...args),
        }),
      }),
    }),
  }),
}));

vi.mock("../server/lib/recording-page-access.js", () => ({
  isRecordingExpired: vi.fn((expiresAt: string | null | undefined) => {
    if (!expiresAt) return false;
    return new Date(expiresAt).getTime() < Date.now();
  }),
}));

import action from "./list-recording-mention-members";

const baseResource = {
  organizationId: "org-recording",
  expiresAt: "2026-12-01T00:00:00.000Z",
  visibility: "org" as const,
  password: null,
  ownerEmail: "owner@example.com",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveAccess.mockResolvedValue({
    role: "viewer",
    resource: baseResource,
  });
  mockOrderBy.mockResolvedValue([
    { email: "alex@example.com" },
    { email: "beta@example.com" },
  ]);
  mockGetUserProfiles.mockResolvedValue(
    new Map([
      ["alex@example.com", { name: "Alex Chen" }],
      ["beta@example.com", { name: "Beta" }],
    ]),
  );
  mockIsEmailDerivedName.mockReturnValue(false);
});

describe("list-recording-mention-members", () => {
  it("returns the members for the recording's organization", async () => {
    await expect(
      action.run({ recordingId: "rec-1" } as never),
    ).resolves.toEqual({
      members: [
        { email: "alex@example.com", name: "Alex Chen" },
        { email: "beta@example.com", name: "Beta" },
      ],
    });

    expect(mockResolveAccess).toHaveBeenCalledWith("recording", "rec-1");
    expect(mockOrderBy).toHaveBeenCalledWith({
      kind: "asc",
      column: "org_members.email",
    });
  });

  it("returns members for a password-protected recording after access is resolved", async () => {
    mockResolveAccess.mockResolvedValue({
      role: "viewer",
      resource: {
        ...baseResource,
        visibility: "public" as const,
        password: "secret",
      },
    });

    await expect(
      action.run({ recordingId: "rec-1" } as never),
    ).resolves.toEqual(expect.objectContaining({ members: expect.any(Array) }));
  });
});
