import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { getDbExec, isPostgres } from "@agent-native/core/db";
import { type SearchMatchMode } from "@agent-native/core/search-utils";
import { and, eq, inArray } from "drizzle-orm";

import {
  fetchRemoteArtifact,
  parsePrivateBlobHandle,
  readPrivateArtifact,
} from "../connectors/private-artifacts.js";
import { availableEmbeddingFamilies } from "../embeddings/providers.js";
import { dispatchCreativeContextImportJob } from "../jobs/index.js";
import {
  reciprocalRankFusion,
  type RankedCandidate,
} from "../search/fusion.js";
import {
  matchesCreativeSearchMode,
  shouldUsePostgresFts,
} from "../search/mode.js";
import { queryPostgresFts } from "../search/postgres-fts.js";
import {
  createContextPack,
  createJob,
  getActiveEmbeddingSet,
  getCreativeContextItem,
  getContextSource,
  listAccessibleLexicalCandidates,
  listAccessibleSearchDocuments,
  listEmbeddingMetadata,
  type AccessibleSearchDocument,
} from "../store/index.js";
import type { ContextItemStatus } from "../types.js";
import { PGVECTOR_REQUIRED_MESSAGE } from "../vector/pgvector.js";
import { getCreativeContext } from "./context.js";
import {
  delimitUntrustedReference,
  UNTRUSTED_REFERENCE_ROLE,
} from "./untrusted-reference.js";

export interface CreativeContextSearchInput {
  query?: string;
  imageBlobRef?: string;
  mediaId?: string;
  sourceIds?: string[];
  packId?: string;
  kinds?: string[];
  tags?: string[];
  colors?: string[];
  updatedAfter?: string;
  updatedBefore?: string;
  statuses?: ContextItemStatus[];
  matchMode?: SearchMatchMode;
  limit: number;
  cursor?: string;
  maxPerSource?: number;
  snapshot?: boolean;
  contextPackName?: string;
}

type SearchLane = "lexical" | "fts" | "vector";

function cursorOffset(cursor?: string): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    return Number.isInteger(parsed.offset) && parsed.offset >= 0
      ? parsed.offset
      : 0;
  } catch {
    return 0;
  }
}

function nextCursor(offset: number, limit: number, hasMore: boolean) {
  return hasMore
    ? Buffer.from(JSON.stringify({ offset: offset + limit }), "utf8").toString(
        "base64url",
      )
    : undefined;
}

function ranked(
  document: AccessibleSearchDocument,
  score: number,
  reason: string,
): RankedCandidate<AccessibleSearchDocument> {
  return { key: document.chunkId!, value: document, score, reason };
}

function rankQuality(document: AccessibleSearchDocument): number {
  const curation =
    document.starred || document.curationRank === "canonical"
      ? 1
      : document.curationRank === "exemplar"
        ? 0.5
        : 0;
  const ageDays = Math.max(
    0,
    (Date.now() - new Date(document.updatedAt).getTime()) / 86_400_000,
  );
  const recency = Number.isFinite(ageDays) ? 0.03 / (1 + ageDays / 30) : 0;
  const priorReuse = Math.min(
    0.04,
    Math.log1p(document.priorReuseCount) * 0.01,
  );
  const helpful = Math.min(
    0.04,
    Math.log1p(document.helpfulFeedbackCount) * 0.015,
  );
  return curation + recency + priorReuse + helpful;
}

async function queryImage(input: {
  imageBlobRef?: string;
  mediaId?: string;
}): Promise<{
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  base64: string;
} | null> {
  if (!input.imageBlobRef && !input.mediaId) return null;
  if (!isPostgres()) throw new Error(PGVECTOR_REQUIRED_MESSAGE);
  const { connectorContext, getDb, schema } = getCreativeContext();
  let reference = input.imageBlobRef;
  let mimeType: string | undefined;
  let publicUrl: string | undefined;
  if (input.mediaId) {
    const rows = await getDb()
      .select({
        itemId: schema.contextMedia.itemId,
        itemVersionId: schema.contextMedia.itemVersionId,
      })
      .from(schema.contextMedia)
      .where(eq(schema.contextMedia.id, input.mediaId))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error("Visual-query media was not found");
    const detail = await getCreativeContextItem(row.itemId, row.itemVersionId);
    const media = detail?.media.find((entry) => entry.id === input.mediaId);
    if (!media) throw new Error("Visual-query media is not accessible");
    reference = media.storageKey ?? undefined;
    publicUrl = media.url ?? undefined;
    mimeType = media.mimeType ?? undefined;
  }
  let data: Uint8Array;
  if (reference) {
    const handle = parsePrivateBlobHandle(reference);
    if (!handle)
      throw new Error(
        "Visual query requires a valid private image blob reference",
      );
    data = await readPrivateArtifact(handle, connectorContext);
    mimeType ??= handle.mimeType;
  } else if (publicUrl) {
    const fetched = await fetchRemoteArtifact(publicUrl, connectorContext);
    data = fetched.data;
    mimeType ??= fetched.mimeType;
  } else {
    throw new Error("Visual-query media has no readable blob handle");
  }
  if (
    mimeType !== "image/png" &&
    mimeType !== "image/jpeg" &&
    mimeType !== "image/webp" &&
    mimeType !== "image/gif"
  ) {
    throw new Error("Visual query supports PNG, JPEG, WebP, or GIF images");
  }
  return { mimeType, base64: Buffer.from(data).toString("base64") };
}

