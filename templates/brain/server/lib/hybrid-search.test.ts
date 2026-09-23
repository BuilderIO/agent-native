import type { EmbeddingFamily } from "@agent-native/core/embeddings";
import { describe, expect, it } from "vitest";
import { beforeEach, vi } from "vitest";

interface HybridTestColumn {
  table: string;
  name: string;
}

type HybridTestCondition =
  | { type: "access" }
  | { type: "and"; conditions: HybridTestCondition[] }
  | { type: "or"; conditions: HybridTestCondition[] }
  | { type: "eq"; column: HybridTestColumn; value: unknown }
  | { type: "gte"; column: HybridTestColumn; value: unknown }
  | { type: "in-array"; column: HybridTestColumn; values: unknown[] }
  | { type: "ne"; column: HybridTestColumn; value: unknown };

type HybridTestRow = Record<string, unknown>;

const hybridMocks = vi.hoisted(() => {
  const column = (table: string, name: string) => ({ table, name });
  const createTable = (name: string, columns: string[]) =>
    Object.fromEntries([
      ["__tableName", name],
      ...columns.map((columnName) => [columnName, column(name, columnName)]),
    ]);
  const schema = {
    brainSearchArtifacts: createTable("artifact", [
      "id",
      "captureId",
      "sourceId",
      "audienceId",
      "aclHash",
      "title",
      "question",
      "summary",
      "resolution",
      "contentHash",
      "sensitivityPolicyVersion",
      "indexVersion",
      "status",
      "capturedAt",
    ]),
    brainSources: createTable("source", ["id", "provider"]),
    brainSourceShares: createTable("sourceShare", ["id"]),
    brainRawCaptures: createTable("capture", [
      "id",
      "kind",
      "contentHash",
      "audienceAclHash",
      "sensitivityDisposition",
      "sensitivityPolicyVersion",
    ]),
    brainSearchEmbeddings: createTable("embedding", [
      "vectorKey",
      "targetType",
      "targetId",
      "audienceId",
      "status",
    ]),
    brainSearchBursts: createTable("burst", ["id", "artifactId"]),
    brainProjectSources: createTable("projectSource", [
      "sourceId",
      "projectId",
    ]),
    brainProjects: createTable("project", ["id"]),
    brainProjectShares: createTable("projectShare", ["id"]),
    brainAudiences: createTable("audience", [
      "id",
      "sourceId",
      "membershipState",
      "kind",
      "lastSyncedAt",
    ]),
    brainAudienceMembers: createTable("audienceMember", [
      "audienceId",
      "principalType",
      "principalId",
      "status",
    ]),
    brainAudienceDependencies: createTable("audienceDependency", [
      "audienceId",
      "dependsOnAudienceId",
    ]),
    brainAudienceSourceDependencies: createTable("audienceSourceDependency", [
      "audienceId",
      "sourceId",
    ]),
  };
  const rows = {
    artifacts: [] as HybridTestRow[],
    audiences: [] as HybridTestRow[],
    audienceDependencies: [] as HybridTestRow[],
    audienceSourceDependencies: [] as HybridTestRow[],
    embeddings: [] as HybridTestRow[],
    bursts: [] as HybridTestRow[],
    sources: [] as HybridTestRow[],
  };
  const rowValue = (row: HybridTestRow, value: unknown) => {
    if (
      value &&
      typeof value === "object" &&
      "table" in value &&
      "name" in value
    ) {
      const candidate = value as HybridTestColumn;
      return row[`${candidate.table}.${candidate.name}`];
    }
    return value;
  };
  const matches = (
    row: HybridTestRow,
    condition?: HybridTestCondition,
  ): boolean => {
    if (!condition || condition.type === "access") return true;
    if (condition.type === "and") {
      return condition.conditions.every((candidate) => matches(row, candidate));
    }
    if (condition.type === "or") {
      return condition.conditions.some((candidate) => matches(row, candidate));
    }
    if (condition.type === "eq") {
      return rowValue(row, condition.column) === rowValue(row, condition.value);
    }
    if (condition.type === "ne") {
      return rowValue(row, condition.column) !== rowValue(row, condition.value);
    }
    if (condition.type === "gte") {
      return String(rowValue(row, condition.column)) >= String(condition.value);
    }
    return condition.values.includes(rowValue(row, condition.column));
  };
  const tableRows = (tableRef: Record<string, unknown>) => {
    if (tableRef === schema.brainSearchArtifacts) return rows.artifacts;
    if (tableRef === schema.brainSearchEmbeddings) return rows.embeddings;
    if (tableRef === schema.brainSearchBursts) return rows.bursts;
    if (tableRef === schema.brainAudiences) return rows.audiences;
    if (tableRef === schema.brainAudienceDependencies) {
      return rows.audienceDependencies;
    }
    if (tableRef === schema.brainAudienceSourceDependencies) {
      return rows.audienceSourceDependencies;
    }
    if (tableRef === schema.brainSources) return rows.sources;
    return [];
  };
  const project = (row: HybridTestRow, selection: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(selection).map(([key, value]) => [
        key,
        rowValue(row, value),
      ]),
    );
  const select = vi.fn((selection: Record<string, unknown>) => ({
    from: (tableRef: Record<string, unknown>) => {
      const chain = {
        innerJoin: () => chain,
        where: (condition: HybridTestCondition) => {
          const selectedRows = () =>
            tableRows(tableRef)
              .filter((row) => matches(row, condition))
              .map((row) => project(row, selection));
          const query = {
            orderBy: () => ({
              limit: async (limit: number) => selectedRows().slice(0, limit),
            }),
            limit: async (limit: number) => selectedRows().slice(0, limit),
            then: <TResult1 = HybridTestRow[], TResult2 = never>(
              onFulfilled?:
                | ((value: HybridTestRow[]) => TResult1 | PromiseLike<TResult1>)
                | null,
              onRejected?:
                | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
                | null,
            ) => Promise.resolve(selectedRows()).then(onFulfilled, onRejected),
          };
          return query;
        },
      };
      return chain;
    },
  }));
  return {
    availableEmbeddingFamilies: vi.fn(),
    embeddingFamily: {
      id: "gemini:test:3",
      provider: "gemini",
      model: "test-model",
      version: "test",
      dimensions: 3,
      embed: vi.fn(async () => [[0.1, 0.2, 0.3]]),
    },
    getDbExec: vi.fn(() => ({ execute: vi.fn() })),
    queryPgVectorIndex: vi.fn(),
    queryPostgresFts: vi.fn(),
    rows,
    schema,
    select,
  };
});

