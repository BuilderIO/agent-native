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
  artifactId: null,
  artifactAudienceId: null,
  artifactAclHash: null,
  artifactTitle: null,
  artifactQuestion: null,
  artifactSummary: null,
  artifactResolution: null,
  artifactSystemsJson: null,
  artifactCodeRefsJson: null,
  embeddingId: null,
};

const readiness = {
  status: "ready" as const,
  ready: true,
  configuredProviders: ["gemini"],
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
    indexBrainCapture: vi.fn(async () => ({ indexed: 1 })),
    indexCaptureForSearch: vi.fn(async () => ({ indexed: true })),
    readEmbeddingReadiness: vi.fn(),
    schema: {
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
  parseJson: (value: string | null, fallback: unknown) =>
    value ? JSON.parse(value) : fallback,
}));

vi.mock("../server/lib/search-index.js", () => ({
  BRAIN_SEARCH_INDEX_VERSION: "1",
  indexBrainCapture: mocks.indexBrainCapture,
  indexCaptureForSearch: mocks.indexCaptureForSearch,
  readEmbeddingReadiness: mocks.readEmbeddingReadiness,
}));

vi.mock("../server/lib/search.js", () => ({
  redactSensitiveText: (value: string) => value,
}));

import action, {
  backfillSearchEmbeddingsNeedsApproval,
  backfillSearchEmbeddingsSchema,
} from "./backfill-search-embeddings.js";

function createDb(rows = [candidate], embeddingWritten = true) {
  let selectCount = 0;
  return {
    select: vi.fn(() => {
      selectCount += 1;
      if (selectCount === 1) {
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
      }
      return {
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            innerJoin: vi.fn(() => ({
              where: vi.fn(() => ({
                limit: vi.fn(async () =>
                  embeddingWritten ? [{ id: "embedding-1" }] : [],
                ),
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
    expect(result).toMatchObject({
      dryRun: true,
      sourceId: "source-1",
      scanned: 1,
      matched: 1,
      embedded: 0,
      failed: 0,
      hasMore: false,
      nextCursor: null,
      candidates: [{ captureId: "capture-1", reason: "missing-artifact" }],
      results: [],
    });
    expect(mocks.indexBrainCapture).not.toHaveBeenCalled();
  });

  it("requires approval for execution and writes missing embeddings", async () => {
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

    expect(mocks.indexBrainCapture).toHaveBeenCalledWith("capture-1");
    expect(result).toMatchObject({
      dryRun: false,
      matched: 1,
      embedded: 1,
      failed: 0,
      results: [
        {
          captureId: "capture-1",
          outcome: "embedded",
          embedded: true,
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
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.indexBrainCapture).not.toHaveBeenCalled();
  });

  it("returns failed capture IDs for explicit retry", async () => {
    mocks.getDb.mockReturnValue(createDb([candidate], false));

    const result = await action.run({
      sourceId: "source-1",
      dryRun: false,
      force: false,
      captureIds: ["capture-1"],
      limit: 25,
    });

    expect(result).toMatchObject({
      matched: 1,
      embedded: 0,
      failed: 1,
      failedCaptureIds: ["capture-1"],
      hasMore: false,
      nextCursor: null,
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
