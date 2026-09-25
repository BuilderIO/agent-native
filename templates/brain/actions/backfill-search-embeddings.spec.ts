import { beforeEach, describe, expect, it, vi } from "vitest";

const candidate = {
  id: "capture-1",
  sourceId: "source-1",
  title: "Decision",
  content: "Use retrieval gates before adding connectors.",
  contentHash: "content-hash",
  sensitivityDisposition: "allowed",
  sensitivityPolicyVersion: "policy-v2",
  audienceAclHash: "acl-hash",
  capturedAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
  artifactId: null as string | null,
  artifactAudienceId: null as string | null,
  artifactAclHash: null as string | null,
  artifactTitle: null as string | null,
  artifactQuestion: null as string | null,
  artifactSummary: null as string | null,
  artifactResolution: null as string | null,
  artifactSystemsJson: null as string | null,
  artifactCodeRefsJson: null as string | null,
  embeddingId: null as string | null,
};

const readiness = {
  status: "ready" as const,
  ready: true,
  configuredProviders: ["gemini"],
  unavailableProviders: [],
  configuredFamilies: 1,
  provider: "gemini",
  model: "gemini-embedding-2",
  embeddingSetId: "gemini:gemini-embedding-2:1024",
  dimensions: 1024,
  warning: null,
};

const mocks = vi.hoisted(() => {
  const column = (name: string) => name;
  return {
    assertAccess: vi.fn(async () => undefined),
    getDb: vi.fn(),
    enqueueBrainOperation: vi.fn(),
    runWithRequestContext: vi.fn(
      async (_context: unknown, callback: () => unknown) => callback(),
    ),
    readCaptureEmbeddingCoverage: vi.fn(),
    readEmbeddingReadiness: vi.fn(),
    schema: {
      brainSources: {
        id: column("source.id"),
        ownerEmail: column("source.ownerEmail"),
        orgId: column("source.orgId"),
      },
      brainRawCaptures: {
        id: column("capture.id"),
        sourceId: column("capture.sourceId"),
        title: column("capture.title"),
        content: column("capture.content"),
        contentHash: column("capture.contentHash"),
        sensitivityDisposition: column("capture.sensitivityDisposition"),
        sensitivityPolicyVersion: column("capture.sensitivityPolicyVersion"),
        audienceAclHash: column("capture.audienceAclHash"),
        capturedAt: column("capture.capturedAt"),
        updatedAt: column("capture.updatedAt"),
      },
      brainSearchArtifacts: {
        id: column("artifact.id"),
        captureId: column("artifact.captureId"),
        audienceId: column("artifact.audienceId"),
        aclHash: column("artifact.aclHash"),
        title: column("artifact.title"),
        question: column("artifact.question"),
        summary: column("artifact.summary"),
        resolution: column("artifact.resolution"),
        systemsJson: column("artifact.systemsJson"),
        codeRefsJson: column("artifact.codeRefsJson"),
        contentHash: column("artifact.contentHash"),
        sensitivityPolicyVersion: column("artifact.sensitivityPolicyVersion"),
        indexVersion: column("artifact.indexVersion"),
        status: column("artifact.status"),
      },
      brainSearchEmbeddings: {
        id: column("embedding.id"),
        targetType: column("embedding.targetType"),
        targetId: column("embedding.targetId"),
        embeddingSetId: column("embedding.embeddingSetId"),
        contentHash: column("embedding.contentHash"),
        sensitivityPolicyVersion: column("embedding.sensitivityPolicyVersion"),
        aclHash: column("embedding.aclHash"),
        indexVersion: column("embedding.indexVersion"),
        status: column("embedding.status"),
      },
    },
  };
});