vi.mock("@agent-native/core/db", () => ({
  getDbExec: hybridMocks.getDbExec,
}));

vi.mock("@agent-native/core/embeddings", () => ({
  availableEmbeddingFamilies: hybridMocks.availableEmbeddingFamilies,
  defaultEmbeddingFamily: (families: EmbeddingFamily[]) =>
    families.length === 1 ? families[0] : null,
}));

vi.mock("@agent-native/core/search", () => ({
  deletePgVectors: vi.fn(),
  deletePostgresFtsDocuments: vi.fn(),
  ensurePgVectorIndex: vi.fn(),
  queryPgVectorIndex: hybridMocks.queryPgVectorIndex,
  queryPostgresFts: hybridMocks.queryPostgresFts,
  upsertPgVector: vi.fn(),
  upsertPostgresFtsDocument: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: () => ({ type: "access" }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: Array<HybridTestCondition | undefined>) => ({
    type: "and",
    conditions: conditions.filter(Boolean),
  }),
  desc: (column: HybridTestColumn) => column,
  eq: (column: HybridTestColumn, value: unknown) => ({
    type: "eq",
    column,
    value,
  }),
  gte: (column: HybridTestColumn, value: unknown) => ({
    type: "gte",
    column,
    value,
  }),
  inArray: (column: HybridTestColumn, values: unknown[]) => ({
    type: "in-array",
    column,
    values,
  }),
  ne: (column: HybridTestColumn, value: unknown) => ({
    type: "ne",
    column,
    value,
  }),
  or: (...conditions: Array<HybridTestCondition | undefined>) => ({
    type: "or",
    conditions: conditions.filter(Boolean),
  }),
  sql: () => ({ type: "access" }),
}));

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    select: hybridMocks.select,
    selectDistinct: hybridMocks.select,
  }),
  schema: hybridMocks.schema,
}));

import { runWithRequestContext } from "@agent-native/core/server/request-context";

import {
  hybridSearchArtifacts,
  incrementalIdf,
  lexicalScore,
  reciprocalRankFusion,
} from "./hybrid-search.js";
import {
  burstText,
  burstRows,
  canIndexCapture,
  deterministicArtifact,
  embedSearchTexts,
  embeddingReadinessFromFamilies,
  indexSnapshotMatches,
  indexStalenessKey,
} from "./search-index.js";

