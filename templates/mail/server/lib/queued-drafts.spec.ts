import { beforeEach, describe, expect, it, vi } from "vitest";

const dbState = vi.hoisted(() => ({
  draft: {
    id: "qd_1",
    orgId: "org_1",
    ownerEmail: "owner@example.com",
    requesterEmail: "requester@example.com",
    requesterName: null,
    toRecipients: "to@example.com",
    ccRecipients: null,
    bccRecipients: null,
    subject: "Hello",
    body: "Body",
    context: null,
    source: "agent",
    sourceThreadId: null,
    accountEmail: null,
    composeId: null,
    sentMessageId: null,
    sendClaimId: null as string | null,
    sendClaimedAt: null as number | null,
    status: "queued",
    createdAt: 100,
    updatedAt: 100,
    sentAt: null as number | null,
  },
}));

const updateSet = vi.hoisted(() => vi.fn());
const updateWhere = vi.hoisted(() => vi.fn());
const updateReturning = vi.hoisted(() => vi.fn());
const readOrgMemberRole = vi.hoisted(() => vi.fn(async () => "owner"));
const requestIdentity = vi.hoisted(() => ({
  orgId: "org_1",
  userEmail: "owner@example.com",
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/notifications", () => ({
  notify: vi.fn(),
}));

vi.mock("@agent-native/core/org", () => ({
  orgMembers: {
    email: "orgMembers.email",
    role: "orgMembers.role",
    orgId: "orgMembers.orgId",
  },
}));

vi.mock("@agent-native/core/server", () => ({
  getAppProductionUrl: () => "https://mail.example.com",
  getRequestOrgId: () => requestIdentity.orgId,
  getRequestUserEmail: () => requestIdentity.userEmail,
  readOrgMemberRole,
  withConfiguredAppBasePath: (url: string) => url,
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  asc: vi.fn((value: unknown) => value),
  desc: vi.fn((value: unknown) => value),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
  or: vi.fn((...args: unknown[]) => args),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    select: (selection?: Record<string, unknown>) => ({
      from: () => ({
        where: () => ({
          limit: async () =>
            selection && "email" in selection
              ? [{ email: "owner@example.com" }]
              : [dbState.draft],
        }),
      }),
    }),
    update: () => ({
      set: updateSet,
    }),
  }),
  schema: {
    queuedEmailDrafts: {
      id: "queuedEmailDrafts.id",
      orgId: "queuedEmailDrafts.orgId",
      sendClaimId: "queuedEmailDrafts.sendClaimId",
      sendClaimedAt: "queuedEmailDrafts.sendClaimedAt",
      status: "queuedEmailDrafts.status",
    },
  },
}));

updateSet.mockImplementation((values: Record<string, unknown>) => ({
  where: updateWhere.mockImplementation(() => ({
    returning: updateReturning.mockImplementation(async () => {
      if (values.sendClaimId && !dbState.draft.sendClaimId) {
        dbState.draft.sendClaimId = values.sendClaimId as string;
        dbState.draft.sendClaimedAt = values.sendClaimedAt as number;
        dbState.draft.updatedAt = values.updatedAt as number;
        return [{ sendClaimId: dbState.draft.sendClaimId }];
      }
      return [];
    }),
  })),
}));

describe("queued draft send claims", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.draft.status = "queued";
    dbState.draft.sendClaimId = null;
    dbState.draft.sendClaimedAt = null;
    dbState.draft.updatedAt = 100;
  });

  it("claims without writing an unsupported public status value", async () => {
    const { claimQueuedDraftForSending } = await import("./queued-drafts.js");

    const claim = await claimQueuedDraftForSending("qd_1");

    expect(claim.claimed).toBe(true);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        sendClaimId: expect.any(String),
        sendClaimedAt: expect.any(Number),
        updatedAt: expect.any(Number),
      }),
    );
    expect(updateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "sending" }),
    );
    expect(dbState.draft.status).toBe("queued");
  });

  it("reports an active claim as already sending", async () => {
    const { claimQueuedDraftForSending } = await import("./queued-drafts.js");

    await claimQueuedDraftForSending("qd_1");
    const second = await claimQueuedDraftForSending("qd_1");

    expect(second).toEqual({ claimed: false, reason: "sending" });
  });
});

describe("queued draft organization context", () => {
  beforeEach(() => {
    requestIdentity.orgId = "org_1";
    requestIdentity.userEmail = "owner@example.com";
    readOrgMemberRole.mockResolvedValue("owner");
  });

  it("uses the effective role for a delegated organization owner", async () => {
    readOrgMemberRole.mockResolvedValue("member");
    const { requireQueueContext } = await import("./queued-drafts.js");

    await expect(requireQueueContext()).resolves.toEqual({
      userEmail: "owner@example.com",
      orgId: "org_1",
      role: "member",
    });
    expect(readOrgMemberRole).toHaveBeenCalledWith(
      "org_1",
      "owner@example.com",
    );
  });

  it.each([
    { orgId: "org_1", userEmail: "other@example.com" },
    { orgId: "org_2", userEmail: "owner@example.com" },
  ])(
    "denies a delegated request identity mismatch when role resolution rejects it: %o",
    async (identity) => {
      requestIdentity.orgId = identity.orgId;
      requestIdentity.userEmail = identity.userEmail;
      readOrgMemberRole.mockResolvedValue(null);
      const { requireQueueContext } = await import("./queued-drafts.js");

      await expect(requireQueueContext()).rejects.toThrow(
        "Only members of this organization can queue drafts.",
      );
      expect(readOrgMemberRole).toHaveBeenCalledWith(
        identity.orgId,
        identity.userEmail,
      );
    },
  );
});
