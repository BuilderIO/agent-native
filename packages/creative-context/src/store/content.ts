import { currentRequestUserIsOrgAdmin } from "@agent-native/core/server";
import {
  buildSearchSnippet,
  escapeLikeTerm,
  normalizeSearchTerms,
  scoreSearchText,
  type SearchMatchMode,
} from "@agent-native/core/search-utils";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { assertContextItemSqlTextLimits } from "../connectors/normalize.js";
import { matchesCreativeSearchMode } from "../search/mode.js";
import { getCreativeContext } from "../server/context.js";
import type {
  ContextChunk,
  ContextDetail,
  ContextEdge,
  ContextEmbeddingMetadata,
  ContextFeedbackSignal,
  ContextIngestBatch,
  ContextIngestResult,
  ContextInventoryUpsertResult,
  ContextItemSummary,
  ContextItemVersion,
  ContextMedia,
  ContextReviewItem,
  ContextSearchResult,
  EmbeddingSet,
  ImportPreviewItem,
} from "../types.js";
import {
  newId,
  nextOffsetCursor,
  nowIso,
  parseJson,
  parseOffsetCursor,
  requireActor,
  sha256,
  stringifyJson,
} from "./helpers.js";
import { createJob, enqueueContextRebuildJob } from "./jobs.js";