export async function performCreativeContextSearch(
  input: CreativeContextSearchInput,
) {
  const query = input.query?.trim() ?? "";
  const image = await queryImage(input);
  if (!query && !image)
    throw new Error("Provide query, imageBlobRef, or mediaId");
  const filters = {
    sourceIds: input.sourceIds,
    packId: input.packId,
    kinds: input.kinds,
    tags: input.tags,
    colors: input.colors,
    updatedAfter: input.updatedAfter,
    updatedBefore: input.updatedBefore,
    statuses: input.statuses,
  };
  const [baseDocuments, lexicalCandidates] = await Promise.all([
    listAccessibleSearchDocuments({
      ...filters,
      limit: Math.max(input.limit, 50),
    }),
    query
      ? listAccessibleLexicalCandidates({
          ...filters,
          query,
          matchMode: input.matchMode,
          limit: Math.min(500, Math.max(100, input.limit * 20)),
        })
      : Promise.resolve({ results: [] }),
  ]);
  const lexicalItemIds = [
    ...new Set(lexicalCandidates.results.map((result) => result.itemId)),
  ];
  const lexicalDocuments = lexicalItemIds.length
    ? await listAccessibleSearchDocuments({
        ...filters,
        itemIds: lexicalItemIds,
        limit: Math.min(5_000, Math.max(100, lexicalItemIds.length * 10)),
      })
    : [];
  let documents = [
    ...new Map(
      [...baseDocuments, ...lexicalDocuments].map((document) => [
        document.chunkId!,
        document,
      ]),
    ).values(),
  ];
  let byChunk = new Map(
    documents.map((document) => [document.chunkId!, document]),
  );
  const lanes: Partial<
    Record<SearchLane, RankedCandidate<AccessibleSearchDocument>[]>
  > = {};
  if (query) {
    lanes.lexical = lexicalCandidates.results.flatMap((candidate) => {
      const document = candidate.chunkId
        ? byChunk.get(candidate.chunkId)
        : undefined;
      return document
        ? [ranked(document, candidate.score, "portable lexical match")]
        : [];
    });

    if (isPostgres() && shouldUsePostgresFts(input.matchMode)) {
      const hits = await queryPostgresFts(getDbExec(), {
        query,
        ...(input.packId ? { allowedChunkIds: [...byChunk.keys()] } : {}),
        limit: Math.min(200, Math.max(100, input.limit * 20)),
      });
      const ftsDocuments = hits.length
        ? await listAccessibleSearchDocuments({
            ...filters,
            chunkIds: hits.map((hit) => hit.chunkId),
            limit: hits.length,
          })
        : [];
      documents = [
        ...new Map(
          [...documents, ...ftsDocuments].map((document) => [
            document.chunkId!,
            document,
          ]),
        ).values(),
      ];
      byChunk = new Map(
        documents.map((document) => [document.chunkId!, document]),
      );
      lanes.fts = hits.flatMap((hit) => {
        const document = byChunk.get(hit.chunkId);
        return document &&
          matchesCreativeSearchMode(
            `${document.title}\n${document.summary ?? ""}\n${document.body}`,
            query,
            input.matchMode ?? "allTerms",
          )
          ? [ranked(document, hit.score, "Postgres full-text match")]
          : [];
      });
    }
  }

  let vectorAvailable = false;
  if (isPostgres()) {
    const families = await availableEmbeddingFamilies();
    const activeSet = await getActiveEmbeddingSet();
    const family = activeSet
      ? (families.find(
          (candidate) =>
            candidate.id === activeSet.family &&
            candidate.model === activeSet.model &&
            candidate.version === activeSet.version,
        ) ?? null)
      : null;
    if (family) {
      const set = activeSet;
      const vectorAdapter = getCreativeContext().vectorAdapter;
      if (set && vectorAdapter && set.dimensions === family.dimensions) {
        if (
          image &&
          family.supportedImageMimeTypes &&
          !family.supportedImageMimeTypes.includes(image.mimeType)
        ) {
          throw new Error(
            `The active embedding family does not support ${image.mimeType} visual queries. Use PNG or JPEG.`,
          );
        }
        const metadata = await listEmbeddingMetadata({
          embeddingSetId: set.id,
          ...filters,
        });
        if (metadata.length) {
          const [vector] = await family.embed(
            [
              {
                ...(query ? { text: query } : {}),
                ...(image ? { images: [image] } : {}),
              },
            ],
            "query",
          );
          if (!vector)
            throw new Error("Embedding provider returned no query vector");
          const matches = await vectorAdapter.search({
            embeddingSetId: set.id,
            vector,
            limit: Math.min(200, Math.max(40, input.limit * 5)),
            allowedVectorKeys: metadata.map((entry) => entry.vectorKey),
          });
          const metadataByVector = new Map(
            metadata.map((entry) => [entry.vectorKey, entry]),
          );
          const matchedMetadata = matches.flatMap((match) => {
            const entry = metadataByVector.get(match.embeddingId);
            return entry ? [entry] : [];
          });
          const vectorItemIds = [
            ...new Set(matchedMetadata.map((entry) => entry.itemId)),
          ];
          const vectorDocuments = vectorItemIds.length
            ? await listAccessibleSearchDocuments({
                ...filters,
                itemIds: vectorItemIds,
                limit: Math.max(50, vectorItemIds.length * 10),
              })
            : [];
          documents = [
            ...new Map(
              [...documents, ...vectorDocuments].map((document) => [
                document.chunkId!,
                document,
              ]),
            ).values(),
          ];
          byChunk = new Map(
            documents.map((document) => [document.chunkId!, document]),
          );
          const firstDocumentByVersion = new Map<
            string,
            AccessibleSearchDocument
          >();
          for (const document of documents) {
            if (!firstDocumentByVersion.has(document.itemVersionId)) {
              firstDocumentByVersion.set(document.itemVersionId, document);
            }
          }
          lanes.vector = matches.flatMap((match) => {
            const metadataRow = metadataByVector.get(match.embeddingId);
            const document = metadataRow?.chunkId
              ? byChunk.get(metadataRow.chunkId)
              : metadataRow
                ? firstDocumentByVersion.get(metadataRow.itemVersionId)
                : undefined;
            return document
              ? [
                  ranked(
                    document,
                    match.score,
                    image ? "visual similarity" : "semantic similarity",
                  ),
                ]
              : [];
          });
          vectorAvailable = true;
        }
      }
    }
  }
  if (image && !vectorAvailable) {
    throw new Error(
      "Visual search needs a configured multimodal embedding provider and indexed visual context.",
    );
  }

  const nonemptyLanes = Object.fromEntries(
    Object.entries(lanes).filter(
      ([, candidates]) => candidates && candidates.length,
    ),
  ) as Record<string, RankedCandidate<AccessibleSearchDocument>[]>;
  const laneScores = new Map<string, Record<string, number>>();
  for (const [lane, candidates] of Object.entries(nonemptyLanes)) {
    for (const candidate of candidates) {
      laneScores.set(candidate.key, {
        ...(laneScores.get(candidate.key) ?? {}),
        [lane]: candidate.score,
      });
    }
  }
  const fused = reciprocalRankFusion(nonemptyLanes, {
    limit: Math.max(200, input.limit * 20),
  }).map((candidate) => ({
    ...candidate,
    score: candidate.score + rankQuality(candidate.value),
  }));
  fused.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));

  const maxPerSource = Math.max(1, Math.min(20, input.maxPerSource ?? 5));
  const sourceCounts = new Map<string, number>();
  const seenItems = new Set<string>();
  const collapsed = fused.filter((candidate) => {
    if (seenItems.has(candidate.value.itemId)) return false;
    const sourceCount = sourceCounts.get(candidate.value.sourceId) ?? 0;
    if (sourceCount >= maxPerSource) return false;
    seenItems.add(candidate.value.itemId);
    sourceCounts.set(candidate.value.sourceId, sourceCount + 1);
    return true;
  });
  const offset = cursorOffset(input.cursor);
  const page = collapsed.slice(offset, offset + input.limit);
  const results = await Promise.all(
    page.map(async (candidate) => ({
      ...candidate.value,
      body: undefined,
      summary: undefined,
      dataRole: UNTRUSTED_REFERENCE_ROLE,
      title: delimitUntrustedReference(candidate.value.title),
      excerpt: delimitUntrustedReference(candidate.value.excerpt),
      score: candidate.score,
      reasons: candidate.reasons,
      laneRanks: candidate.laneRanks,
      laneScores: laneScores.get(candidate.key) ?? {},
      pendingJobId: candidate.value.inventoryOnly
        ? await ensureContextItemHydration(candidate.value.itemId)
        : null,
    })),
  );

  let contextPackId: string | null = null;
  if (
    input.snapshot !== false &&
    page.length > 0 &&
    !(input.statuses ?? []).some((status) => status !== "active")
  ) {
    const pack = await createContextPack({
      name:
        input.contextPackName ??
        `Search: ${(query || "visual query").slice(0, 120)}`,
      description: "Immutable fused retrieval evidence snapshot.",
      contextMode: "auto",
      request: {
        query: query || undefined,
        imageBlobRef: input.imageBlobRef ? "private-blob" : undefined,
        mediaId: input.mediaId,
        filters: {
          sourceIds: input.sourceIds,
          packId: input.packId,
          kinds: input.kinds,
          tags: input.tags,
          colors: input.colors,
          updatedAfter: input.updatedAfter,
          updatedBefore: input.updatedBefore,
          statuses: input.statuses,
        },
      },
      members: page.map((candidate) => ({
        itemId: candidate.value.itemId,
        itemVersionId: candidate.value.itemVersionId,
        reason: candidate.reasons.join("; ") || "fused retrieval match",
        score: candidate.score,
        scoreMetadata: {
          laneRanks: candidate.laneRanks,
          laneScores: laneScores.get(candidate.key) ?? {},
          reasons: candidate.reasons,
          qualitySignals: {
            curationRank: candidate.value.curationRank,
            starred: candidate.value.starred,
            updatedAt: candidate.value.updatedAt,
            priorReuseCount: candidate.value.priorReuseCount,
            helpfulFeedbackCount: candidate.value.helpfulFeedbackCount,
          },
        },
      })),
    });
    contextPackId = pack.id;
    const current = (await readAppState("creative-context").catch(
      () => null,
    )) as { contextMode?: unknown; pinnedPackId?: unknown } | null;
    if (current?.contextMode !== "off") {
      await writeAppState("creative-context", {
        contextMode: "auto",
        currentPackId: pack.id,
        pinnedPackId:
          typeof current?.pinnedPackId === "string"
            ? current.pinnedPackId
            : null,
      });
    }
  }
  return {
    query: query || null,
    results,
    nextCursor: nextCursor(
      offset,
      input.limit,
      offset + input.limit < collapsed.length,
    ),
    contextPackId,
    coverage: {
      mode:
        Object.keys(nonemptyLanes).length > 1
          ? "fused"
          : (Object.keys(nonemptyLanes)[0] ?? "none"),
      lanes: {
        lexical: {
          available: Boolean(query),
          count: lanes.lexical?.length ?? 0,
        },
        fts: {
          available: Boolean(query) && isPostgres(),
          count: lanes.fts?.length ?? 0,
        },
        vector: {
          available: vectorAvailable,
          count: lanes.vector?.length ?? 0,
        },
      },
      sourceCount: new Set(results.map((result) => result.sourceId)).size,
      itemCount: results.length,
    },
  };
}