describe("Brain search index primitives", () => {
  it("gates indexing on allowed, versioned, audience-addressable captures", () => {
    const allowed = {
      id: "c",
      sourceId: "s",
      title: "t",
      content: "x",
      contentHash: "h",
      sensitivityDisposition: "allowed" as const,
      sensitivityPolicyVersion: "1",
      audienceAclHash: "a",
      capturedAt: "2026-01-01",
    };
    expect(canIndexCapture(allowed)).toBe(true);
    expect(
      canIndexCapture({
        id: "c",
        sourceId: "s",
        title: "t",
        content: "x",
        contentHash: "h",
        sensitivityDisposition: "pending",
        sensitivityPolicyVersion: "1",
        audienceAclHash: "a",
        capturedAt: "2026-01-01",
      }),
    ).toBe(false);
    expect(indexStalenessKey({ contentHash: "h", aclHash: "a" })).toMatchObject(
      { contentHash: "h", aclHash: "a" },
    );
    expect(indexSnapshotMatches(allowed, allowed, "a")).toBe(true);
    expect(
      indexSnapshotMatches(
        { ...allowed, sensitivityDisposition: "pending" },
        allowed,
        "a",
      ),
    ).toBe(false);
    expect(
      indexSnapshotMatches({ ...allowed, contentHash: "new" }, allowed, "a"),
    ).toBe(false);
  });

  it("uses deterministic artifacts and bounded overlapping bursts", () => {
    expect(
      deterministicArtifact({
        title: " Decision ",
        content: "One. Two. Three.",
      }).summary,
    ).toBe("One. Two. Three.");
    expect(burstText("a".repeat(1_800), 800, 200)).toHaveLength(3);
    const persisted = "  First line.\nSecond   line.\n";
    for (const burst of burstRows(persisted, 12, 3)) {
      expect(persisted.slice(burst.startOffset, burst.endOffset)).toBe(
        burst.content,
      );
    }
  });

  it("favors rare lexical terms and fuses lanes with RRF", () => {
    expect(
      incrementalIdf("rare", ["rare", "common", "common"]),
    ).toBeGreaterThan(incrementalIdf("common", ["rare", "common", "common"]));
    expect(
      lexicalScore("rare item", ["rare"], ["rare item", "common item"]),
    ).toBeGreaterThan(0);
    const [winner] = reciprocalRankFusion([
      {
        id: "both",
        artifactId: "a",
        captureId: "c",
        sourceId: "s",
        audienceId: "u",
        title: "",
        text: "",
        capturedAt: "2026-01-01",
        lexicalRank: 2,
        semanticRank: 1,
        lane: "hybrid",
      },
      {
        id: "one",
        artifactId: "b",
        captureId: "d",
        sourceId: "s",
        audienceId: "u",
        title: "",
        text: "",
        capturedAt: "2026-01-01",
        lexicalRank: 1,
        lane: "lexical",
      },
    ]);
    expect(winner.id).toBe("both");
  });
});

function artifactRow(input: {
  id: string;
  audienceId?: string;
  capturedAt: string;
  title: string;
  question?: string;
  summary: string;
  resolution?: string;
}) {
  const audienceId = input.audienceId ?? "audience-allowed";
  const captureId = `capture-${input.id}`;
  return {
    "artifact.id": input.id,
    "artifact.captureId": captureId,
    "artifact.sourceId": "source-1",
    "artifact.audienceId": audienceId,
    "artifact.aclHash": "acl-1",
    "artifact.title": input.title,
    "artifact.question": input.question ?? "",
    "artifact.summary": input.summary,
    "artifact.resolution": input.resolution ?? "",
    "artifact.contentHash": `hash-${input.id}`,
    "artifact.sensitivityPolicyVersion": "2",
    "artifact.indexVersion": "1",
    "artifact.status": "active",
    "artifact.capturedAt": input.capturedAt,
    "capture.id": captureId,
    "capture.contentHash": `hash-${input.id}`,
    "capture.audienceAclHash": "acl-1",
    "capture.sensitivityDisposition": "allowed",
    "capture.sensitivityPolicyVersion": "2",
    "source.id": "source-1",
    "source.provider": "slack",
  };
}