function mapItem(row: any): ContextItemSummary {
  return {
    id: row.id,
    sourceId: row.sourceId,
    externalId: row.externalId,
    kind: row.kind,
    title: row.title,
    canonicalUrl: row.canonicalUrl ?? null,
    mimeType: row.mimeType ?? null,
    currentVersionId: row.currentVersionId,
    status: row.status,
    upstreamAccess: row.upstreamAccess,
    curationStatus: row.curationStatus,
    curationRank: row.curationRank,
    starred: Boolean(row.starred),
    inventoryState: row.inventoryState,
    indexState: row.indexState,
    tags: parseJson(row.tags, []),
    colors: parseJson(row.colors, []),
    sortOrder: row.sortOrder,
    parentItemId: row.parentItemId ?? null,
    provenance: parseJson(row.provenance, {}),
    thumbnailBlobRef: row.thumbnailBlobRef ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapVersion(row: any): ContextItemVersion {
  return {
    id: row.id,
    itemId: row.itemId,
    versionNumber: row.versionNumber,
    contentHash: row.contentHash,
    title: row.title,
    content: row.content,
    summary: row.summary ?? null,
    mimeType: row.mimeType ?? null,
    sourceModifiedAt: row.sourceModifiedAt ?? null,
    sourceVersion: row.sourceVersion ?? null,
    rawSnapshotBlobRef: row.rawSnapshotBlobRef ?? null,
    parseStatus: row.parseStatus,
    parseError: row.parseError ?? null,
    metadata: parseJson(row.metadata, {}),
    createdAt: row.createdAt,
  };
}

function mapChunk(row: any): ContextChunk {
  return {
    id: row.id,
    itemId: row.itemId,
    itemVersionId: row.itemVersionId,
    ordinal: row.ordinal,
    kind: row.kind,
    text: row.text,
    startOffset: row.startOffset ?? null,
    endOffset: row.endOffset ?? null,
    tokenCount: row.tokenCount ?? null,
    metadata: parseJson(row.metadata, {}),
  };
}

function mapMedia(row: any): ContextMedia {
  return {
    id: row.id,
    itemId: row.itemId,
    itemVersionId: row.itemVersionId,
    kind: row.kind,
    mimeType: row.mimeType ?? null,
    accessMode: row.accessMode,
    url: row.url ?? null,
    storageKey: row.storageKey ?? null,
    provenanceUrl: row.provenanceUrl ?? null,
    altText: row.altText ?? null,
    caption: row.caption ?? null,
    captionStatus: row.captionStatus,
    ocrText: row.ocrText ?? null,
    palette: parseJson(row.palette, []),
    contentHash: row.contentHash ?? null,
    width: row.width ?? null,
    height: row.height ?? null,
    durationMs: row.durationMs ?? null,
    metadata: parseJson(row.metadata, {}),
  };
}

function mapEdge(row: any): ContextEdge {
  return {
    id: row.id,
    fromItemId: row.fromItemId,
    fromItemVersionId: row.fromItemVersionId,
    toItemId: row.toItemId ?? null,
    toItemVersionId: row.toItemVersionId ?? null,
    toExternalId: row.toExternalId ?? null,
    relation: row.relation,
    metadata: parseJson(row.metadata, {}),
  };
}

function mediaEnrichmentSourceContentHash(
  metadata: Record<string, unknown>,
  fallback: string,
): string {
  const derivation = metadata.__creativeContextDerivation;
  if (!derivation || typeof derivation !== "object") return fallback;
  const record = derivation as Record<string, unknown>;
  return record.kind === "media-enrichment" &&
    typeof record.sourceContentHash === "string"
    ? record.sourceContentHash
    : fallback;
}

export function assertImmutableContextVersion(operation: string): never {
  throw new Error(
    `Creative context item versions are immutable; ${operation} must create a new version`,
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  let current = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (typeof current !== "object") break;
    const candidate = current as Record<string, unknown>;
    const code = String(candidate.code ?? candidate.errno ?? "").toUpperCase();
    const message = String(candidate.message ?? "");
    if (
      code === "23505" ||
      code.includes("SQLITE_CONSTRAINT") ||
      /unique constraint|unique violation|duplicate key/i.test(message)
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

export async function ingestItems(
  batch: ContextIngestBatch,
): Promise<ContextIngestResult> {
  return ingestItemsAttempt(batch, true);
}

async function ingestItemsAttempt(
  batch: ContextIngestBatch,
  allowUniqueConflictRetry: boolean,
): Promise<ContextIngestResult> {
  await assertAccess(
    "creative-context-source",
    batch.sourceId,
    "editor",
    undefined,
    { skipResourceBody: true },
  );
  for (const item of batch.items) {
    assertContextItemSqlTextLimits(item);
  }
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const timestamp = batch.completedAt ?? nowIso();
  const externalIds = Array.from(
    new Set(batch.items.map((item) => item.externalId)),
  );
  if (externalIds.length !== batch.items.length) {
    throw new Error(
      "An ingest batch cannot contain duplicate externalId values",
    );
  }

  const existingRows = externalIds.length
    ? await getDb()
        .select()
        .from(schema.contextItems)
        .where(
          and(
            eq(schema.contextItems.sourceId, batch.sourceId),
            inArray(schema.contextItems.externalId, externalIds),
          ),
        )
    : [];
  const existingByExternalId = new Map(
    existingRows.map((row: any) => [row.externalId, row]),
  );
  const currentVersionIds = existingRows.map(
    (row: any) => row.currentVersionId as string,
  );
  const currentVersionRows = currentVersionIds.length
    ? await getDb()
        .select({
          id: schema.contextItemVersions.id,
          versionNumber: schema.contextItemVersions.versionNumber,
          contentHash: schema.contextItemVersions.contentHash,
          metadata: schema.contextItemVersions.metadata,
        })
        .from(schema.contextItemVersions)
        .where(inArray(schema.contextItemVersions.id, currentVersionIds))
    : [];
  const versionNumberById = new Map<string, number>(
    currentVersionRows.map((row: any) => [row.id, row.versionNumber as number]),
  );
  const sourceContentHashByVersionId = new Map<string, string>(
    currentVersionRows.map((row: any) => {
      const metadata = parseJson<Record<string, unknown>>(row.metadata, {});
      return [
        row.id,
        mediaEnrichmentSourceContentHash(metadata, row.contentHash),
      ];
    }),
  );

  const newItems: any[] = [];
  const itemUpdates: Array<{ id: string; values: Record<string, unknown> }> =
    [];
  const versions: any[] = [];
  const chunks: any[] = [];
  const media: any[] = [];
  const edges: any[] = [];
  const itemIds: string[] = [];
  const batchVersionTargets = new Map<
    string,
    { itemId: string; itemVersionId: string }
  >();
  let created = 0;
  let versioned = 0;
  let unchanged = 0;

  for (const input of batch.items) {
    const existing = existingByExternalId.get(input.externalId) as any;
    if (
      existing &&
      (existing.currentContentHash === input.contentHash ||
        sourceContentHashByVersionId.get(existing.currentVersionId) ===
          input.contentHash)
    ) {
      batchVersionTargets.set(input.externalId, {
        itemId: existing.id,
        itemVersionId: existing.currentVersionId,
      });
      const upstreamAccess = input.upstreamAccess ?? existing.upstreamAccess;
      const newlyRestricted =
        upstreamAccess === "restricted" &&
        existing.upstreamAccess !== "restricted";
      itemUpdates.push({
        id: existing.id,
        values: {
          kind: input.kind,
          title: input.title,
          canonicalUrl: input.canonicalUrl ?? null,
          mimeType: input.mimeType ?? null,
          upstreamAccess,
          curationStatus: newlyRestricted ? "review" : existing.curationStatus,
          tags: stringifyJson(input.tags ?? parseJson(existing.tags, [])),
          colors: stringifyJson(
            input.colors ??
              (input.color ? [input.color] : parseJson(existing.colors, [])),
          ),
          provenance: stringifyJson(
            input.provenance ?? parseJson(existing.provenance, {}),
          ),
          updatedAt: timestamp,
        },
      });
      unchanged += 1;
      itemIds.push(existing.id);
      continue;
    }
    const itemId = existing?.id ?? newId("cci");
    const itemVersionId = newId("ccv");
    batchVersionTargets.set(input.externalId, { itemId, itemVersionId });
    const versionNumber = existing
      ? (versionNumberById.get(existing.currentVersionId) ?? 0) + 1
      : 1;
    const upstreamAccess = input.upstreamAccess ?? "unknown";
    const curationStatus = existing
      ? upstreamAccess === "restricted" &&
        existing.upstreamAccess !== "restricted"
        ? "review"
        : existing.curationStatus
      : (input.curationStatus ??
        (upstreamAccess === "restricted" ? "review" : "included"));
    itemIds.push(itemId);
    versions.push({
      id: itemVersionId,
      itemId,
      versionNumber,
      contentHash: input.contentHash,
      title: input.title,
      content: input.content,
      summary: input.summary ?? null,
      mimeType: input.mimeType ?? null,
      sourceModifiedAt: input.sourceModifiedAt ?? null,
      sourceVersion: input.sourceVersion ?? null,
      rawSnapshotBlobRef: input.rawSnapshotBlobRef ?? null,
      parseStatus: input.parseStatus ?? "parsed",
      parseError: input.parseError ?? null,
      metadata: stringifyJson(input.metadata),
      createdAt: timestamp,
      ownerEmail: actor.ownerEmail,
      orgId: actor.orgId,
    });

    if (existing) {
      versioned += 1;
      itemUpdates.push({
        id: itemId,
        values: {
          kind: input.kind,
          title: input.title,
          canonicalUrl: input.canonicalUrl ?? null,
          mimeType: input.mimeType ?? null,
          currentVersionId: itemVersionId,
          currentContentHash: input.contentHash,
          status: "active",
          upstreamAccess,
          curationStatus,
          curationRank: input.curationRank ?? "normal",
          starred: input.starred ? 1 : 0,
          inventoryState: input.inventoryState ?? "available",
          indexState: input.indexState ?? "pending",
          tags: stringifyJson(input.tags ?? []),
          colors: stringifyJson(
            input.colors ?? (input.color ? [input.color] : []),
          ),
          sortOrder: input.sortOrder ?? 0,
          parentItemId: input.parentItemId ?? null,
          provenance: stringifyJson(input.provenance),
          thumbnailBlobRef: input.thumbnailBlobRef ?? null,
          metadata: stringifyJson(input.metadata),
          updatedAt: timestamp,
        },
      });
    } else {
      created += 1;
      newItems.push({
        id: itemId,
        sourceId: batch.sourceId,
        externalId: input.externalId,
        kind: input.kind,
        title: input.title,
        canonicalUrl: input.canonicalUrl ?? null,
        mimeType: input.mimeType ?? null,
        currentVersionId: itemVersionId,
        currentContentHash: input.contentHash,
        status: "active",
        upstreamAccess,
        curationStatus,
        curationRank: input.curationRank ?? "normal",
        starred: input.starred ? 1 : 0,
        inventoryState: input.inventoryState ?? "available",
        indexState: input.indexState ?? "pending",
        tags: stringifyJson(input.tags ?? []),
        colors: stringifyJson(
          input.colors ?? (input.color ? [input.color] : []),
        ),
        sortOrder: input.sortOrder ?? 0,
        parentItemId: input.parentItemId ?? null,
        provenance: stringifyJson(input.provenance),
        thumbnailBlobRef: input.thumbnailBlobRef ?? null,
        metadata: stringifyJson(input.metadata),
        createdAt: timestamp,
        updatedAt: timestamp,
        ownerEmail: actor.ownerEmail,
        orgId: actor.orgId,
      });
    }

    const normalizedChunks =
      input.chunks?.length && input.chunks.length > 0
        ? input.chunks
        : [{ ordinal: 0, kind: "text", text: input.content }];
    chunks.push(
      ...normalizedChunks.map((chunk) => ({
        id: chunk.id ?? newId("ccc"),
        itemId,
        itemVersionId,
        ordinal: chunk.ordinal,
        kind: chunk.kind ?? "text",
        text: chunk.text,
        startOffset: chunk.startOffset ?? null,
        endOffset: chunk.endOffset ?? null,
        tokenCount: chunk.tokenCount ?? null,
        metadata: stringifyJson(chunk.metadata),
        createdAt: timestamp,
        ownerEmail: actor.ownerEmail,
        orgId: actor.orgId,
      })),
    );
    media.push(
      ...(input.media ?? []).map((entry) => {
        const accessMode = entry.accessMode ?? "public";
        if (!entry.url && !entry.storageKey) {
          throw new Error("Context media requires a URL or storage key");
        }
        if (accessMode !== "public" && !entry.storageKey) {
          throw new Error(
            "Private or expiring media must be copied to private blob storage; provider URLs may be kept only as provenanceUrl",
          );
        }
        return {
          id: entry.id ?? newId("ccm"),
          itemId,
          itemVersionId,
          kind: entry.kind,
          mimeType: entry.mimeType ?? null,
          accessMode,
          url: accessMode === "public" ? (entry.url ?? null) : null,
          storageKey: entry.storageKey ?? null,
          provenanceUrl: entry.provenanceUrl ?? entry.url ?? null,
          altText: entry.altText ?? null,
          caption: entry.caption ?? null,
          captionStatus: entry.captionStatus ?? "pending",
          ocrText: entry.ocrText ?? null,
          palette: stringifyJson(entry.palette ?? []),
          contentHash: entry.contentHash ?? null,
          width: entry.width ?? null,
          height: entry.height ?? null,
          durationMs: entry.durationMs ?? null,
          metadata: stringifyJson(entry.metadata),
          createdAt: timestamp,
          ownerEmail: actor.ownerEmail,
          orgId: actor.orgId,
        };
      }),
    );
    if (existing) {
      edges.push({
        id: newId("cce"),
        fromItemId: itemId,
        fromItemVersionId: itemVersionId,
        toItemId: itemId,
        toItemVersionId: existing.currentVersionId,
        toExternalId: existing.externalId,
        relation: "revision-of",
        metadata: stringifyJson({ automatic: true }),
        createdAt: timestamp,
        ownerEmail: actor.ownerEmail,
        orgId: actor.orgId,
      });
    }
    edges.push(
      ...(input.edges ?? []).map((edge) => {
        if (!edge.toItemId && !edge.toExternalId) {
          throw new Error("Context edges require toItemId or toExternalId");
        }
        if (edge.toItemVersionId && !edge.toItemId) {
          throw new Error("Pinned edge target versions require toItemId");
        }
        return {
          id: edge.id ?? newId("cce"),
          fromItemId: itemId,
          fromItemVersionId: itemVersionId,
          toItemId: edge.toItemId ?? null,
          toItemVersionId: edge.toItemVersionId ?? null,
          toExternalId: edge.toExternalId ?? null,
          relation: edge.relation,
          metadata: stringifyJson(edge.metadata),
          createdAt: timestamp,
          ownerEmail: actor.ownerEmail,
          orgId: actor.orgId,
        };
      }),
    );
  }

  for (const edge of edges) {
    if (edge.toItemId || !edge.toExternalId) continue;
    const target = batchVersionTargets.get(edge.toExternalId);
    if (!target) continue;
    edge.toItemId = target.itemId;
    edge.toItemVersionId = target.itemVersionId;
  }

  try {
    await getDb().transaction(async (tx: any) => {
      if (newItems.length)
        await tx.insert(schema.contextItems).values(newItems);
      if (versions.length)
        await tx.insert(schema.contextItemVersions).values(versions);
      if (chunks.length) await tx.insert(schema.contextChunks).values(chunks);
      if (media.length) await tx.insert(schema.contextMedia).values(media);
      if (edges.length) await tx.insert(schema.contextEdges).values(edges);
      for (const update of itemUpdates) {
        await tx
          .update(schema.contextItems)
          .set(update.values)
          .where(eq(schema.contextItems.id, update.id));
      }
      const [total] = await tx
        .select({ value: count() })
        .from(schema.contextItems)
        .where(
          and(
            eq(schema.contextItems.sourceId, batch.sourceId),
            eq(schema.contextItems.status, "active"),
          ),
        );
      const [restricted] = await tx
        .select({ value: count() })
        .from(schema.contextItems)
        .where(
          and(
            eq(schema.contextItems.sourceId, batch.sourceId),
            eq(schema.contextItems.upstreamAccess, "restricted"),
          ),
        );
      await tx
        .update(schema.contextSources)
        .set({
          syncCursor: batch.syncCursor ?? undefined,
          itemCount: Number(total?.value ?? 0),
          restrictedItemCount: Number(restricted?.value ?? 0),
          lastSyncedAt: timestamp,
          lastError: null,
          status: "active",
          healthStatus: "healthy",
          updatedAt: timestamp,
        })
        .where(eq(schema.contextSources.id, batch.sourceId));
    });
  } catch (error) {
    if (allowUniqueConflictRetry && isUniqueConstraintError(error)) {
      return ingestItemsAttempt(batch, false);
    }
    throw error;
  }

  if (chunks.length) {
    await enqueueContextRebuildJob({
      sourceId: batch.sourceId,
      operation: "rebuild-fts",
      itemIds: [...new Set(chunks.map((chunk: any) => chunk.itemId as string))],
    });
  }

  const mediaProjection = getCreativeContext().projections?.media;
  if (mediaProjection) {
    const eager = media.slice(0, 5);
    const queued = media.slice(5).map((row: any) => row.id as string);
    for (const row of eager) {
      try {
        await mediaProjection.project({
          sourceId: batch.sourceId,
          itemId: row.itemId,
          itemVersionId: row.itemVersionId,
          media: mapMedia(row),
          sourceType: "brand-import",
          dedupeKey: `${row.id}:${row.itemVersionId}`,
        });
      } catch {
        queued.push(row.id);
      }
    }
    if (queued.length) {
      await createJob({
        sourceId: batch.sourceId,
        kind: "enrich-media",
        request: {
          operation: "project-media",
          mediaIds: [...new Set(queued)],
        },
        progressTotal: new Set(queued).size,
        budget: {
          eagerLimit: 25,
          remainingMode: "durable-continuation",
        },
      });
    }
  }

  return {
    sourceId: batch.sourceId,
    received: batch.items.length,
    created,
    versioned,
    unchanged,
    itemIds,
    mediaIds: media.map((entry: any) => entry.id as string),
  };
}

export async function upsertSourceInventory(input: {
  sourceId: string;
  items: ImportPreviewItem[];
  completedAt?: string;
}): Promise<ContextInventoryUpsertResult> {
  return upsertSourceInventoryAttempt(input, true);
}

async function upsertSourceInventoryAttempt(
  input: {
    sourceId: string;
    items: ImportPreviewItem[];
    completedAt?: string;
  },
  allowUniqueConflictRetry: boolean,
): Promise<ContextInventoryUpsertResult> {
  const access = await assertAccess(
    "creative-context-source",
    input.sourceId,
    "editor",
  );
  const externalIds = input.items.map((item) => item.externalId);
  if (new Set(externalIds).size !== externalIds.length) {
    throw new Error("An inventory page cannot contain duplicate external ids");
  }
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const timestamp = input.completedAt ?? nowIso();
  const existing = externalIds.length
    ? await getDb()
        .select()
        .from(schema.contextItems)
        .where(
          and(
            eq(schema.contextItems.sourceId, input.sourceId),
            inArray(schema.contextItems.externalId, externalIds),
          ),
        )
    : [];
  const existingByExternalId = new Map(
    existing.map((row: any) => [row.externalId, row]),
  );
  const newItems: any[] = [];
  const newVersions: any[] = [];
  const newChunks: any[] = [];
  const updates: Array<{ id: string; values: Record<string, unknown> }> = [];
  const itemIds: string[] = [];
  for (const item of input.items) {
    const prior = existingByExternalId.get(item.externalId) as any;
    if (prior) {
      const upstreamAccess =
        item.upstreamAccess ?? access.resource.upstreamAccess ?? "unknown";
      const newlyRestricted =
        upstreamAccess === "restricted" &&
        prior.upstreamAccess !== "restricted";
      itemIds.push(prior.id);
      updates.push({
        id: prior.id,
        values: {
          kind: item.kind,
          title: item.title,
          canonicalUrl: item.canonicalUrl ?? null,
          mimeType: item.mimeType ?? null,
          inventoryState: "available",
          upstreamAccess,
          ...(newlyRestricted ? { curationStatus: "review" } : {}),
          status: prior.status === "unavailable" ? "active" : prior.status,
          metadata: stringifyJson({
            ...parseJson(prior.metadata, {}),
            inventory: item.metadata ?? {},
            sizeBytes: item.sizeBytes ?? null,
          }),
          updatedAt: timestamp,
        },
      });
      continue;
    }
    const itemId = newId("cci");
    const itemVersionId = newId("ccv");
    const content = [item.title, item.summary].filter(Boolean).join("\n");
    const contentHash = await sha256(
      stringifyJson({
        inventory: true,
        externalId: item.externalId,
        title: item.title,
        sourceModifiedAt: item.sourceModifiedAt,
      }),
    );
    const upstreamAccess =
      item.upstreamAccess ?? access.resource.upstreamAccess ?? "unknown";
    itemIds.push(itemId);
    newItems.push({
      id: itemId,
      sourceId: input.sourceId,
      externalId: item.externalId,
      kind: item.kind,
      title: item.title,
      canonicalUrl: item.canonicalUrl ?? null,
      mimeType: item.mimeType ?? null,
      currentVersionId: itemVersionId,
      currentContentHash: contentHash,
      status: "active",
      upstreamAccess,
      curationStatus: upstreamAccess === "restricted" ? "review" : "included",
      curationRank: "normal",
      starred: 0,
      inventoryState: "discovered",
      indexState: "pending",
      tags: "[]",
      colors: "[]",
      sortOrder: 0,
      parentItemId: null,
      provenance: stringifyJson({ inventory: item.metadata ?? {} }),
      thumbnailBlobRef: null,
      metadata: stringifyJson({
        inventoryOnly: true,
        sizeBytes: item.sizeBytes ?? null,
      }),
      createdAt: timestamp,
      updatedAt: timestamp,
      ownerEmail: actor.ownerEmail,
      orgId: actor.orgId,
    });
    newVersions.push({
      id: itemVersionId,
      itemId,
      versionNumber: 1,
      contentHash,
      title: item.title,
      content,
      summary: item.summary ?? null,
      mimeType: item.mimeType ?? null,
      sourceModifiedAt: item.sourceModifiedAt ?? null,
      sourceVersion: null,
      rawSnapshotBlobRef: null,
      parseStatus: "pending",
      parseError: null,
      metadata: stringifyJson({ inventoryOnly: true }),
      createdAt: timestamp,
      ownerEmail: actor.ownerEmail,
      orgId: actor.orgId,
    });
    newChunks.push({
      id: newId("ccc"),
      itemId,
      itemVersionId,
      ordinal: 0,
      kind: "inventory",
      text: content,
      startOffset: null,
      endOffset: null,
      tokenCount: null,
      metadata: stringifyJson({ inventoryOnly: true }),
      createdAt: timestamp,
      ownerEmail: actor.ownerEmail,
      orgId: actor.orgId,
    });
  }
  try {
    await getDb().transaction(async (tx: any) => {
      if (newItems.length)
        await tx.insert(schema.contextItems).values(newItems);
      if (newVersions.length) {
        await tx.insert(schema.contextItemVersions).values(newVersions);
      }
      if (newChunks.length)
        await tx.insert(schema.contextChunks).values(newChunks);
      for (const update of updates) {
        await tx
          .update(schema.contextItems)
          .set(update.values)
          .where(eq(schema.contextItems.id, update.id));
      }
      const [total] = await tx
        .select({ value: count() })
        .from(schema.contextItems)
        .where(eq(schema.contextItems.sourceId, input.sourceId));
      const [restricted] = await tx
        .select({ value: count() })
        .from(schema.contextItems)
        .where(
          and(
            eq(schema.contextItems.sourceId, input.sourceId),
            eq(schema.contextItems.upstreamAccess, "restricted"),
          ),
        );
      await tx
        .update(schema.contextSources)
        .set({
          itemCount: Number(total?.value ?? 0),
          restrictedItemCount: Number(restricted?.value ?? 0),
          lastSyncedAt: timestamp,
          updatedAt: timestamp,
        })
        .where(eq(schema.contextSources.id, input.sourceId));
    });
  } catch (error) {
    if (allowUniqueConflictRetry && isUniqueConstraintError(error)) {
      return upsertSourceInventoryAttempt(input, false);
    }
    throw error;
  }
  return {
    sourceId: input.sourceId,
    received: input.items.length,
    created: newItems.length,
    updated: updates.length,
    itemIds,
  };
}

export async function reconcileSourceInventory(input: {
  sourceId: string;
  presentExternalIds: string[];
  completedAt?: string;
}): Promise<{ removed: number; restored: number }> {
  await assertAccess(
    "creative-context-source",
    input.sourceId,
    "editor",
    undefined,
    { skipResourceBody: true },
  );
  const { getDb, schema } = getCreativeContext();
  const rows = await getDb()
    .select({
      id: schema.contextItems.id,
      externalId: schema.contextItems.externalId,
      status: schema.contextItems.status,
      inventoryState: schema.contextItems.inventoryState,
      upstreamAccess: schema.contextItems.upstreamAccess,
    })
    .from(schema.contextItems)
    .where(eq(schema.contextItems.sourceId, input.sourceId));
  const present = new Set(input.presentExternalIds);
  const removedIds = rows
    .filter(
      (row: any) =>
        !present.has(row.externalId) &&
        (row.status !== "unavailable" || row.inventoryState !== "removed"),
    )
    .map((row: any) => row.id as string);
  const restoredIds = rows
    .filter(
      (row: any) =>
        present.has(row.externalId) &&
        row.status === "unavailable" &&
        row.inventoryState === "removed",
    )
    .map((row: any) => row.id as string);
  const timestamp = input.completedAt ?? nowIso();
  await getDb().transaction(async (tx: any) => {
    for (let index = 0; index < removedIds.length; index += 500) {
      await tx
        .update(schema.contextItems)
        .set({
          status: "unavailable",
          inventoryState: "removed",
          updatedAt: timestamp,
        })
        .where(
          inArray(schema.contextItems.id, removedIds.slice(index, index + 500)),
        );
    }
    for (let index = 0; index < restoredIds.length; index += 500) {
      await tx
        .update(schema.contextItems)
        .set({
          status: "active",
          inventoryState: "available",
          updatedAt: timestamp,
        })
        .where(
          inArray(
            schema.contextItems.id,
            restoredIds.slice(index, index + 500),
          ),
        );
    }
    await tx
      .update(schema.contextSources)
      .set({
        itemCount: present.size,
        restrictedItemCount: rows.filter(
          (row: any) =>
            present.has(row.externalId) && row.upstreamAccess === "restricted",
        ).length,
        lastSyncedAt: timestamp,
        updatedAt: timestamp,
      })
      .where(eq(schema.contextSources.id, input.sourceId));
  });
  return { removed: removedIds.length, restored: restoredIds.length };
}

export interface AccessibleLexicalCandidatesInput {
  query: string;
  sourceIds?: string[];
  packId?: string;
  contextId?: string;
  kinds?: string[];
  tags?: string[];
  colors?: string[];
  updatedAfter?: string;
  updatedBefore?: string;
  statuses?: ContextItemSummary["status"][];
  matchMode?: SearchMatchMode;
  limit: number;
  cursor?: string;
}

function searchableItemStatuses(
  statuses: ContextItemSummary["status"][] | undefined,
): Array<"active" | "deprecated"> {
  if (!statuses?.length) return ["active"];
  const safe = statuses.filter(
    (status): status is "active" | "deprecated" =>
      status === "active" || status === "deprecated",
  );
  if (safe.length !== statuses.length) {
    throw new Error("Creative context search cannot include removed items");
  }
  return [...new Set(safe)];
}

async function accessiblePackVersionIds(packId: string): Promise<string[]> {
  await assertAccess("creative-context-pack", packId, "viewer", undefined, {
    skipResourceBody: true,
  });
  const { getDb, schema } = getCreativeContext();
  const members = await getDb()
    .select({ itemVersionId: schema.contextPackMembers.itemVersionId })
    .from(schema.contextPackMembers)
    .where(eq(schema.contextPackMembers.packId, packId));
  return members.map((member: any) => member.itemVersionId);
}

async function accessibleContextVersionIds(contextId: string): Promise<string[]> {
  await assertAccess("creative-context", contextId, "viewer", undefined, {
    skipResourceBody: true,
  });
  const { getDb, schema } = getCreativeContext();
  const rows = await getDb()
    .select({ itemVersionId: schema.creativeContextMemberships.publishedItemVersionId })
    .from(schema.creativeContextMemberships)
    .where(
      and(
        eq(schema.creativeContextMemberships.contextId, contextId),
        eq(schema.creativeContextMemberships.status, "active"),
      ),
    );
  return rows.flatMap((row: any) =>
    typeof row.itemVersionId === "string" ? [row.itemVersionId] : [],
  );
}

async function accessibleContextMembershipMetadata(contextId: string): Promise<
  Map<string, { rank: "canonical" | "exemplar" | "normal"; purpose: string | null }>
> {
  await assertAccess("creative-context", contextId, "viewer", undefined, {
    skipResourceBody: true,
  });
  const { getDb, schema } = getCreativeContext();
  const rows = await getDb()
    .select({ itemVersionId: schema.creativeContextMemberships.publishedItemVersionId, rank: schema.creativeContextMemberships.rank, purpose: schema.creativeContextMemberships.purpose })
    .from(schema.creativeContextMemberships)
    .where(and(eq(schema.creativeContextMemberships.contextId, contextId), eq(schema.creativeContextMemberships.status, "active")));
  return new Map(
    (rows as any[]).flatMap((row) =>
      typeof row.itemVersionId === "string"
        ? [[row.itemVersionId, { rank: row.rank, purpose: row.purpose ?? null }] as const]
        : [],
    ),
  );
}

export interface AccessibleSearchDocument extends ContextSearchResult {
  body: string;
  summary: string | null;
  chunkOrdinal: number;
  tags: string[];
  colors: string[];
  updatedAt: string;
  curationRank: ContextItemSummary["curationRank"];
  starred: boolean;
  externalId: string;
  indexState: ContextItemSummary["indexState"];
  inventoryOnly: boolean;
  priorReuseCount: number;
  helpfulFeedbackCount: number;
}

export async function listAccessibleSearchDocuments(
  input: Omit<
    AccessibleLexicalCandidatesInput,
    "query" | "matchMode" | "cursor"
  > & { itemIds?: string[]; chunkIds?: string[]; afterChunkId?: string },
): Promise<AccessibleSearchDocument[]> {
  const { getDb, schema } = getCreativeContext();
  const packVersionIds: string[] | null = input.packId
    ? await accessiblePackVersionIds(input.packId)
    : null;
  const contextVersionIds: string[] | null = input.contextId
    ? await accessibleContextVersionIds(input.contextId)
    : null;
  const contextMemberships = input.contextId
    ? await accessibleContextMembershipMetadata(input.contextId)
    : null;
  if ((packVersionIds && !packVersionIds.length) || (contextVersionIds && !contextVersionIds.length)) return [];
  const filters: any[] = [
    ...(input.contextId
      ? [inArray(schema.contextChunks.itemVersionId, contextVersionIds!)]
      : [
          accessFilter(schema.contextSources, schema.contextSourceShares),
          ne(schema.contextSources.upstreamAccess, "restricted"),
          ne(schema.contextSources.status, "archived"),
        ]),
    ...(packVersionIds
      ? [inArray(schema.contextChunks.itemVersionId, packVersionIds)]
      : [
          eq(
            schema.contextItems.currentVersionId,
            schema.contextChunks.itemVersionId,
          ),
        ]),
    eq(schema.contextItems.curationStatus, "included"),
    ne(schema.contextItems.curationRank, "ignored"),
    inArray(schema.contextItems.status, searchableItemStatuses(input.statuses)),
  ];
  if (input.sourceIds?.length) {
    filters.push(inArray(schema.contextSources.id, input.sourceIds));
  }
  if (input.itemIds?.length) {
    filters.push(inArray(schema.contextItems.id, input.itemIds));
  }
  if (input.chunkIds?.length) {
    filters.push(inArray(schema.contextChunks.id, input.chunkIds));
  }
  if (input.kinds?.length) {
    filters.push(inArray(schema.contextItems.kind, input.kinds));
  }
  if (input.updatedAfter) {
    filters.push(gte(schema.contextItems.updatedAt, input.updatedAfter));
  }
  if (input.updatedBefore) {
    filters.push(lte(schema.contextItems.updatedAt, input.updatedBefore));
  }
  const rowLimit = Math.max(1, Math.min(5_000, input.limit * 100));
  const rows: any[] = [];
  let afterChunkId = input.afterChunkId;
  while (rows.length < rowLimit) {
    const page = await getDb()
      .select({
        itemId: schema.contextItems.id,
        externalId: schema.contextItems.externalId,
        itemVersionId: schema.contextChunks.itemVersionId,
        chunkId: schema.contextChunks.id,
        chunkOrdinal: schema.contextChunks.ordinal,
        sourceId: schema.contextSources.id,
        sourceName: schema.contextSources.name,
        kind: schema.contextItems.kind,
        title: schema.contextItems.title,
        body: sql<string>`substr(${schema.contextChunks.text}, 1, 12000)`,
        summary: schema.contextItemVersions.summary,
        tags: schema.contextItems.tags,
        colors: schema.contextItems.colors,
        updatedAt: schema.contextItems.updatedAt,
        curationRank: schema.contextItems.curationRank,
        starred: schema.contextItems.starred,
        indexState: schema.contextItems.indexState,
        parseStatus: schema.contextItemVersions.parseStatus,
        canonicalUrl: schema.contextItems.canonicalUrl,
        mimeType: schema.contextItems.mimeType,
      })
      .from(schema.contextChunks)
      .innerJoin(
        schema.contextItems,
        eq(schema.contextItems.id, schema.contextChunks.itemId),
      )
      .innerJoin(
        schema.contextSources,
        eq(schema.contextSources.id, schema.contextItems.sourceId),
      )
      .innerJoin(
        schema.contextItemVersions,
        eq(schema.contextItemVersions.id, schema.contextChunks.itemVersionId),
      )
      .where(
        and(
          ...filters,
          ...(afterChunkId ? [gt(schema.contextChunks.id, afterChunkId)] : []),
        ),
      )
      .orderBy(asc(schema.contextChunks.id))
      .limit(1_000);
    for (const row of page as any[]) {
      const tags = parseJson<string[]>(row.tags, []);
      const colors = parseJson<string[]>(row.colors, []);
      if (
        !(input.tags?.every((tag) => tags.includes(tag)) ?? true) ||
        !(input.colors?.every((color) => colors.includes(color)) ?? true)
      ) {
        continue;
      }
      rows.push({ ...row, tags, colors });
      if (rows.length === rowLimit) break;
    }
    if (page.length < 1_000) break;
    afterChunkId = String(page.at(-1)!.chunkId);
  }
  const documents: AccessibleSearchDocument[] = rows.map(
    (row: any): AccessibleSearchDocument => ({
      itemId: row.itemId,
      externalId: row.externalId,
      itemVersionId: row.itemVersionId,
      chunkId: row.chunkId,
      chunkOrdinal: row.chunkOrdinal,
      sourceId: row.sourceId,
      sourceName: row.sourceName,
      kind: row.kind,
      title: row.title,
      body: row.body,
      summary: row.summary ?? null,
      tags: row.tags,
      colors: row.colors,
      updatedAt: row.updatedAt,
      curationRank: contextMemberships?.get(row.itemVersionId)?.rank ?? row.curationRank,
      starred: Boolean(row.starred),
      indexState: row.indexState,
      inventoryOnly: row.parseStatus === "pending",
      priorReuseCount: 0,
      helpfulFeedbackCount: 0,
      excerpt: row.summary ?? row.body.slice(0, 600),
      score: 0,
      canonicalUrl: row.canonicalUrl ?? null,
      mimeType: row.mimeType ?? null,
    }),
  );
  if (!documents.length) return documents;
  const actor = requireActor();
  const versionIds: string[] = [
    ...new Set(
      documents.map((row: AccessibleSearchDocument) => row.itemVersionId),
    ),
  ];
  const [reuseRows, feedbackRows] = await Promise.all([
    getDb()
      .select({ itemVersionId: schema.contextPackMembers.itemVersionId })
      .from(schema.contextPackMembers)
      .where(
        and(
          inArray(schema.contextPackMembers.itemVersionId, versionIds),
          eq(schema.contextPackMembers.ownerEmail, actor.ownerEmail),
        ),
      ),
    getDb()
      .select({ itemVersionId: schema.contextFeedback.itemVersionId })
      .from(schema.contextFeedback)
      .where(
        and(
          inArray(schema.contextFeedback.itemVersionId, versionIds),
          eq(schema.contextFeedback.ownerEmail, actor.ownerEmail),
          eq(schema.contextFeedback.signal, "helpful"),
        ),
      ),
  ]);
  const reuseCounts = new Map<string, number>();
  const helpfulCounts = new Map<string, number>();
  for (const row of reuseRows as Array<{ itemVersionId: string }>) {
    reuseCounts.set(
      row.itemVersionId,
      (reuseCounts.get(row.itemVersionId) ?? 0) + 1,
    );
  }
  for (const row of feedbackRows as Array<{ itemVersionId: string }>) {
    helpfulCounts.set(
      row.itemVersionId,
      (helpfulCounts.get(row.itemVersionId) ?? 0) + 1,
    );
  }
  return documents.map((document: AccessibleSearchDocument) => ({
    ...document,
    priorReuseCount: reuseCounts.get(document.itemVersionId) ?? 0,
    helpfulFeedbackCount: helpfulCounts.get(document.itemVersionId) ?? 0,
  }));
}

export async function listAccessibleLexicalCandidates(
  input: AccessibleLexicalCandidatesInput,
): Promise<{
  results: ContextSearchResult[];
  nextCursor?: string;
}> {
  const { getDb, schema } = getCreativeContext();
  const offset = parseOffsetCursor(input.cursor);
  const packVersionIds: string[] | null = input.packId
    ? await accessiblePackVersionIds(input.packId)
    : null;
  const contextVersionIds: string[] | null = input.contextId
    ? await accessibleContextVersionIds(input.contextId)
    : null;
  const contextMemberships = input.contextId
    ? await accessibleContextMembershipMetadata(input.contextId)
    : null;
  if ((packVersionIds && !packVersionIds.length) || (contextVersionIds && !contextVersionIds.length)) return { results: [] };
  const matchMode = input.matchMode ?? "allTerms";
  const terms = normalizeSearchTerms(input.query);
  if (!terms.length && matchMode !== "regex") return { results: [] };
  const [phraseTerm, ...tokenTerms] = terms;
  const matchTerms = tokenTerms.length
    ? tokenTerms
    : phraseTerm
      ? [phraseTerm]
      : [];
  const likeClauses = matchTerms.map((term) => {
    const pattern = `%${escapeLikeTerm(term)}%`;
    return or(
      sql`lower(${schema.contextItems.title}) like ${pattern} escape '\\'`,
      sql`lower(${schema.contextChunks.text}) like ${pattern} escape '\\'`,
    );
  });
  const filters: any[] = [
    ...(input.contextId
      ? [inArray(schema.contextChunks.itemVersionId, contextVersionIds!)]
      : [
          accessFilter(schema.contextSources, schema.contextSourceShares),
          ne(schema.contextSources.upstreamAccess, "restricted"),
          ne(schema.contextSources.status, "archived"),
        ]),
    ...(packVersionIds
      ? [inArray(schema.contextChunks.itemVersionId, packVersionIds)]
      : [
          eq(
            schema.contextItems.currentVersionId,
            schema.contextChunks.itemVersionId,
          ),
        ]),
    eq(schema.contextItems.curationStatus, "included"),
    ne(schema.contextItems.curationRank, "ignored"),
    inArray(schema.contextItems.status, searchableItemStatuses(input.statuses)),
  ];
  if (matchMode !== "regex") {
    if (matchMode === "phrase") {
      const phrasePattern = `%${escapeLikeTerm(input.query.trim().toLocaleLowerCase())}%`;
      filters.push(
        or(
          sql`lower(${schema.contextItems.title}) like ${phrasePattern} escape '\\'`,
          sql`lower(${schema.contextChunks.text}) like ${phrasePattern} escape '\\'`,
        ),
      );
    } else {
      filters.push(
        matchMode === "allTerms" ? and(...likeClauses) : or(...likeClauses),
      );
    }
  }
  if (input.sourceIds?.length) {
    filters.push(inArray(schema.contextSources.id, input.sourceIds));
  }
  if (input.kinds?.length) {
    filters.push(inArray(schema.contextItems.kind, input.kinds));
  }
  if (input.updatedAfter) {
    filters.push(gte(schema.contextItems.updatedAt, input.updatedAfter));
  }
  if (input.updatedBefore) {
    filters.push(lte(schema.contextItems.updatedAt, input.updatedBefore));
  }

  const pageSize = 1000;
  const keep = offset + input.limit + 1;
  const scored: ContextSearchResult[] = [];
  let afterChunkId: string | undefined;
  while (true) {
    const rows = await getDb()
      .select({
        itemId: schema.contextItems.id,
        itemVersionId: schema.contextChunks.itemVersionId,
        chunkId: schema.contextChunks.id,
        sourceId: schema.contextSources.id,
        sourceName: schema.contextSources.name,
        kind: schema.contextItems.kind,
        title: schema.contextItems.title,
        body: sql<string>`substr(${schema.contextChunks.text}, 1, 12000)`,
        summary: schema.contextItemVersions.summary,
        metadata: schema.contextItems.metadata,
        tags: schema.contextItems.tags,
        colors: schema.contextItems.colors,
        curationRank: schema.contextItems.curationRank,
        starred: schema.contextItems.starred,
        canonicalUrl: schema.contextItems.canonicalUrl,
        mimeType: schema.contextItems.mimeType,
      })
      .from(schema.contextChunks)
      .innerJoin(
        schema.contextItems,
        eq(schema.contextItems.id, schema.contextChunks.itemId),
      )
      .innerJoin(
        schema.contextSources,
        eq(schema.contextSources.id, schema.contextItems.sourceId),
      )
      .innerJoin(
        schema.contextItemVersions,
        eq(schema.contextItemVersions.id, schema.contextChunks.itemVersionId),
      )
      .where(
        and(
          ...filters,
          ...(afterChunkId ? [gt(schema.contextChunks.id, afterChunkId)] : []),
        ),
      )
      .orderBy(asc(schema.contextChunks.id))
      .limit(pageSize);
    for (const row of rows as any[]) {
      const tags = new Set(parseJson<string[]>(row.tags, []));
      const colors = new Set(parseJson<string[]>(row.colors, []));
      if (
        !(input.tags?.every((tag) => tags.has(tag)) ?? true) ||
        !(input.colors?.every((color) => colors.has(color)) ?? true) ||
        !matchesCreativeSearchMode(
          `${row.title}\n${row.summary ?? ""}\n${row.body}`,
          input.query,
          matchMode,
        )
      ) {
        continue;
      }
      scored.push({
        itemId: row.itemId,
        itemVersionId: row.itemVersionId,
        chunkId: row.chunkId,
        sourceId: row.sourceId,
        sourceName: row.sourceName,
        kind: row.kind,
        title: row.title,
        excerpt: buildSearchSnippet(row.body, terms, 600),
        score:
          scoreSearchText(
            {
              title: row.title,
              summary: row.summary,
              body: row.body,
              metadata: row.metadata,
            },
            terms,
          ) +
          (row.starred
            ? 2
            : (contextMemberships?.get(row.itemVersionId)?.rank ?? row.curationRank) === "canonical"
              ? 1.5
              : (contextMemberships?.get(row.itemVersionId)?.rank ?? row.curationRank) === "exemplar"
                ? 1
                : 0),
        canonicalUrl: row.canonicalUrl ?? null,
        mimeType: row.mimeType ?? null,
      });
    }
    scored.sort(
      (a, b) =>
        b.score - a.score || (a.chunkId ?? "").localeCompare(b.chunkId ?? ""),
    );
    if (scored.length > keep) scored.length = keep;
    if (rows.length < pageSize) break;
    afterChunkId = String(rows.at(-1)!.chunkId);
  }
  const page = scored.slice(offset, offset + input.limit + 1);
  const hasMore = page.length > input.limit;
  return {
    results: page.slice(0, input.limit) as ContextSearchResult[],
    nextCursor: nextOffsetCursor(offset, input.limit, hasMore),
  };
}

export async function getCreativeContextItem(
  itemId: string,
  itemVersionId?: string,
): Promise<ContextDetail | null> {
  const { getDb, schema } = getCreativeContext();
  const itemRows = await getDb()
    .select({ item: schema.contextItems })
    .from(schema.contextItems)
    .innerJoin(
      schema.contextSources,
      eq(schema.contextSources.id, schema.contextItems.sourceId),
    )
    .leftJoin(
      schema.creativeContextMemberships,
      and(
        eq(schema.creativeContextMemberships.publishedItemId, schema.contextItems.id),
        eq(schema.creativeContextMemberships.status, "active"),
      ),
    )
    .leftJoin(
      schema.creativeContexts,
      eq(schema.creativeContexts.id, schema.creativeContextMemberships.contextId),
    )
    .leftJoin(
      schema.contextPackMembers,
      eq(schema.contextPackMembers.itemId, schema.contextItems.id),
    )
    .leftJoin(
      schema.contextPacks,
      eq(schema.contextPacks.id, schema.contextPackMembers.packId),
    )
    .where(
      and(
        eq(schema.contextItems.id, itemId),
        or(
          and(
            accessFilter(schema.contextSources, schema.contextSourceShares),
            ne(schema.contextSources.upstreamAccess, "restricted"),
            ne(schema.contextSources.status, "archived"),
          ),
          accessFilter(schema.creativeContexts, schema.creativeContextShares),
          accessFilter(schema.contextPacks, schema.contextPackShares),
        ),
        eq(schema.contextItems.curationStatus, "included"),
        ne(schema.contextItems.curationRank, "ignored"),
        eq(schema.contextItems.status, "active"),
      ),
    )
    .limit(1);
  const itemRow = itemRows[0]?.item;
  if (!itemRow) return null;
  const targetVersionId = itemVersionId ?? itemRow.currentVersionId;
  const versionRows = await getDb()
    .select()
    .from(schema.contextItemVersions)
    .where(
      and(
        eq(schema.contextItemVersions.id, targetVersionId),
        eq(schema.contextItemVersions.itemId, itemId),
      ),
    )
    .limit(1);
  if (!versionRows[0]) return null;
  const [chunkRows, mediaRows, edgeRows] = await Promise.all([
    getDb()
      .select()
      .from(schema.contextChunks)
      .where(eq(schema.contextChunks.itemVersionId, targetVersionId))
      .orderBy(asc(schema.contextChunks.ordinal)),
    getDb()
      .select()
      .from(schema.contextMedia)
      .where(eq(schema.contextMedia.itemVersionId, targetVersionId)),
    getDb()
      .select()
      .from(schema.contextEdges)
      .where(eq(schema.contextEdges.fromItemVersionId, targetVersionId)),
  ]);
  return {
    item: mapItem(itemRow),
    version: mapVersion(versionRows[0]),
    chunks: chunkRows.map(mapChunk),
    media: mediaRows.map(mapMedia),
    edges: edgeRows.map(mapEdge),
  };
}

export async function appendMediaEnrichmentVersion(input: {
  mediaId: string;
  palette: string[];
  contentHash: string;
  caption: string | null;
  captionStatus: "pending" | "complete" | "failed" | "not-needed";
  ocrText: string | null;
}): Promise<{
  itemId: string;
  itemVersionId: string;
  mediaId: string;
  appended: boolean;
}> {
  const { getDb, schema } = getCreativeContext();
  const rows = await getDb()
    .select({ itemId: schema.contextMedia.itemId })
    .from(schema.contextMedia)
    .where(eq(schema.contextMedia.id, input.mediaId))
    .limit(1);
  const itemId = rows[0]?.itemId;
  if (!itemId) throw new Error("Creative context media was not found");
  const detail = await getCreativeContextItem(itemId);
  if (!detail) throw new Error("Creative context media is not accessible");
  const target = detail.media.find(
    (media) =>
      media.id === input.mediaId ||
      media.metadata.__creativeContextEnrichmentSourceMediaId ===
        input.mediaId ||
      media.metadata.__creativeContextPreviousMediaId === input.mediaId,
  );
  if (!target) {
    throw new Error(
      "Creative context media enrichment can only append from the current item version",
    );
  }
  if (
    target.caption === input.caption &&
    target.captionStatus === input.captionStatus &&
    target.ocrText === input.ocrText &&
    target.contentHash === input.contentHash &&
    stringifyJson(target.palette) === stringifyJson(input.palette)
  ) {
    return {
      itemId,
      itemVersionId: detail.version.id,
      mediaId: target.id,
      appended: false,
    };
  }

  const sourceContentHash = mediaEnrichmentSourceContentHash(
    detail.version.metadata,
    detail.version.contentHash,
  );
  const media = detail.media.map((entry) => {
    const enriched = entry.id === target.id;
    return {
      kind: entry.kind,
      ...(entry.mimeType ? { mimeType: entry.mimeType } : {}),
      accessMode: entry.accessMode,
      ...(entry.url ? { url: entry.url } : {}),
      ...(entry.storageKey ? { storageKey: entry.storageKey } : {}),
      ...(entry.provenanceUrl ? { provenanceUrl: entry.provenanceUrl } : {}),
      ...(entry.altText ? { altText: entry.altText } : {}),
      ...(enriched
        ? { caption: input.caption ?? undefined }
        : { caption: entry.caption ?? undefined }),
      captionStatus: enriched ? input.captionStatus : entry.captionStatus,
      ...(enriched
        ? { ocrText: input.ocrText ?? undefined }
        : { ocrText: entry.ocrText ?? undefined }),
      palette: enriched ? input.palette : entry.palette,
      ...(enriched
        ? { contentHash: input.contentHash }
        : { contentHash: entry.contentHash ?? undefined }),
      ...(entry.width === null ? {} : { width: entry.width }),
      ...(entry.height === null ? {} : { height: entry.height }),
      ...(entry.durationMs === null ? {} : { durationMs: entry.durationMs }),
      metadata: {
        ...entry.metadata,
        __creativeContextEnrichmentSourceMediaId:
          entry.metadata.__creativeContextEnrichmentSourceMediaId ?? entry.id,
        __creativeContextPreviousMediaId: entry.id,
        ...(enriched ? { enrichmentDerived: true } : {}),
      },
    };
  });
  const canonicalMedia = media.map((entry) => {
    const {
      __creativeContextEnrichmentSourceMediaId: _sourceMediaId,
      __creativeContextPreviousMediaId: _previousMediaId,
      ...metadata
    } = entry.metadata;
    return { ...entry, metadata };
  });
  const derivedContentHash = await sha256(
    stringifyJson({
      sourceContentHash,
      media: canonicalMedia,
    }),
  );
  await ingestItems({
    sourceId: detail.item.sourceId,
    items: [
      {
        externalId: detail.item.externalId,
        kind: detail.item.kind,
        title: detail.item.title,
        canonicalUrl: detail.item.canonicalUrl ?? undefined,
        mimeType: detail.item.mimeType ?? undefined,
        content: detail.version.content,
        summary: detail.version.summary ?? undefined,
        contentHash: derivedContentHash,
        sourceModifiedAt: detail.version.sourceModifiedAt ?? undefined,
        sourceVersion: detail.version.sourceVersion ?? undefined,
        rawSnapshotBlobRef: detail.version.rawSnapshotBlobRef ?? undefined,
        parseStatus: detail.version.parseStatus,
        parseError: detail.version.parseError ?? undefined,
        upstreamAccess: detail.item.upstreamAccess,
        curationStatus: detail.item.curationStatus,
        curationRank: detail.item.curationRank,
        starred: detail.item.starred,
        inventoryState: detail.item.inventoryState,
        indexState: detail.item.indexState,
        tags: detail.item.tags,
        colors: detail.item.colors,
        sortOrder: detail.item.sortOrder,
        parentItemId: detail.item.parentItemId ?? undefined,
        provenance: detail.item.provenance,
        thumbnailBlobRef: detail.item.thumbnailBlobRef ?? undefined,
        metadata: {
          ...detail.version.metadata,
          __creativeContextDerivation: {
            kind: "media-enrichment",
            sourceContentHash,
            derivedFromVersionId: detail.version.id,
          },
        },
        chunks: detail.chunks.map((chunk) => ({
          ordinal: chunk.ordinal,
          kind: chunk.kind,
          text: chunk.text,
          startOffset: chunk.startOffset ?? undefined,
          endOffset: chunk.endOffset ?? undefined,
          tokenCount: chunk.tokenCount ?? undefined,
          metadata: chunk.metadata,
        })),
        media,
        edges: detail.edges
          .filter(
            (edge) =>
              edge.relation !== "revision-of" ||
              edge.metadata.automatic !== true,
          )
          .map((edge) => ({
            relation: edge.relation,
            toItemId: edge.toItemId ?? undefined,
            toItemVersionId: edge.toItemVersionId ?? undefined,
            toExternalId: edge.toExternalId ?? undefined,
            metadata: edge.metadata,
          })),
      },
    ],
  });
  const appended = await getCreativeContextItem(itemId);
  const enrichedMedia = appended?.media.find(
    (entry) => entry.metadata.__creativeContextPreviousMediaId === target.id,
  );
  if (!appended || !enrichedMedia) {
    throw new Error("Failed to append creative context media enrichment");
  }
  return {
    itemId,
    itemVersionId: appended.version.id,
    mediaId: enrichedMedia.id,
    appended: appended.version.id !== detail.version.id,
  };
}

export async function getCreativeContextItemByExternalId(input: {
  sourceId: string;
  externalId: string;
  itemId?: string;
  itemVersionId?: string;
  sourceVersion?: string;
}): Promise<ContextDetail | null> {
  if (Boolean(input.itemId) !== Boolean(input.itemVersionId)) return null;
  if (input.itemId && input.itemVersionId) {
    const pinned = await getCreativeContextItem(
      input.itemId,
      input.itemVersionId,
    );
    return pinned?.item.sourceId === input.sourceId &&
      pinned.item.externalId === input.externalId
      ? pinned
      : null;
  }
  const { getDb, schema } = getCreativeContext();
  const itemRows = await getDb()
    .select({ id: schema.contextItems.id })
    .from(schema.contextItems)
    .where(
      and(
        eq(schema.contextItems.sourceId, input.sourceId),
        eq(schema.contextItems.externalId, input.externalId),
      ),
    )
    .limit(1);
  const itemId = itemRows[0]?.id;
  if (!itemId) return null;
  if (!input.sourceVersion) return getCreativeContextItem(itemId);

  const versionRows = await getDb()
    .select({ id: schema.contextItemVersions.id })
    .from(schema.contextItemVersions)
    .where(
      and(
        eq(schema.contextItemVersions.itemId, itemId),
        eq(schema.contextItemVersions.sourceVersion, input.sourceVersion),
      ),
    )
    .orderBy(desc(schema.contextItemVersions.versionNumber))
    .limit(1);
  const versionId = versionRows[0]?.id;
  return versionId ? getCreativeContextItem(itemId, versionId) : null;
}

export async function createEmbeddingSet(input: {
  name: string;
  provider: string;
  family: string;
  model: string;
  version: string;
  dimensions: number;
  metric?: EmbeddingSet["metric"];
  metadata?: Record<string, unknown>;
}): Promise<EmbeddingSet> {
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  if (actor.orgId) {
    if (!(await currentRequestUserIsOrgAdmin(actor.orgId))) {
      throw new Error(
        "Only organization owners or admins can activate an organization embedding family.",
      );
    }
  }
  const row = {
    id: newId("cces"),
    name: input.name,
    provider: input.provider,
    family: input.family,
    model: input.model,
    version: input.version,
    dimensions: input.dimensions,
    metric: input.metric ?? "cosine",
    status: "active" as const,
    metadata: stringifyJson(input.metadata),
    createdAt: nowIso(),
    ownerEmail: actor.ownerEmail,
    orgId: actor.orgId,
  };
  await getDb().transaction(async (tx: any) => {
    await tx
      .update(schema.embeddingSets)
      .set({ status: "retired" })
      .where(
        and(
          actor.orgId
            ? eq(schema.embeddingSets.orgId, actor.orgId)
            : eq(schema.embeddingSets.ownerEmail, actor.ownerEmail),
          eq(schema.embeddingSets.status, "active"),
        ),
      );
    await tx.insert(schema.embeddingSets).values(row);
  });
  return { ...row, metadata: parseJson(row.metadata, {}) };
}

export async function getActiveEmbeddingSet(
  input: {
    family?: string;
    model?: string;
    version?: string;
  } = {},
): Promise<EmbeddingSet | null> {
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const filters: any[] = [
    actor.orgId
      ? eq(schema.embeddingSets.orgId, actor.orgId)
      : eq(schema.embeddingSets.ownerEmail, actor.ownerEmail),
    eq(schema.embeddingSets.status, "active"),
  ];
  if (input.family) filters.push(eq(schema.embeddingSets.family, input.family));
  if (input.model) filters.push(eq(schema.embeddingSets.model, input.model));
  if (input.version)
    filters.push(eq(schema.embeddingSets.version, input.version));
  const rows = await getDb()
    .select()
    .from(schema.embeddingSets)
    .where(and(...filters))
    .orderBy(
      desc(schema.embeddingSets.createdAt),
      desc(schema.embeddingSets.id),
    )
    .limit(1);
  const row = rows[0];
  return row
    ? {
        id: row.id,
        name: row.name,
        provider: row.provider,
        family: row.family,
        model: row.model,
        version: row.version,
        dimensions: row.dimensions,
        metric: row.metric,
        status: row.status,
        metadata: parseJson(row.metadata, {}),
        createdAt: row.createdAt,
      }
    : null;
}

export async function recordEmbeddingMetadata(input: {
  embeddingSetId: string;
  itemId: string;
  itemVersionId: string;
  chunkId?: string;
  targetType?: "item" | "chunk" | "media";
  targetId?: string;
  vectorKey: string;
  dimensions: number;
  checksum?: string;
}): Promise<ContextEmbeddingMetadata> {
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const detail = await getCreativeContextItem(
    input.itemId,
    input.itemVersionId,
  );
  if (!detail)
    throw new Error("Context item version not found or not accessible");
  if (input.chunkId) {
    const chunk = detail.chunks.find((entry) => entry.id === input.chunkId);
    if (!chunk) throw new Error("Embedding chunk must belong to item version");
  }
  const targetType = input.targetType ?? (input.chunkId ? "chunk" : "item");
  const targetId = input.targetId ?? input.chunkId ?? input.itemVersionId;
  if (
    targetType === "chunk" &&
    !detail.chunks.some((entry) => entry.id === targetId)
  ) {
    throw new Error("Embedding chunk target must belong to item version");
  }
  if (
    targetType === "media" &&
    !detail.media.some((entry) => entry.id === targetId)
  ) {
    throw new Error("Embedding media target must belong to item version");
  }
  if (targetType === "item" && targetId !== input.itemVersionId) {
    throw new Error("Item embeddings target the exact item version id");
  }
  const sets = await getDb()
    .select()
    .from(schema.embeddingSets)
    .where(
      and(
        eq(schema.embeddingSets.id, input.embeddingSetId),
        actor.orgId
          ? eq(schema.embeddingSets.orgId, actor.orgId)
          : eq(schema.embeddingSets.ownerEmail, actor.ownerEmail),
      ),
    )
    .limit(1);
  const set = sets[0];
  if (!set || set.status !== "active") {
    throw new Error("Active embedding set not found");
  }
  if (set.dimensions !== input.dimensions) {
    throw new Error("Embedding dimensions do not match embedding set");
  }
  const existing = await getDb()
    .select({
      id: schema.embeddings.id,
      vectorKey: schema.embeddings.vectorKey,
      dimensions: schema.embeddings.dimensions,
    })
    .from(schema.embeddings)
    .where(
      and(
        eq(schema.embeddings.embeddingSetId, input.embeddingSetId),
        eq(schema.embeddings.targetType, targetType),
        eq(schema.embeddings.targetId, targetId),
      ),
    )
    .limit(1);
  const row = {
    id: existing[0]?.id ?? newId("cce"),
    embeddingSetId: input.embeddingSetId,
    family: set.family,
    model: set.model,
    version: set.version,
    itemId: input.itemId,
    itemVersionId: input.itemVersionId,
    chunkId: input.chunkId ?? null,
    targetType,
    targetId,
    vectorKey: input.vectorKey,
    dimensions: input.dimensions,
    checksum: input.checksum ?? null,
    createdAt: nowIso(),
    ownerEmail: actor.ownerEmail,
    orgId: actor.orgId,
  };
  await getDb()
    .insert(schema.embeddings)
    .values(row)
    .onConflictDoUpdate({
      target: [
        schema.embeddings.embeddingSetId,
        schema.embeddings.targetType,
        schema.embeddings.targetId,
      ],
      set: {
        family: row.family,
        model: row.model,
        version: row.version,
        itemId: row.itemId,
        itemVersionId: row.itemVersionId,
        chunkId: row.chunkId,
        vectorKey: row.vectorKey,
        dimensions: row.dimensions,
        checksum: row.checksum,
        createdAt: row.createdAt,
        ownerEmail: row.ownerEmail,
        orgId: row.orgId,
      },
    });
  if (existing[0] && existing[0].vectorKey !== input.vectorKey) {
    await getCreativeContext().vectorAdapter?.delete(existing[0]);
  }
  return row;
}

export async function listEmbeddingMetadata(input: {
  embeddingSetId: string;
  itemVersionIds?: string[];
  sourceIds?: string[];
  packId?: string;
  kinds?: string[];
  tags?: string[];
  colors?: string[];
  updatedAfter?: string;
  updatedBefore?: string;
  statuses?: ContextItemSummary["status"][];
}): Promise<ContextEmbeddingMetadata[]> {
  const { getDb, schema } = getCreativeContext();
  if (input.itemVersionIds && !input.itemVersionIds.length) return [];
  const packVersionIds: string[] | null = input.packId
    ? await accessiblePackVersionIds(input.packId)
    : null;
  if (packVersionIds && !packVersionIds.length) return [];
  const filters: any[] = [
    eq(schema.embeddings.embeddingSetId, input.embeddingSetId),
    ...(packVersionIds
      ? [inArray(schema.embeddings.itemVersionId, packVersionIds)]
      : [
          eq(
            schema.contextItems.currentVersionId,
            schema.embeddings.itemVersionId,
          ),
        ]),
    accessFilter(schema.contextSources, schema.contextSourceShares),
    ne(schema.contextSources.upstreamAccess, "restricted"),
    ne(schema.contextSources.status, "archived"),
    eq(schema.contextItems.curationStatus, "included"),
    ne(schema.contextItems.curationRank, "ignored"),
    inArray(schema.contextItems.status, searchableItemStatuses(input.statuses)),
  ];
  if (input.itemVersionIds) {
    filters.push(
      inArray(schema.embeddings.itemVersionId, input.itemVersionIds),
    );
  }
  if (input.sourceIds?.length) {
    filters.push(inArray(schema.contextSources.id, input.sourceIds));
  }
  if (input.kinds?.length) {
    filters.push(inArray(schema.contextItems.kind, input.kinds));
  }
  if (input.updatedAfter) {
    filters.push(gte(schema.contextItems.updatedAt, input.updatedAfter));
  }
  if (input.updatedBefore) {
    filters.push(lte(schema.contextItems.updatedAt, input.updatedBefore));
  }
  const rows = await getDb()
    .select({
      id: schema.embeddings.id,
      embeddingSetId: schema.embeddings.embeddingSetId,
      family: schema.embeddings.family,
      model: schema.embeddings.model,
      version: schema.embeddings.version,
      itemId: schema.embeddings.itemId,
      itemVersionId: schema.embeddings.itemVersionId,
      chunkId: schema.embeddings.chunkId,
      targetType: schema.embeddings.targetType,
      targetId: schema.embeddings.targetId,
      vectorKey: schema.embeddings.vectorKey,
      dimensions: schema.embeddings.dimensions,
      checksum: schema.embeddings.checksum,
      createdAt: schema.embeddings.createdAt,
      tags: schema.contextItems.tags,
      colors: schema.contextItems.colors,
    })
    .from(schema.embeddings)
    .innerJoin(
      schema.contextItems,
      eq(schema.contextItems.id, schema.embeddings.itemId),
    )
    .innerJoin(
      schema.contextSources,
      eq(schema.contextSources.id, schema.contextItems.sourceId),
    )
    .where(and(...filters));
  return (rows as any[])
    .filter((row) => {
      const tags = parseJson<string[]>(row.tags, []);
      const colors = parseJson<string[]>(row.colors, []);
      return (
        (input.tags?.every((tag) => tags.includes(tag)) ?? true) &&
        (input.colors?.every((color) => colors.includes(color)) ?? true)
      );
    })
    .map(({ tags: _tags, colors: _colors, ...row }) => row);
}

export async function recordContextFeedback(input: {
  itemId: string;
  itemVersionId?: string;
  signal: ContextFeedbackSignal;
  note?: string;
}): Promise<{ recorded: true }> {
  const detail = await getCreativeContextItem(
    input.itemId,
    input.itemVersionId,
  );
  if (!detail)
    throw new Error("Context item version not found or not accessible");
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  await getDb()
    .insert(schema.contextFeedback)
    .values({
      id: newId("ccf"),
      itemId: input.itemId,
      itemVersionId: detail.version.id,
      signal: input.signal,
      note: input.note ?? null,
      createdAt: nowIso(),
      ownerEmail: actor.ownerEmail,
      orgId: actor.orgId,
    });
  return { recorded: true };
}

export async function reviewContextItems(input: {
  sourceId: string;
  operation:
    | "list"
    | "approve"
    | "exclude"
    | "exemplar"
    | "normal"
    | "ignore"
    | "star"
    | "unstar"
    | "deprecate"
    | "restore";
  itemIds?: string[];
  limit?: number;
  queue?: "restricted" | "all";
}): Promise<{ items: ContextReviewItem[]; updated: number }> {
  const { getDb, schema } = getCreativeContext();
  await assertAccess(
    "creative-context-source",
    input.sourceId,
    input.operation === "list" ? "viewer" : "editor",
    undefined,
    { skipResourceBody: true },
  );
  const pendingFilter = and(
    eq(schema.contextItems.sourceId, input.sourceId),
    eq(schema.contextItems.upstreamAccess, "restricted"),
    eq(schema.contextItems.curationStatus, "review"),
  );
  if (input.operation !== "list") {
    const itemIds = Array.from(new Set(input.itemIds ?? []));
    if (!itemIds.length) throw new Error("itemIds are required for review");
    const eligibleFilter =
      input.operation === "approve" || input.operation === "exclude"
        ? and(
            eq(schema.contextItems.sourceId, input.sourceId),
            eq(schema.contextItems.upstreamAccess, "restricted"),
            inArray(schema.contextItems.curationStatus, [
              "review",
              "included",
              "excluded",
            ]),
            inArray(schema.contextItems.id, itemIds),
          )
        : and(
            eq(schema.contextItems.sourceId, input.sourceId),
            inArray(schema.contextItems.id, itemIds),
          );
    const eligible = await getDb()
      .select({ id: schema.contextItems.id })
      .from(schema.contextItems)
      .where(eligibleFilter);
    if (eligible.length !== itemIds.length) {
      throw new Error(
        "All curated items must belong to the accessible source and be eligible for the operation",
      );
    }
    const valuesByOperation: Record<string, Record<string, unknown>> = {
      approve: { curationStatus: "included" },
      exclude: { curationStatus: "excluded" },
      exemplar: { curationRank: "exemplar" },
      normal: { curationRank: "normal" },
      ignore: { curationRank: "ignored" },
      star: { starred: 1 },
      unstar: { starred: 0 },
      deprecate: { status: "deprecated" },
      restore: { status: "active" },
    };
    const mutationValues = valuesByOperation[input.operation]!;
    const timestamp = nowIso();
    await getDb().transaction(async (tx: any) => {
      await tx
        .update(schema.contextItems)
        .set({ ...mutationValues, updatedAt: timestamp })
        .where(inArray(schema.contextItems.id, itemIds));
    });
    return { items: [], updated: itemIds.length };
  }
  const rows = await getDb()
    .select({
      id: schema.contextItems.id,
      currentVersionId: schema.contextItems.currentVersionId,
      sourceId: schema.contextItems.sourceId,
      externalId: schema.contextItems.externalId,
      kind: schema.contextItems.kind,
      title: schema.contextItems.title,
      canonicalUrl: schema.contextItems.canonicalUrl,
      upstreamAccess: schema.contextItems.upstreamAccess,
      curationStatus: schema.contextItems.curationStatus,
      curationRank: schema.contextItems.curationRank,
      starred: schema.contextItems.starred,
      status: schema.contextItems.status,
      inventoryState: schema.contextItems.inventoryState,
      tags: schema.contextItems.tags,
      colors: schema.contextItems.colors,
      parentItemId: schema.contextItems.parentItemId,
      provenance: schema.contextItems.provenance,
      thumbnailBlobRef: schema.contextItems.thumbnailBlobRef,
      updatedAt: schema.contextItems.updatedAt,
    })
    .from(schema.contextItems)
    .where(
      input.queue === "all"
        ? and(
            eq(schema.contextItems.sourceId, input.sourceId),
            ne(schema.contextItems.status, "deleted"),
          )
        : pendingFilter,
    )
    .orderBy(desc(schema.contextItems.updatedAt))
    .limit(input.limit ?? 100);
  return {
    items: rows.map((row: any) => ({
      ...row,
      canonicalUrl: row.canonicalUrl ?? null,
      starred: Boolean(row.starred),
      tags: parseJson(row.tags, []),
      colors: parseJson(row.colors, []),
      parentItemId: row.parentItemId ?? null,
      provenance: parseJson(row.provenance, {}),
      thumbnailBlobRef: row.thumbnailBlobRef ?? null,
    })),
    updated: 0,
  };
}