vi.mock("@agent-native/core", () => ({
  defineAction: (action: unknown) => action,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  runWithRequestContext: mocks.runWithRequestContext,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  asc: (column: unknown) => ({ type: "asc", column }),
  eq: (column: unknown, value: unknown) => ({ type: "eq", column, value }),
  gt: (column: unknown, value: unknown) => ({ type: "gt", column, value }),
  inArray: (column: unknown, values: unknown[]) => ({
    type: "in-array",
    column,
    values,
  }),
  isNotNull: (column: unknown) => ({ type: "is-not-null", column }),
  lte: (column: unknown, value: unknown) => ({ type: "lte", column, value }),
  or: (...conditions: unknown[]) => ({ type: "or", conditions }),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: mocks.getDb,
  schema: mocks.schema,
}));

vi.mock("../server/lib/brain.js", () => ({
  nowIso: () => "2026-07-21T00:00:00.000Z",
}));

vi.mock("../server/lib/ingest-queue.js", () => ({
  enqueueBrainOperation: mocks.enqueueBrainOperation,
}));

vi.mock("../server/lib/search-index.js", () => ({
  BRAIN_SEARCH_INDEX_VERSION: "1",
  readCaptureEmbeddingCoverage: mocks.readCaptureEmbeddingCoverage,
  readEmbeddingReadiness: mocks.readEmbeddingReadiness,
}));

vi.mock("../server/lib/search.js", () => ({
  redactSensitiveText: (value: string) => value,
}));

import action, {
  backfillSearchEmbeddingsNeedsApproval,
  backfillSearchEmbeddingsSchema,
} from "./backfill-search-embeddings.js";

function createDb(rows = [candidate]) {
  let selectCount = 0;
  return {
    select: vi.fn(() => {
      selectCount += 1;
      if (selectCount === 1) {
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(async () => [
                { ownerEmail: "owner@example.com", orgId: "org-1" },
              ]),
            })),
          })),
        };
      }
      return {
        from: vi.fn(() => ({
          leftJoin: vi.fn(() => ({
            leftJoin: vi.fn(() => ({
              where: vi.fn(() => ({
                orderBy: vi.fn(() => ({
                  limit: vi.fn(async () => rows),
                })),
              })),
            })),
          })),
        })),
      };
    }),
  };
}

