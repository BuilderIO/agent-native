import { beforeEach, describe, expect, it, vi } from "vitest";

const candidates = [
  {
    id: "capture-1",
    sourceId: "source-1",
    contentHash: "content-hash-1",
    sensitivityPolicyVersion: null,
    audienceAclHash: null,
  },
  {
    id: "capture-2",
    sourceId: "source-1",
    contentHash: "content-hash-2",
    sensitivityPolicyVersion: "legacy-policy",
    audienceAclHash: "legacy-acl",
  },
];

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(async () => undefined),
  contentHash: vi.fn(async () => "empty-content-hash"),
  enqueueCaptureInvalidation: vi.fn(async () => undefined),
  getDb: vi.fn(),
  invalidateDerivedForCapture: vi.fn(async () => undefined),
  updateSet: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (action: unknown) => action,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  asc: (column: unknown) => ({ type: "asc", column }),
  eq: (column: unknown, value: unknown) => ({ type: "eq", column, value }),
  isNull: (column: unknown) => ({ type: "is-null", column }),
  ne: (column: unknown, value: unknown) => ({ type: "ne", column, value }),
  notExists: (query: unknown) => ({ type: "not-exists", query }),
  or: (...conditions: unknown[]) => ({ type: "or", conditions }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: mocks.getDb,
  schema: {
    brainCaptureAudiences: {
      id: "captureAudience.id",
      captureId: "captureAudience.captureId",
    },
    brainRawCaptures: {
      id: "capture.id",
      sourceId: "capture.sourceId",
      contentHash: "capture.contentHash",
      sensitivityDisposition: "capture.sensitivityDisposition",
      sensitivityPolicyVersion: "capture.sensitivityPolicyVersion",
      audienceAclHash: "capture.audienceAclHash",
    },
  },
}));

vi.mock("../server/lib/brain.js", () => ({
  contentHash: mocks.contentHash,
  invalidateDerivedForCapture: mocks.invalidateDerivedForCapture,
  nowIso: () => "2026-07-19T12:00:00.000Z",
}));

vi.mock("../server/lib/ingest-queue.js", () => ({
  enqueueCaptureInvalidation: mocks.enqueueCaptureInvalidation,
}));

import action, {
  remediateLegacyCaptureAudiencesSchema,
} from "./remediate-legacy-capture-audiences.js";

function createDb(rowsAffected = [1, 1]) {
  const updateWhere = vi.fn().mockImplementation(async () => ({
    rowsAffected: rowsAffected.shift() ?? 0,
  }));
  const queryLimit = vi.fn(async () => candidates);
  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        if (table === "captureAudience") {
          return { where: vi.fn(() => ({ type: "subquery" })) };
        }
        return {
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({ limit: queryLimit })),
          })),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: mocks.updateSet.mockImplementation(() => ({ where: updateWhere })),
    })),
  };
  return { db, queryLimit, updateWhere };
}