describe("Brain hybrid search pipeline", () => {
  const searchAs = (
    userEmail: string,
    input: Parameters<typeof hybridSearchArtifacts>[0],
  ) => runWithRequestContext({ userEmail }, () => hybridSearchArtifacts(input));

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    for (const rows of Object.values(hybridMocks.rows)) rows.length = 0;
    hybridMocks.rows.audiences.push({
      "audience.id": "audience-allowed",
      "audience.sourceId": "source-1",
      "audience.membershipState": "current",
      "audience.kind": "meeting",
      "audience.lastSyncedAt": "2026-07-21T00:00:00.000Z",
      "audienceMember.audienceId": "audience-allowed",
      "audienceMember.principalType": "user",
      "audienceMember.principalId": "leader@example.com",
      "audienceMember.status": "active",
    });
    hybridMocks.availableEmbeddingFamilies.mockResolvedValue([
      hybridMocks.embeddingFamily,
    ]);
    hybridMocks.queryPostgresFts.mockResolvedValue([]);
    hybridMocks.queryPgVectorIndex.mockResolvedValue([]);
  });

  it("retrieves an accessible semantic paraphrase through a burst vector", async () => {
    const artifactText = "Shorten enterprise onboarding latency.";
    expect(
      lexicalScore(
        artifactText,
        ["reduce", "customer", "waiting"],
        [artifactText],
      ),
    ).toBe(0);
    hybridMocks.rows.artifacts.push(
      artifactRow({
        id: "artifact-semantic",
        capturedAt: "2026-07-20T00:00:00.000Z",
        title: "Enterprise activation decision",
        summary: artifactText,
      }),
      artifactRow({
        id: "artifact-private",
        audienceId: "audience-private",
        capturedAt: "2026-07-21T00:00:00.000Z",
        title: "Private activation decision",
        summary: "Confidential enterprise activation details.",
      }),
    );
    hybridMocks.rows.embeddings.push(
      {
        "embedding.vectorKey": "vector-allowed",
        "embedding.targetType": "burst",
        "embedding.targetId": "burst-allowed",
        "embedding.audienceId": "audience-allowed",
        "embedding.status": "active",
      },
      {
        "embedding.vectorKey": "vector-private",
        "embedding.targetType": "burst",
        "embedding.targetId": "burst-private",
        "embedding.audienceId": "audience-private",
        "embedding.status": "active",
      },
    );
    hybridMocks.rows.bursts.push(
      {
        "burst.id": "burst-allowed",
        "burst.artifactId": "artifact-semantic",
      },
      {
        "burst.id": "burst-private",
        "burst.artifactId": "artifact-private",
      },
    );
    hybridMocks.queryPgVectorIndex.mockResolvedValue([
      { vectorKey: "vector-allowed", score: 0.9 },
      { vectorKey: "vector-private", score: 0.8 },
    ]);

    const results = await searchAs("leader@example.com", {
      query: "reduce customer waiting",
    });

    expect(hybridMocks.embeddingFamily.embed).toHaveBeenCalledWith(
      [{ text: "reduce customer waiting" }],
      "query",
    );
    expect(hybridMocks.queryPgVectorIndex).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        allowedAudienceIds: ["audience-allowed"],
        embeddingSetId: "gemini:test:3",
      }),
      true,
    );
    expect(results).toMatchObject([
      {
        id: "artifact-semantic",
        lane: "semantic",
        reasons: expect.arrayContaining(["semantic-match"]),
      },
    ]);
    expect(results.some((result) => result.id === "artifact-private")).toBe(
      false,
    );
  });

  it("calculates freshness and lets it resolve adjacent external ranks", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T00:00:00.000Z"));
    hybridMocks.rows.artifacts.push(
      artifactRow({
        id: "old-claim",
        capturedAt: "2025-01-01T00:00:00.000Z",
        title: "Old rollout claim",
        summary: "Launch connector marketplace first.",
      }),
      artifactRow({
        id: "current-claim",
        capturedAt: "2026-07-20T00:00:00.000Z",
        title: "Current rollout claim",
        summary: "Use retrieval quality gates before more connectors.",
      }),
    );
    hybridMocks.rows.embeddings.push(
      {
        "embedding.vectorKey": "vector-old",
        "embedding.targetType": "artifact",
        "embedding.targetId": "old-claim",
        "embedding.audienceId": "audience-allowed",
        "embedding.status": "active",
      },
      {
        "embedding.vectorKey": "vector-current",
        "embedding.targetType": "artifact",
        "embedding.targetId": "current-claim",
        "embedding.audienceId": "audience-allowed",
        "embedding.status": "active",
      },
    );
    hybridMocks.queryPostgresFts.mockResolvedValue([
      { chunkId: "old-claim", score: 0.9 },
      { chunkId: "current-claim", score: 0.8 },
    ]);
    hybridMocks.queryPgVectorIndex.mockResolvedValue([
      { vectorKey: "vector-old", score: 0.9 },
      { vectorKey: "vector-current", score: 0.8 },
    ]);

    const [winner] = await searchAs("leader@example.com", {
      query: "rollout choice",
    });

    expect(winner.id).toBe("current-claim");
    expect(winner.reasons).toContain("fresh");
    expect(winner.lane).toBe("hybrid");
  });

  it("resolves audience dependencies from each request principal before retrieval", async () => {
    hybridMocks.rows.audiences.length = 0;
    hybridMocks.rows.audiences.push(
      ...["leader@example.com", "employee@example.com"].flatMap((principalId) =>
        ["derived", "company"].map((audienceId) => ({
          "audience.id": audienceId,
          "audience.sourceId": "source-1",
          "audience.membershipState": "current",
          "audience.kind": "meeting",
          "audience.lastSyncedAt": "2026-07-21T00:00:00.000Z",
          "audienceMember.audienceId": audienceId,
          "audienceMember.principalType": "user",
          "audienceMember.principalId": principalId,
          "audienceMember.status": "active",
        })),
      ),
      {
        "audience.id": "private-leadership",
        "audience.sourceId": "source-1",
        "audience.membershipState": "current",
        "audience.kind": "meeting",
        "audience.lastSyncedAt": "2026-07-21T00:00:00.000Z",
        "audienceMember.audienceId": "private-leadership",
        "audienceMember.principalType": "user",
        "audienceMember.principalId": "leader@example.com",
        "audienceMember.status": "active",
      },
    );
    hybridMocks.rows.audienceDependencies.push(
      {
        "audienceDependency.audienceId": "derived",
        "audienceDependency.dependsOnAudienceId": "company",
      },
      {
        "audienceDependency.audienceId": "derived",
        "audienceDependency.dependsOnAudienceId": "private-leadership",
      },
    );
    hybridMocks.rows.artifacts.push(
      artifactRow({
        id: "leadership-decision",
        audienceId: "derived",
        capturedAt: "2026-07-20T00:00:00.000Z",
        title: "Leadership launch sequence",
        summary: "Stage the confidential launch behind quality gates.",
      }),
    );
    hybridMocks.rows.embeddings.push({
      "embedding.vectorKey": "vector-leadership",
      "embedding.targetType": "artifact",
      "embedding.targetId": "leadership-decision",
      "embedding.audienceId": "derived",
      "embedding.status": "active",
    });
    hybridMocks.queryPostgresFts.mockResolvedValue([
      { chunkId: "leadership-decision", score: 0.9 },
    ]);
    hybridMocks.queryPgVectorIndex.mockResolvedValue([
      { vectorKey: "vector-leadership", score: 0.9 },
    ]);

    const leadershipResults = await searchAs("leader@example.com", {
      query: "restricted roadmap",
    });
    const employeeResults = await searchAs("employee@example.com", {
      query: "restricted roadmap",
    });

    expect(leadershipResults.map((result) => result.id)).toContain(
      "leadership-decision",
    );
    expect(employeeResults).toEqual([]);
    expect(hybridMocks.queryPgVectorIndex).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ allowedAudienceIds: ["company"] }),
      true,
    );
  });
});

