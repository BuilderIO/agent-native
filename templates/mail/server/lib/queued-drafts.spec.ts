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
  getRequestOrgId: () => "org_1",
  getRequestUserEmail: () => "owner@example.com",
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
            selection && "email" in selection && "role" in selection
              ? [{ email: "owner@example.com", role: "member" }]
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