describe("remediate-legacy-capture-audiences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to a metadata-only dry run", async () => {
    const { db } = createDb();
    mocks.getDb.mockReturnValue(db);
    const args = remediateLegacyCaptureAudiencesSchema.parse({
      sourceId: "source-1",
    });

    const result = await action.run(args);

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "brain-source",
      "source-1",
      "editor",
    );
    expect(result).toEqual({
      dryRun: true,
      sourceId: "source-1",
      matchedCount: 2,
      remediatedCount: 0,
      skippedCount: 0,
      matchedCaptureIds: ["capture-1", "capture-2"],
      remediatedCaptureIds: [],
      skippedCaptureIds: [],
    });
    expect(db.update).not.toHaveBeenCalled();
    expect(mocks.contentHash).not.toHaveBeenCalled();
    expect(mocks.invalidateDerivedForCapture).not.toHaveBeenCalled();
    expect(mocks.enqueueCaptureInvalidation).not.toHaveBeenCalled();
  });

  it("accepts an explicit false value from CLI-style inputs", () => {
    expect(
      remediateLegacyCaptureAudiencesSchema.parse({
        sourceId: "source-1",
        dryRun: "false",
      }),
    ).toEqual({ sourceId: "source-1", dryRun: false, limit: 50 });
  });

  it("bounds hosted runs to at most 50 captures", async () => {
    const { db, queryLimit } = createDb();
    mocks.getDb.mockReturnValue(db);

    await action.run({ sourceId: "source-1", dryRun: true, limit: 12 });

    expect(queryLimit).toHaveBeenCalledWith(12);
    expect(() =>
      remediateLegacyCaptureAudiencesSchema.parse({
        sourceId: "source-1",
        limit: 51,
      }),
    ).toThrow();
  });

  it("scrubs captures, invalidates derived data, and returns IDs only", async () => {
    const { db } = createDb([1, 1, 1, 1]);
    mocks.getDb.mockReturnValue(db);

    const result = await action.run({
      sourceId: "source-1",
      dryRun: false,
      limit: 50,
    });

    expect(mocks.contentHash).toHaveBeenCalledWith("");
    expect(db.update).toHaveBeenCalledTimes(4);
    expect(mocks.updateSet).toHaveBeenCalledTimes(4);
    expect(mocks.updateSet).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        title: "Legacy capture removed",
        content: "",
        contentHash: "empty-content-hash",
        metadataJson: "{}",
        status: "ignored",
        sensitivityDisposition: "pending",
        audienceAclHash: null,
      }),
    );
    expect(mocks.updateSet.mock.calls[0]?.[0]).not.toHaveProperty(
      "sensitivityPolicyVersion",
    );
    expect(mocks.updateSet).toHaveBeenNthCalledWith(2, {
      sensitivityPolicyVersion: "legacy-audience-remediation-v1",
      updatedAt: "2026-07-19T12:00:00.000Z",
    });
    expect(mocks.invalidateDerivedForCapture).toHaveBeenCalledTimes(2);
    expect(mocks.invalidateDerivedForCapture).toHaveBeenNthCalledWith(
      1,
      "capture-1",
    );
    expect(mocks.enqueueCaptureInvalidation).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      dryRun: false,
      sourceId: "source-1",
      matchedCount: 2,
      remediatedCount: 2,
      skippedCount: 0,
      matchedCaptureIds: ["capture-1", "capture-2"],
      remediatedCaptureIds: ["capture-1", "capture-2"],
      skippedCaptureIds: [],
    });
    expect(Object.keys(result).some((key) => key.includes("content"))).toBe(
      false,
    );
  });

  it("leaves a scrubbed capture selectable when derived cleanup fails", async () => {
    const { db } = createDb([1, 1, 1]);
    mocks.getDb.mockReturnValue(db);
    mocks.invalidateDerivedForCapture.mockRejectedValueOnce(
      new Error("canonical cleanup failed"),
    );

    await expect(
      action.run({ sourceId: "source-1", dryRun: false, limit: 50 }),
    ).rejects.toThrow("canonical cleanup failed");

    expect(mocks.updateSet).toHaveBeenCalledTimes(1);
    expect(mocks.updateSet.mock.calls[0]?.[0]).not.toHaveProperty(
      "sensitivityPolicyVersion",
    );
    expect(mocks.enqueueCaptureInvalidation).not.toHaveBeenCalled();

    mocks.invalidateDerivedForCapture.mockResolvedValue(undefined);
    const retried = await action.run({
      sourceId: "source-1",
      dryRun: false,
      limit: 50,
    });

    expect(mocks.updateSet).toHaveBeenNthCalledWith(3, {
      sensitivityPolicyVersion: "legacy-audience-remediation-v1",
      updatedAt: "2026-07-19T12:00:00.000Z",
    });
    expect(retried.remediatedCaptureIds).toContain("capture-1");
  });

  it("does not invalidate a capture that gains audience lineage before update", async () => {
    const { db } = createDb([0, 1, 1]);
    mocks.getDb.mockReturnValue(db);

    const result = await action.run({
      sourceId: "source-1",
      dryRun: false,
      limit: 50,
    });

    expect(mocks.invalidateDerivedForCapture).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateDerivedForCapture).toHaveBeenCalledWith("capture-2");
    expect(mocks.enqueueCaptureInvalidation).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      matchedCount: 2,
      remediatedCount: 1,
      skippedCount: 1,
      remediatedCaptureIds: ["capture-2"],
      skippedCaptureIds: ["capture-1"],
    });
  });
});
