import { getDbExec, isPostgres } from "@agent-native/core/db";
import {
  availableEmbeddingFamilies,
  defaultEmbeddingFamily,
} from "@agent-native/core/embeddings";
import {
  queryPgVectorIndex,
  queryPostgresFts,
} from "@agent-native/core/search";
import { normalizeSearchTerms } from "@agent-native/core/search-utils";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq, inArray } from "drizzle-orm";

import type {
  BrainCaptureKind,
  BrainSourceProvider,
} from "../../shared/types.js";
import { getDb, schema } from "../db/index.js";
import { listAccessibleAudienceIds } from "./audiences.js";
import { BRAIN_SEARCH_INDEX_VERSION } from "./search-index-contracts.js";

export interface HybridCandidate {
  id: string;
  artifactId: string;
  captureId: string;
  sourceId: string;
  audienceId: string;
  title: string;
  text: string;
  capturedAt: string;
  lexicalRank?: number;
  semanticRank?: number;
  authority?: number;
  freshness?: number;
  lane: "lexical" | "semantic" | "hybrid";
}

export interface HybridSearchResult extends HybridCandidate {
  score: number;
  reasons: string[];
}

export const RRF_K = 60;
const SEARCH_NAMESPACE = "brain";

export function reciprocalRankFusion(
  candidates: HybridCandidate[],
  k = RRF_K,
): HybridSearchResult[] {
  return candidates
    .map((candidate) => {
      const lexical = candidate.lexicalRank
        ? 1 / (k + candidate.lexicalRank)
        : 0;
      const semantic = candidate.semanticRank
        ? 1 / (k + candidate.semanticRank)
        : 0;
      const authority = candidate.authority ?? 0;
      const freshness = candidate.freshness ?? 0;
      const reasons = [
        ...(candidate.lexicalRank ? ["lexical-match"] : []),
        ...(candidate.semanticRank ? ["semantic-match"] : []),
        ...(authority > 0 ? ["authority"] : []),
        ...(freshness > 0 ? ["fresh"] : []),
      ];
      return {
        ...candidate,
        score: lexical + semantic + authority * 0.01 + freshness * 0.005,
        reasons,
      };
    })
    .sort(
      (a, b) => b.score - a.score || b.capturedAt.localeCompare(a.capturedAt),
    );
}

export function incrementalIdf(
  term: string,
  documents: readonly string[],
): number {
  const normalized = term.toLowerCase();
  const count = documents.filter((document) =>
    document.toLowerCase().includes(normalized),
  ).length;
  return Math.log((documents.length + 1) / (count + 1)) + 1;
}

export function lexicalScore(
  text: string,
  terms: string[],
  corpus: readonly string[],
): number {
  const lower = text.toLowerCase();
  return terms.reduce(
    (score, term) =>
      score + (lower.includes(term) ? incrementalIdf(term, corpus) : 0),
    0,
  );
}