describe("backfill-search-embeddings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readEmbeddingReadiness.mockResolvedValue(readiness);
    mocks.readCaptureEmbeddingCoverage.mockResolvedValue({
      complete: true,
      artifactEmbedded: true,
      expectedBursts: 1,
      embeddedBursts: 1,
    });
    mocks.enqueueBrainOperation.mockResolvedValue({ id: "queue-1" });
    mocks.getDb.mockReturnValue(createDb());
  });

  it("defaults to a bounded metadata-only dry run", async () => {
    const args = backfillSearchEmbeddingsSchema.parse({
      sourceId: "source-1",
    });

    const result = await action.run(args);

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "brain-source",
      "source-1",
      "admin",
    );
    expect(mocks.runWithRequestContext).toHaveBeenCalledWith(
      { userEmail: "owner@example.com", orgId: "org-1" },
      mocks.readEmbeddingReadiness,
    );
    expect(result).toMatchObject({
      dryRun: true,
      sourceId: "source-1",
      scanned: 1,
      matched: 1,
      queued: 0,
      failed: 0,
      hasMore: false,
      nextCursor: null,
      candidates: [{ captureId: "capture-1", reason: "missing-artifact" }],
      results: [],
    });
    expect(mocks.enqueueBrainOperation).not.toHaveBeenCalled();
  });

  it("requires approval and durably queues missing embeddings", async () => {
    expect(action.needsApproval).toBe(backfillSearchEmbeddingsNeedsApproval);
    expect(backfillSearchEmbeddingsNeedsApproval({ dryRun: false })).toBe(true);
    expect(backfillSearchEmbeddingsNeedsApproval({ dryRun: "false" })).toBe(
      true,
    );
    expect(backfillSearchEmbeddingsNeedsApproval({ dryRun: true })).toBe(false);
    expect(backfillSearchEmbeddingsNeedsApproval({ dryRun: "true" })).toBe(
      false,
    );
    expect(backfillSearchEmbeddingsNeedsApproval({})).toBe(false);
    expect(action.toolCallable).toBe(false);

    const result = await action.run({
      sourceId: "source-1",
      dryRun: false,
      force: false,
      limit: 25,
    });

    expect(mocks.enqueueBrainOperation).toHaveBeenCalledWith({
      operation: "search-index",
      dedupeKey: `search-index-backfill:capture-1:content-hash:${readiness.embeddingSetId}`,
      sourceId: "source-1",
      captureId: "capture-1",
      priority: 40,
      payload: { requiredEmbeddingSetId: readiness.embeddingSetId },
    });
    expect(result).toMatchObject({
      dryRun: false,
      matched: 1,
      queued: 1,
      failed: 0,
      results: [
        {
          captureId: "capture-1",
          outcome: "queued",
          queueId: "queue-1",
        },
      ],
    });
  });

  it("fails closed before execution when provider readiness is invalid", async () => {
    mocks.readEmbeddingReadiness.mockResolvedValue({
      ...readiness,
      status: "ambiguous",
      ready: false,
      embeddingSetId: null,
      warning: "Configure exactly one embedding provider.",
    });

    await expect(
      action.run({
        sourceId: "source-1",
        dryRun: false,
        force: false,
        limit: 25,
      }),
    ).rejects.toThrow("Configure exactly one embedding provider.");
    expect(mocks.enqueueBrainOperation).not.toHaveBeenCalled();
  });

  it("returns failed capture IDs when durable queueing fails", async () => {
    mocks.enqueueBrainOperation.mockRejectedValueOnce(
      new Error("queue unavailable"),
    );

    const result = await action.run({
      sourceId: "source-1",
      dryRun: false,
      force: false,
      captureIds: ["capture-1"],
      limit: 25,
    });

    expect(result).toMatchObject({
      matched: 1,
      queued: 0,
      failed: 1,
      failedCaptureIds: ["capture-1"],
      hasMore: false,
      nextCursor: null,
    });
  });

  it("includes captures with incomplete burst embeddings", async () => {
    mocks.getDb.mockReturnValue(
      createDb([
        {
          ...candidate,
          artifactId: "artifact-1",
          artifactAudienceId: "audience-1",
          artifactAclHash: "acl-hash",
          artifactTitle: "Decision",
          artifactQuestion: "Question",
          artifactSummary: "Summary",
          artifactResolution: "Resolution",
          artifactSystemsJson: "[]",
          artifactCodeRefsJson: "[]",
          embeddingId: "embedding-1",
        },
      ]),
    );
    mocks.readCaptureEmbeddingCoverage.mockResolvedValue({
      complete: false,
      artifactEmbedded: true,
      expectedBursts: 2,
      embeddedBursts: 1,
    });

    const result = await action.run({
      sourceId: "source-1",
      dryRun: true,
      force: false,
      limit: 25,
    });

    expect(result).toMatchObject({
      matched: 1,
      candidates: [{ captureId: "capture-1", reason: "partial-embedding" }],
    });
  });

  it("bounds each page and returns a resume cursor", async () => {
    const rows = Array.from({ length: 3 }, (_, index) => ({
      ...candidate,
      id: `capture-${index + 1}`,
      updatedAt: `2026-07-20T00:00:0${index}.000Z`,
    }));
    mocks.getDb.mockReturnValue(createDb(rows));

    const result = await action.run({
      sourceId: "source-1",
      dryRun: true,
      force: false,
      limit: 2,
    });

    expect(result).toMatchObject({
      scanned: 2,
      matched: 2,
      hasMore: true,
      nextCursor: {
        afterUpdatedAt: "2026-07-20T00:00:01.000Z",
        afterCaptureId: "capture-2",
        throughUpdatedAt: "2026-07-21T00:00:00.000Z",
      },
    });
  });
});
