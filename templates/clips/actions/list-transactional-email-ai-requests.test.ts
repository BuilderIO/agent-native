import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimant: "recipient@example.test",
  listJobs: vi.fn(),
  claimAwaitingAi: vi.fn(),
  reclaimStaleAiDispatch: vi.fn(),
  resolveAccess: vi.fn(),
  readConfig: vi.fn(),
  gte: vi.fn((...args: unknown[]) => args),
  select: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
}));
vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: (...args: unknown[]) => args,
  resolveAccess: (...args: unknown[]) => mocks.resolveAccess(...args),
}));
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
  gte: (...args: unknown[]) => mocks.gte(...args),
  inArray: (...args: unknown[]) => args,
}));
vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => mocks.claimant,
  ownerEmailMatches: (...args: unknown[]) => args,
}));
vi.mock("../server/lib/transactional-email-store.js", () => ({
  AI_DISPATCH_STALE_MS: 30 * 60 * 1000,
  isAiBackedType: (type: string) =>
    type === "two-clips" || type === "monthly-recap",
  transactionalEmailStore: {
    listJobs: (...args: unknown[]) => mocks.listJobs(...args),
    readConfig: (...args: unknown[]) => mocks.readConfig(...args),
    claimAwaitingAi: (...args: unknown[]) => mocks.claimAwaitingAi(...args),
    reclaimStaleAiDispatch: (...args: unknown[]) =>
      mocks.reclaimStaleAiDispatch(...args),
  },
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ select: mocks.select }),
  schema: {
    recordings: {
      id: "recordings.id",
      title: "recordings.title",
      description: "recordings.description",
    },
    recordingTranscripts: {
      recordingId: "transcripts.recordingId",
      fullText: "transcripts.fullText",
    },
    recordingViewers: {
      recordingId: "viewers.recordingId",
      viewerEmail: "viewers.viewerEmail",
      countedView: "viewers.countedView",
    },
    recordingShares: {
      id: "shares.id",
      resourceId: "shares.resourceId",
      principalType: "shares.principalType",
      principalId: "shares.principalId",
      createdBy: "shares.createdBy",
      createdAt: "shares.createdAt",
    },
  },
}));

import action, {
  claimTransactionalEmailAiRequests,
  MAX_TRANSCRIPT_EXCERPT_LENGTH,
} from "./list-transactional-email-ai-requests";

const job = {
  logicalKey: "two-clips:recipient@example.test",
  type: "two-clips",
  state: "awaiting_ai",
  recipient: "Recipient@Example.Test",
  recordingIds: ["recording-1", "recording-2"],
  requestedBy: "second-sender@example.test",
  attempts: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  lastError: null,
  leaseUntil: null,
};

function setupSelectRows(rows: unknown[][]) {
  mocks.select.mockImplementation(() => {
    const result = rows.shift() ?? [];
    return {
      from() {
        return this;
      },
      where: async () => result,
    };
  });
}

function contextRows(shareRows?: Record<string, string>[]) {
  return [
    [
      {
        id: "recording-1",
        title: "First Clip",
        description: "First description",
      },
      {
        id: "recording-2",
        title: "Second Clip",
        description: "Second description",
      },
    ],
    [
      { recordingId: "recording-1", fullText: "A".repeat(1_500) },
      { recordingId: "recording-2", fullText: "Second transcript" },
    ],
    shareRows ?? [
      {
        id: "share-1",
        recordingId: "recording-1",
        principalId: "recipient@example.test",
        createdBy: "first-sender@example.test",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "share-2",
        recordingId: "recording-2",
        principalId: "RECIPIENT@example.test",
        createdBy: "second-sender@example.test",
        createdAt: "2026-08-02T00:00:00.000Z",
      },
    ],
  ];
}

function setupContextRows(shareRows?: Record<string, string>[]) {
  setupSelectRows(contextRows(shareRows));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.claimant = "recipient@example.test";
  mocks.listJobs.mockResolvedValue([job]);
  mocks.readConfig.mockResolvedValue({
    enabledAt: "2026-08-01T00:00:00.000Z",
  });
  mocks.claimAwaitingAi.mockResolvedValue({
    ...job,
    state: "ai_dispatched",
    aiClaimedBy: mocks.claimant,
  });
  mocks.reclaimStaleAiDispatch.mockResolvedValue({
    ...job,
    state: "ai_dispatched",
    aiClaimedBy: mocks.claimant,
  });
  mocks.resolveAccess.mockResolvedValue({ role: "viewer" });
  setupContextRows();
});