/** Audience membership is the first database predicate for every index lane. */
export async function hybridSearchArtifacts(input: {
  query: string;
  provider?: string;
  kind?: string;
  projectId?: string;
  limit?: number;
  rerank?: boolean;
}): Promise<HybridSearchResult[]> {
  const terms = normalizeSearchTerms(input.query);
  if (!terms.length) return [];
  const db = getDb();
  const projectSourceIds = input.projectId
    ? (
        await db
          .select({ sourceId: schema.brainProjectSources.sourceId })
          .from(schema.brainProjectSources)
          .innerJoin(
            schema.brainProjects,
            eq(schema.brainProjects.id, schema.brainProjectSources.projectId),
          )
          .where(
            and(
              eq(schema.brainProjectSources.projectId, input.projectId),
              accessFilter(schema.brainProjects, schema.brainProjectShares),
            ),
          )
      ).map((row) => row.sourceId)
    : undefined;
  if (projectSourceIds && !projectSourceIds.length) return [];
  const audienceIds = await listAccessibleAudienceIds(projectSourceIds);
  if (!audienceIds.length) return [];
  const baseFilter = and(
    eq(schema.brainSearchArtifacts.status, "active"),
    eq(schema.brainRawCaptures.sensitivityDisposition, "allowed"),
    eq(
      schema.brainSearchArtifacts.contentHash,
      schema.brainRawCaptures.contentHash,
    ),
    eq(
      schema.brainSearchArtifacts.aclHash,
      schema.brainRawCaptures.audienceAclHash,
    ),
    eq(
      schema.brainSearchArtifacts.sensitivityPolicyVersion,
      schema.brainRawCaptures.sensitivityPolicyVersion,
    ),
    eq(schema.brainSearchArtifacts.indexVersion, BRAIN_SEARCH_INDEX_VERSION),
    inArray(schema.brainSearchArtifacts.audienceId, audienceIds),
    accessFilter(schema.brainSources, schema.brainSourceShares),
    projectSourceIds
      ? inArray(schema.brainSearchArtifacts.sourceId, projectSourceIds)
      : undefined,
    input.provider
      ? eq(schema.brainSources.provider, input.provider as BrainSourceProvider)
      : undefined,
    input.kind
      ? eq(schema.brainRawCaptures.kind, input.kind as BrainCaptureKind)
      : undefined,
  );
  const selectArtifacts = (artifactIds?: string[]) =>
    db
      .select({
        id: schema.brainSearchArtifacts.id,
        captureId: schema.brainSearchArtifacts.captureId,
        sourceId: schema.brainSearchArtifacts.sourceId,
        audienceId: schema.brainSearchArtifacts.audienceId,
        title: schema.brainSearchArtifacts.title,
        question: schema.brainSearchArtifacts.question,
        summary: schema.brainSearchArtifacts.summary,
        resolution: schema.brainSearchArtifacts.resolution,
        capturedAt: schema.brainSearchArtifacts.capturedAt,
      })
      .from(schema.brainSearchArtifacts)
      .innerJoin(
        schema.brainSources,
        eq(schema.brainSources.id, schema.brainSearchArtifacts.sourceId),
      )
      .innerJoin(
        schema.brainRawCaptures,
        eq(schema.brainRawCaptures.id, schema.brainSearchArtifacts.captureId),
      )
      .where(
        and(
          baseFilter,
          artifactIds?.length
            ? inArray(schema.brainSearchArtifacts.id, artifactIds)
            : undefined,
        ),
      );
  const recentRows = await selectArtifacts()
    .orderBy(desc(schema.brainSearchArtifacts.capturedAt))
    .limit(Math.max((input.limit ?? 25) * 5, 50));
  let ftsRanks = new Map<string, number>();
  let semanticRanks = new Map<string, number>();
  if (isPostgres()) {
    try {
      const fts = await queryPostgresFts(getDbExec(), {
        query: input.query,
        allowedAudienceIds: audienceIds,
        limit: Math.max((input.limit ?? 25) * 3, 30),
        namespace: SEARCH_NAMESPACE,
      });
      ftsRanks = new Map(fts.map((hit, index) => [hit.chunkId, index + 1]));
      const family = defaultEmbeddingFamily(await availableEmbeddingFamilies());
      if (family) {
        const [queryVector] = await family.embed(
          [{ text: input.query }],
          "query",
        );
        if (queryVector) {
          const vectorHits = await queryPgVectorIndex(
            getDbExec(),
            {
              embeddingSetId: family.id,
              dimensions: family.dimensions,
              vector: queryVector,
              allowedAudienceIds: audienceIds,
              limit: Math.max((input.limit ?? 25) * 3, 30),
              namespace: SEARCH_NAMESPACE,
            },
            true,
          );
          const vectorKeys = vectorHits.map((hit) => hit.vectorKey);
          const embeddingRows = vectorKeys.length
            ? await db
                .select({
                  vectorKey: schema.brainSearchEmbeddings.vectorKey,
                  targetType: schema.brainSearchEmbeddings.targetType,
                  targetId: schema.brainSearchEmbeddings.targetId,
                })
                .from(schema.brainSearchEmbeddings)
                .where(
                  and(
                    eq(schema.brainSearchEmbeddings.status, "active"),
                    inArray(
                      schema.brainSearchEmbeddings.audienceId,
                      audienceIds,
                    ),
                    inArray(schema.brainSearchEmbeddings.vectorKey, vectorKeys),
                  ),
                )
            : [];
          const burstIds = embeddingRows
            .filter((row) => row.targetType === "burst")
            .map((row) => row.targetId);
          const burstArtifacts = burstIds.length
            ? await db
                .select({
                  id: schema.brainSearchBursts.id,
                  artifactId: schema.brainSearchBursts.artifactId,
                })
                .from(schema.brainSearchBursts)
                .where(inArray(schema.brainSearchBursts.id, burstIds))
            : [];
          const burstToArtifact = new Map(
            burstArtifacts.map((row) => [row.id, row.artifactId]),
          );
          const keyToArtifact = new Map(
            embeddingRows.map((row) => [
              row.vectorKey,
              row.targetType === "artifact"
                ? row.targetId
                : burstToArtifact.get(row.targetId),
            ]),
          );
          semanticRanks = new Map();
          vectorHits.forEach((hit, index) => {
            const artifactId = keyToArtifact.get(hit.vectorKey);
            if (artifactId && !semanticRanks.has(artifactId))
              semanticRanks.set(artifactId, index + 1);
          });
        }
      }
    } catch {
      ftsRanks = new Map();
      semanticRanks = new Map();
    }
  }
  const externalIds = Array.from(
    new Set([...ftsRanks.keys(), ...semanticRanks.keys()]),
  );
  const externalRows = externalIds.length
    ? await selectArtifacts(externalIds)
    : [];
  const rowMap = new Map(
    [...recentRows, ...externalRows].map((row) => [row.id, row]),
  );
  const rows = [...rowMap.values()];
  const corpus = rows.map(
    (row) => `${row.title} ${row.question} ${row.summary} ${row.resolution}`,
  );
  const lexicalCandidates = rows
    .map((row) => ({
      id: row.id,
      artifactId: row.id,
      captureId: row.captureId,
      sourceId: row.sourceId,
      audienceId: row.audienceId,
      title: row.title,
      text: `${row.question} ${row.summary} ${row.resolution}`,
      capturedAt: row.capturedAt,
      lexicalRank: undefined,
      authority: 1,
      freshness: Math.max(
        0,
        1 -
          (Date.now() - Date.parse(row.capturedAt)) /
            (1000 * 60 * 60 * 24 * 365),
      ),
      lane: "lexical" as const,
    }))
    .map((candidate) => ({
      candidate,
      lexical: lexicalScore(
        `${candidate.title} ${candidate.text}`,
        terms,
        corpus,
      ),
    }))
    .filter(({ lexical }) => lexical > 0)
    .sort((a, b) => b.lexical - a.lexical)
    .map(({ candidate }, index) => ({ ...candidate, lexicalRank: index + 1 }));
  const lexicalRanks = new Map(
    lexicalCandidates.map((candidate) => [candidate.id, candidate.lexicalRank]),
  );
  const candidates = rows
    .filter(
      (row) =>
        lexicalRanks.has(row.id) ||
        ftsRanks.has(row.id) ||
        semanticRanks.has(row.id),
    )
    .map((row) => {
      const lexicalRank = ftsRanks.get(row.id) ?? lexicalRanks.get(row.id);
      const semanticRank = semanticRanks.get(row.id);
      return {
        id: row.id,
        artifactId: row.id,
        captureId: row.captureId,
        sourceId: row.sourceId,
        audienceId: row.audienceId,
        title: row.title,
        text: `${row.question} ${row.summary} ${row.resolution}`,
        capturedAt: row.capturedAt,
        lexicalRank,
        semanticRank,
        authority: 1,
        freshness: Math.max(
          0,
          1 -
            (Date.now() - Date.parse(row.capturedAt)) /
              (1000 * 60 * 60 * 24 * 365),
        ),
        lane: semanticRank
          ? lexicalRank
            ? ("hybrid" as const)
            : ("semantic" as const)
          : ("lexical" as const),
      };
    });
  return reciprocalRankFusion(candidates).slice(0, input.limit ?? 25);
}