describe("Brain embedding readiness", () => {
  const family: EmbeddingFamily = {
    id: "gemini:test:3",
    provider: "gemini",
    model: "test-model",
    version: "test",
    dimensions: 3,
    embed: vi.fn(async () => [[0.1, 0.2, 0.3]]),
  };

  beforeEach(() => {
    vi.mocked(family.embed).mockClear();
  });

  it("reports exactly one configured family as ready without credential data", () => {
    expect(embeddingReadinessFromFamilies([family])).toEqual({
      status: "ready",
      ready: true,
      configuredProviders: ["gemini"],
      configuredFamilies: 1,
      provider: "gemini",
      model: "test-model",
      embeddingSetId: "gemini:test:3",
      dimensions: 3,
      warning: null,
    });
  });

  it("reports missing and ambiguous provider configurations", () => {
    expect(embeddingReadinessFromFamilies([])).toMatchObject({
      status: "not-configured",
      ready: false,
      configuredFamilies: 0,
    });
    expect(embeddingReadinessFromFamilies([family, family])).toMatchObject({
      status: "ambiguous",
      ready: false,
      configuredFamilies: 2,
    });
  });

  it("embeds document text when a family is configured", async () => {
    await expect(embedSearchTexts(family, ["safe artifact"])).resolves.toEqual([
      [0.1, 0.2, 0.3],
    ]);
    expect(family.embed).toHaveBeenCalledWith(
      [{ text: "safe artifact" }],
      "document",
    );
    await expect(embedSearchTexts(null, ["safe artifact"])).resolves.toBeNull();
  });
});