describe("list-transactional-email-ai-requests", () => {
  it("is a programmatic GET action hidden from agent tools", () => {
    expect(action.http).toEqual({ method: "GET" });
    expect(action.agentTool).toBe(false);
  });

  it("lets the direct-share recipient claim and returns exactly two bounded authoritative packets", async () => {
    const result = await claimTransactionalEmailAiRequests(mocks.claimant);

    expect(mocks.resolveAccess).not.toHaveBeenCalled();
    expect(mocks.claimAwaitingAi).toHaveBeenCalledWith(
      job.logicalKey,
      mocks.claimant,
    );
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0].contextPackets).toHaveLength(2);
    expect(result.requests[0].contextPackets).toEqual([
      expect.objectContaining({
        recordingId: "recording-1",
        senderEmail: "first-sender@example.test",
        transcriptExcerpt: "A".repeat(MAX_TRANSCRIPT_EXCERPT_LENGTH),
      }),
      expect.objectContaining({
        recordingId: "recording-2",
        senderEmail: "second-sender@example.test",
        transcriptExcerpt: "Second transcript",
      }),
    ]);
  });

  it("atomically reclaims stale browser dispatches", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T01:00:00.000Z"));
    mocks.listJobs.mockResolvedValue([
      {
        ...job,
        state: "ai_dispatched",
        aiClaimedBy: mocks.claimant,
        aiDispatchedAt: "2026-08-01T00:00:00.000Z",
      },
    ]);

    const result = await claimTransactionalEmailAiRequests(mocks.claimant);

    expect(mocks.reclaimStaleAiDispatch).toHaveBeenCalledWith(
      job.logicalKey,
      mocks.claimant,
      new Date("2026-08-01T00:30:00.000Z"),
    );
    expect(result.requests).toHaveLength(1);
    vi.useRealTimers();
  });

  it("does not let unrelated global jobs starve a later eligible claim", async () => {
    const unrelatedJobs = Array.from({ length: 11 }, (_, index) => ({
      ...job,
      logicalKey: `two-clips:unrelated-${index}@example.test`,
      recipient: `unrelated-${index}@example.test`,
      requestedBy: `sender-${index}@example.test`,
    }));
    mocks.listJobs.mockResolvedValue([...unrelatedJobs, job]);

    const result = await claimTransactionalEmailAiRequests(mocks.claimant);

    expect(result.requests).toHaveLength(1);
    expect(mocks.claimAwaitingAi).toHaveBeenCalledWith(
      job.logicalKey,
      mocks.claimant,
    );
  });

  it("ignores direct-share sender identities created before enabledAt", async () => {
    mocks.select.mockReset();
    setupContextRows([
      {
        id: "share-old",
        recordingId: "recording-1",
        principalId: "recipient@example.test",
        createdBy: "old-sender@example.test",
        createdAt: "2026-07-31T23:59:59.999Z",
      },
      {
        id: "share-new",
        recordingId: "recording-1",
        principalId: "recipient@example.test",
        createdBy: "first-sender@example.test",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "share-2",
        recordingId: "recording-2",
        principalId: "recipient@example.test",
        createdBy: "second-sender@example.test",
        createdAt: "2026-08-02T00:00:00.000Z",
      },
    ]);

    const result = await claimTransactionalEmailAiRequests(mocks.claimant);

    expect(mocks.gte).toHaveBeenCalledWith(
      "shares.createdAt",
      "2026-08-01T00:00:00.000Z",
    );
    expect(result.requests[0].contextPackets[0].senderEmail).toBe(
      "first-sender@example.test",
    );
  });

  it("denies a requestedBy sender with only generic public access to the other Clip", async () => {
    mocks.claimant = "second-sender@example.test";
    mocks.resolveAccess.mockResolvedValue({
      role: "viewer",
      resource: { visibility: "public" },
    });
    mocks.select.mockReset();
    setupSelectRows([[{ recordingId: "recording-2" }], []]);

    await expect(
      claimTransactionalEmailAiRequests(mocks.claimant),
    ).resolves.toEqual({ requests: [] });
    expect(mocks.resolveAccess).toHaveBeenCalledTimes(2);
    expect(mocks.claimAwaitingAi).not.toHaveBeenCalled();
  });

  it("allows a requestedBy sender who owns one Clip and has a direct user share to the other", async () => {
    mocks.claimant = "second-sender@example.test";
    mocks.resolveAccess
      .mockResolvedValueOnce({ role: "owner", resource: {} })
      .mockResolvedValueOnce({ role: "viewer", resource: {} });
    mocks.select.mockReset();
    setupSelectRows([[{ recordingId: "recording-2" }], [], ...contextRows()]);

    const result = await claimTransactionalEmailAiRequests(mocks.claimant);

    expect(result.requests).toHaveLength(1);
    expect(result.requests[0].contextPackets).toHaveLength(2);
    expect(mocks.claimAwaitingAi).toHaveBeenCalledWith(
      job.logicalKey,
      mocks.claimant,
    );
  });

  it("denies a sender when either recording is inaccessible and never loads transcripts", async () => {
    mocks.claimant = "second-sender@example.test";
    mocks.resolveAccess
      .mockResolvedValueOnce({ role: "viewer" })
      .mockResolvedValueOnce(null);

    await expect(
      claimTransactionalEmailAiRequests(mocks.claimant),
    ).resolves.toEqual({ requests: [] });
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.claimAwaitingAi).not.toHaveBeenCalled();
  });
});
