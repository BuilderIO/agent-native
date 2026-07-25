import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimant: "recipient@example.test",
  listJobs: vi.fn(),
  claimAwaitingAi: vi.fn(),
  resolveAccess: vi.fn(),
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
  inArray: (...args: unknown[]) => args,
}));
vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => mocks.claimant,
}));
vi.mock("../server/lib/transactional-email-store.js", () => ({
  transactionalEmailStore: {
    listJobs: (...args: unknown[]) => mocks.listJobs(...args),
    claimAwaitingAi: (...args: unknown[]) => mocks.claimAwaitingAi(...args),
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

function setupContextRows() {
  const rows = [
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
    [
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.claimant = "recipient@example.test";
  mocks.listJobs.mockResolvedValue([job]);
  mocks.claimAwaitingAi.mockResolvedValue({
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

  it("lets the recipient claim and returns exactly two bounded authoritative packets", async () => {
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

  it("lets the requestedBy sender claim only with viewer access to both recordings", async () => {
    mocks.claimant = "second-sender@example.test";
    const result = await claimTransactionalEmailAiRequests(mocks.claimant);

    expect(mocks.resolveAccess).toHaveBeenCalledTimes(2);
    expect(result.requests).toHaveLength(1);
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