export async function ensureContextItemHydration(
  itemId: string,
): Promise<string | null> {
  const detail = await getCreativeContextItem(itemId);
  if (!detail || detail.version.parseStatus !== "pending") return null;
  const source = await getContextSource(detail.item.sourceId);
  if (!source) return null;
  const { getDb, schema, connectorContext } = getCreativeContext();
  const rows = await getDb()
    .select({ id: schema.contextJobs.id, request: schema.contextJobs.request })
    .from(schema.contextJobs)
    .where(
      and(
        eq(schema.contextJobs.sourceId, source.id),
        inArray(schema.contextJobs.status, ["queued", "running", "paused"]),
        eq(schema.contextJobs.ownerEmail, source.ownerEmail),
      ),
    );
  const existing = rows.find((row: any) => {
    try {
      const request = JSON.parse(row.request) as { itemExternalIds?: unknown };
      return (
        Array.isArray(request.itemExternalIds) &&
        request.itemExternalIds.includes(detail.item.externalId)
      );
    } catch {
      return false;
    }
  });
  if (existing) return existing.id;
  const job = await createJob({
    sourceId: source.id,
    kind: "import",
    mode: "incremental",
    request: {
      itemExternalIds: [detail.item.externalId],
      reason: "on-demand-hydration",
    },
    progressTotal: 1,
  });
  await dispatchCreativeContextImportJob({
    jobId: job.id,
    ownerEmail: source.ownerEmail,
    orgId: job.orgId,
    appId: connectorContext.appId,
  });
  return job.id;
}
