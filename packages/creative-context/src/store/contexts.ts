import {
  assertCurrentRequestUserIsOrgAdmin,
  currentRequestUserIsOrgAdmin,
} from "@agent-native/core/server";
import {
  accessFilter,
  assertAccess,
  resolveAccess,
} from "@agent-native/core/sharing";
import { and, asc, count, eq, gt, inArray, isNull } from "drizzle-orm";

import { creativeContextMediaUrl } from "../media-url.js";
import { getCreativeContext } from "../server/context.js";
import {
  captureNativeCreativeResource,
  type NativeCreativeResourceRef,
} from "../server/native-resource-capture.js";
import { sanitizePublicMetadata } from "../server/public-serialization.js";
import type {
  CreativeContextApprovalPolicy,
  CreativeContextMembership,
  CreativeContextSubmissionSummary,
  CreativeContextSummary,
  NormalizedContextItem,
} from "../types.js";
import { getCreativeContextItem } from "./content.js";
import {
  newId,
  nowIso,
  parseJson,
  requireActor,
  stringifyJson,
} from "./helpers.js";

type Rank = "canonical" | "exemplar" | "normal";

function mapContext(row: any, memberCount = 0): CreativeContextSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    kind: row.kind,
    brandProfileId: row.brandProfileId ?? null,
    approvalPolicy: row.approvalPolicy,
    archivedAt: row.archivedAt ?? null,
    visibility: row.visibility,
    memberCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapMembership(row: any): CreativeContextMembership {
  return {
    id: row.id,
    contextId: row.contextId,
    artifactKey: row.artifactKey,
    publishedItemId: row.publishedItemId ?? null,
    publishedItemVersionId: row.publishedItemVersionId ?? null,
    pendingSubmissionId: row.pendingSubmissionId ?? null,
    rank: row.rank,
    purpose: row.purpose ?? null,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapSubmission(row: any): CreativeContextSubmissionSummary {
  return {
    id: row.id,
    contextId: row.contextId,
    membershipId: row.membershipId,
    artifactKey: row.artifactKey,
    publishedItemId: row.publishedItemId ?? null,
    publishedItemVersionId: row.publishedItemVersionId ?? null,
    note: row.note ?? null,
    status: row.status,
    submittedBy: row.submittedBy,
    reviewedBy: row.reviewedBy ?? null,
    reviewNote: row.reviewNote ?? null,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt ?? null,
  };
}

async function appendAudit(
  tx: any,
  contextId: string,
  operation: string,
  details: Record<string, unknown>,
) {
  const { schema } = getCreativeContext();
  const actor = requireActor();
  await tx.insert(schema.creativeContextAudit).values({
    id: newId("cca"),
    contextId,
    operation,
    actorEmail: actor.ownerEmail,
    details: stringifyJson(details),
    createdAt: nowIso(),
    ownerEmail: actor.ownerEmail,
    orgId: actor.orgId,
  });
}

async function assertContextRole(
  contextId: string,
  role: "viewer" | "editor" | "admin",
) {
  return assertAccess("creative-context", contextId, role, undefined, {
    skipResourceBody: true,
  });
}

async function requireReviewer(
  contextId: string,
  policy?: CreativeContextApprovalPolicy,
) {
  await assertContextRole(contextId, "editor");
  if (policy === "admins-only") await assertCurrentRequestUserIsOrgAdmin();
}

function normalizedFromDetail(
  detail: NonNullable<Awaited<ReturnType<typeof getCreativeContextItem>>>,
): NormalizedContextItem {
  return {
    externalId: detail.item.externalId,
    kind: detail.item.kind,
    title: detail.version.title,
    canonicalUrl: detail.item.canonicalUrl ?? undefined,
    mimeType: detail.version.mimeType ?? undefined,
    content: detail.version.content,
    summary: detail.version.summary ?? undefined,
    contentHash: detail.version.contentHash,
    sourceModifiedAt: detail.version.sourceModifiedAt ?? undefined,
    sourceVersion: detail.version.sourceVersion ?? undefined,
    rawSnapshotBlobRef: detail.version.rawSnapshotBlobRef ?? undefined,
    parseStatus: detail.version.parseStatus,
    parseError: detail.version.parseError ?? undefined,
    upstreamAccess: detail.item.upstreamAccess,
    curationStatus: "included",
    curationRank:
      detail.item.curationRank === "ignored"
        ? "normal"
        : detail.item.curationRank,
    tags: detail.item.tags,
    colors: detail.item.colors,
    provenance: detail.item.provenance,
    thumbnailBlobRef: detail.item.thumbnailBlobRef ?? undefined,
    metadata: {},
    chunks: detail.chunks.map((chunk) => ({
      ordinal: chunk.ordinal,
      kind: chunk.kind,
      text: chunk.text,
      ...(chunk.startOffset === null ? {} : { startOffset: chunk.startOffset }),
      ...(chunk.endOffset === null ? {} : { endOffset: chunk.endOffset }),
      ...(chunk.tokenCount === null ? {} : { tokenCount: chunk.tokenCount }),
      metadata: chunk.metadata,
    })),
    media: detail.media.map((media) => ({
      kind: media.kind,
      ...(media.mimeType ? { mimeType: media.mimeType } : {}),
      accessMode: media.accessMode,
      ...(media.url ? { url: media.url } : {}),
      ...(media.storageKey ? { storageKey: media.storageKey } : {}),
      ...(media.provenanceUrl ? { provenanceUrl: media.provenanceUrl } : {}),
      ...(media.altText ? { altText: media.altText } : {}),
      ...(media.caption ? { caption: media.caption } : {}),
      captionStatus: media.captionStatus,
      ...(media.ocrText ? { ocrText: media.ocrText } : {}),
      palette: media.palette,
      ...(media.contentHash ? { contentHash: media.contentHash } : {}),
      ...(media.width === null ? {} : { width: media.width }),
      ...(media.height === null ? {} : { height: media.height }),
      ...(media.durationMs === null ? {} : { durationMs: media.durationMs }),
      metadata: media.metadata,
    })),
    edges: detail.edges.map((edge) => ({
      relation: edge.relation,
      ...(edge.toItemId ? { toItemId: edge.toItemId } : {}),
      ...(edge.toItemVersionId
        ? { toItemVersionId: edge.toItemVersionId }
        : {}),
      ...(edge.toExternalId ? { toExternalId: edge.toExternalId } : {}),
      metadata: edge.metadata,
    })),
  };
}

async function writeSnapshot(input: {
  sourceId: string;
  artifactKey: string;
  item: NormalizedContextItem;
  ownerEmail: string;
  orgId: string | null;
}) {
  const { getDb, schema } = getCreativeContext();
  const timestamp = nowIso();
  const existing = await getDb()
    .select()
    .from(schema.contextItems)
    .where(
      and(
        eq(schema.contextItems.sourceId, input.sourceId),
        eq(schema.contextItems.externalId, input.artifactKey),
      ),
    )
    .limit(1);
  const previous = existing[0] as any;
  const itemId = previous?.id ?? newId("cci");
  const itemVersionId = newId("ccv");
  const versionNumber = previous
    ? (
        await getDb()
          .select({ versionNumber: schema.contextItemVersions.versionNumber })
          .from(schema.contextItemVersions)
          .where(eq(schema.contextItemVersions.id, previous.currentVersionId))
          .limit(1)
      )[0]?.versionNumber + 1
    : 1;
  const itemValues = {
    kind: input.item.kind,
    title: input.item.title,
    canonicalUrl: input.item.canonicalUrl ?? null,
    mimeType: input.item.mimeType ?? null,
    currentVersionId: itemVersionId,
    currentContentHash: input.item.contentHash,
    status: "active" as const,
    upstreamAccess: input.item.upstreamAccess ?? "available",
    curationStatus: "included" as const,
    curationRank: input.item.curationRank ?? "normal",
    starred: input.item.starred ? 1 : 0,
    inventoryState: input.item.inventoryState ?? "available",
    indexState: input.item.indexState ?? "pending",
    tags: stringifyJson(input.item.tags ?? []),
    colors: stringifyJson(
      input.item.colors ?? (input.item.color ? [input.item.color] : []),
    ),
    sortOrder: input.item.sortOrder ?? 0,
    parentItemId: input.item.parentItemId ?? null,
    provenance: stringifyJson(input.item.provenance),
    thumbnailBlobRef: input.item.thumbnailBlobRef ?? null,
    metadata: stringifyJson(input.item.metadata),
    updatedAt: timestamp,
  };
  await getDb().transaction(async (tx: any) => {
    if (previous)
      await tx
        .update(schema.contextItems)
        .set(itemValues)
        .where(eq(schema.contextItems.id, itemId));
    else
      await tx
        .insert(schema.contextItems)
        .values({
          id: itemId,
          sourceId: input.sourceId,
          externalId: input.artifactKey,
          ...itemValues,
          createdAt: timestamp,
          ownerEmail: input.ownerEmail,
          orgId: input.orgId,
        });
    await tx.insert(schema.contextItemVersions).values({
      id: itemVersionId,
      itemId,
      versionNumber: Number(versionNumber ?? 1),
      contentHash: input.item.contentHash,
      title: input.item.title,
      content: input.item.content,
      summary: input.item.summary ?? null,
      mimeType: input.item.mimeType ?? null,
      sourceModifiedAt: input.item.sourceModifiedAt ?? null,
      sourceVersion: input.item.sourceVersion ?? null,
      rawSnapshotBlobRef: input.item.rawSnapshotBlobRef ?? null,
      parseStatus: input.item.parseStatus ?? "parsed",
      parseError: input.item.parseError ?? null,
      metadata: stringifyJson(input.item.metadata),
      createdAt: timestamp,
      ownerEmail: input.ownerEmail,
      orgId: input.orgId,
    });
    const chunks = input.item.chunks?.length
      ? input.item.chunks
      : [{ ordinal: 0, kind: "text", text: input.item.content }];
    await tx
      .insert(schema.contextChunks)
      .values(
        chunks.map((chunk) => ({
          id: newId("ccc"),
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
          ownerEmail: input.ownerEmail,
          orgId: input.orgId,
        })),
      );
    if (input.item.media?.length)
      await tx
        .insert(schema.contextMedia)
        .values(
          input.item.media.map((media) => ({
            id: newId("ccm"),
            itemId,
            itemVersionId,
            kind: media.kind,
            mimeType: media.mimeType ?? null,
            accessMode: media.accessMode ?? "public",
            url: media.accessMode === "public" ? (media.url ?? null) : null,
            storageKey: media.storageKey ?? null,
            provenanceUrl: media.provenanceUrl ?? media.url ?? null,
            altText: media.altText ?? null,
            caption: media.caption ?? null,
            captionStatus: media.captionStatus ?? "pending",
            ocrText: media.ocrText ?? null,
            palette: stringifyJson(media.palette ?? []),
            contentHash: media.contentHash ?? null,
            width: media.width ?? null,
            height: media.height ?? null,
            durationMs: media.durationMs ?? null,
            metadata: stringifyJson(media.metadata),
            createdAt: timestamp,
            ownerEmail: input.ownerEmail,
            orgId: input.orgId,
          })),
        );
    if (input.item.edges?.length)
      await tx
        .insert(schema.contextEdges)
        .values(
          input.item.edges.map((edge) => ({
            id: newId("cce"),
            fromItemId: itemId,
            fromItemVersionId: itemVersionId,
            toItemId: edge.toItemId ?? null,
            toItemVersionId: edge.toItemVersionId ?? null,
            toExternalId: edge.toExternalId ?? null,
            relation: edge.relation,
            metadata: stringifyJson(edge.metadata),
            createdAt: timestamp,
            ownerEmail: input.ownerEmail,
            orgId: input.orgId,
          })),
        );
    await tx
      .update(schema.contextSources)
      .set({ updatedAt: timestamp })
      .where(eq(schema.contextSources.id, input.sourceId));
  });
  return { itemId, itemVersionId };
}

async function readSnapshot(
  itemId: string,
  itemVersionId: string,
): Promise<NormalizedContextItem> {
  const { getDb, schema } = getCreativeContext();
  const [item] = await getDb()
    .select()
    .from(schema.contextItems)
    .where(eq(schema.contextItems.id, itemId))
    .limit(1);
  const [version] = await getDb()
    .select()
    .from(schema.contextItemVersions)
    .where(eq(schema.contextItemVersions.id, itemVersionId))
    .limit(1);
  if (!item || !version)
    throw new Error("Staged context snapshot was not found");
  const [chunks, media] = await Promise.all([
    getDb()
      .select()
      .from(schema.contextChunks)
      .where(eq(schema.contextChunks.itemVersionId, itemVersionId)),
    getDb()
      .select()
      .from(schema.contextMedia)
      .where(eq(schema.contextMedia.itemVersionId, itemVersionId)),
  ]);
  return {
    externalId: item.externalId,
    kind: item.kind,
    title: version.title,
    canonicalUrl: item.canonicalUrl ?? undefined,
    mimeType: version.mimeType ?? undefined,
    content: version.content,
    summary: version.summary ?? undefined,
    contentHash: version.contentHash,
    sourceModifiedAt: version.sourceModifiedAt ?? undefined,
    sourceVersion: version.sourceVersion ?? undefined,
    rawSnapshotBlobRef: version.rawSnapshotBlobRef ?? undefined,
    parseStatus: version.parseStatus,
    parseError: version.parseError ?? undefined,
    upstreamAccess: item.upstreamAccess,
    curationStatus: "included",
    curationRank: item.curationRank,
    tags: parseJson(item.tags, []),
    colors: parseJson(item.colors, []),
    provenance: parseJson(item.provenance, {}),
    thumbnailBlobRef: item.thumbnailBlobRef ?? undefined,
    metadata: parseJson(version.metadata, {}),
    chunks: chunks.map((row: any) => ({
      ordinal: row.ordinal,
      kind: row.kind,
      text: row.text,
      startOffset: row.startOffset ?? undefined,
      endOffset: row.endOffset ?? undefined,
      tokenCount: row.tokenCount ?? undefined,
      metadata: parseJson(row.metadata, {}),
    })),
    media: media.map((row: any) => ({
      kind: row.kind,
      mimeType: row.mimeType ?? undefined,
      accessMode: row.accessMode,
      url: row.url ?? undefined,
      storageKey: row.storageKey ?? undefined,
      provenanceUrl: row.provenanceUrl ?? undefined,
      altText: row.altText ?? undefined,
      caption: row.caption ?? undefined,
      captionStatus: row.captionStatus,
      ocrText: row.ocrText ?? undefined,
      palette: parseJson(row.palette, []),
      contentHash: row.contentHash ?? undefined,
      width: row.width ?? undefined,
      height: row.height ?? undefined,
      durationMs: row.durationMs ?? undefined,
      metadata: parseJson(row.metadata, {}),
    })),
  };
}

export async function createCreativeContext(input: {
  name: string;
  description?: string | null;
  kind: "default" | "specialty";
  brandProfileId?: string | null;
  approvalPolicy?: CreativeContextApprovalPolicy;
}) {
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const timestamp = nowIso();
  if (actor.orgId) await assertCurrentRequestUserIsOrgAdmin(actor.orgId);
  if (input.kind === "default") {
    const defaultScope = actor.orgId
      ? eq(schema.creativeContexts.orgId, actor.orgId)
      : and(
          isNull(schema.creativeContexts.orgId),
          eq(schema.creativeContexts.ownerEmail, actor.ownerEmail),
        );
    const existing = await getDb()
      .select({ id: schema.creativeContexts.id })
      .from(schema.creativeContexts)
      .where(and(eq(schema.creativeContexts.kind, "default"), defaultScope))
      .limit(1);
    if (existing[0]) return getCreativeContextById(existing[0].id);
  }
  const id = newId("ccx"),
    stagingSourceId = newId("ccs"),
    publishedSourceId = newId("ccs");
  await getDb().transaction(async (tx: any) => {
    for (const [sourceId, name, purpose] of [
      [stagingSourceId, `${input.name} staging`, "staging"],
      [publishedSourceId, `${input.name} published`, "published"],
    ] as const)
      await tx
        .insert(schema.contextSources)
        .values({
          id: sourceId,
          name,
          kind: "manual",
          config: stringifyJson({ governedContextId: id, purpose }),
          upstreamAccess: "available",
          status: "active",
          healthStatus: "healthy",
          itemCount: 0,
          restrictedItemCount: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
          ownerEmail: actor.ownerEmail,
          orgId: actor.orgId,
          visibility: "private",
        });
    await tx
      .insert(schema.creativeContexts)
      .values({
        id,
        name: input.name,
        description: input.description ?? null,
        kind: input.kind,
        brandProfileId: input.brandProfileId ?? null,
        stagingSourceId,
        publishedSourceId,
        approvalPolicy: input.approvalPolicy ?? "open",
        archivedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        ownerEmail: actor.ownerEmail,
        orgId: actor.orgId,
        visibility: actor.orgId ? "org" : "private",
      });
    await appendAudit(tx, id, "create", {
      kind: input.kind,
      approvalPolicy: input.approvalPolicy ?? "open",
    });
  });
  return getCreativeContextById(id);
}

/** Idempotently establishes the actor's governed Default with the currently usable corpus. */
export async function ensureDefaultCreativeContext(): Promise<CreativeContextSummary | null> {
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const scope = actor.orgId
    ? eq(schema.creativeContexts.orgId, actor.orgId)
    : isNull(schema.creativeContexts.orgId);
  const defaultOwnerScope = actor.orgId
    ? scope
    : and(scope, eq(schema.creativeContexts.ownerEmail, actor.ownerEmail));
  const existing = await getDb()
    .select()
    .from(schema.creativeContexts)
    .where(
      and(
        eq(schema.creativeContexts.kind, "default"),
        defaultOwnerScope,
      ),
    )
    .limit(1);
  if (existing[0]) return getCreativeContextById(existing[0].id);
  if (actor.orgId && !(await currentRequestUserIsOrgAdmin(actor.orgId)))
    return null;
  const profileRows = await getDb()
    .select({ id: schema.brandProfiles.id })
    .from(schema.brandProfiles)
    .innerJoin(
      schema.brandDnaVersions,
      eq(schema.brandDnaVersions.profileId, schema.brandProfiles.id),
    )
    .where(
      and(
        accessFilter(schema.brandProfiles, schema.brandProfileShares),
        eq(schema.brandDnaVersions.status, "published"),
      ),
    )
    .limit(1);
  const created = await createCreativeContext({
    name: "Default",
    kind: "default",
    brandProfileId: profileRows[0]?.id ?? null,
    approvalPolicy: "open",
  });
  if (!created) return null;
  const corpus = await getDb()
    .select({
      itemId: schema.contextItems.id,
      itemVersionId: schema.contextItems.currentVersionId,
      sourceId: schema.contextSources.id,
      externalId: schema.contextItems.externalId,
      rank: schema.contextItems.curationRank,
    })
    .from(schema.contextItems)
    .innerJoin(
      schema.contextSources,
      eq(schema.contextSources.id, schema.contextItems.sourceId),
    )
    .where(
      and(
        accessFilter(schema.contextSources, schema.contextSourceShares),
        eq(schema.contextItems.curationStatus, "included"),
        eq(schema.contextItems.status, "active"),
        eq(schema.contextSources.status, "active"),
        eq(schema.contextSources.upstreamAccess, "available"),
      ),
    )
    .limit(5_000);
  const timestamp = nowIso();
  if (corpus.length)
    await getDb().transaction(async (tx: any) => {
      await tx
        .insert(schema.creativeContextMemberships)
        .values(
          (corpus as any[]).map((item) => ({
            id: newId("ccmbr"),
            contextId: created.id,
            artifactKey: `${item.sourceId}:${item.externalId}`,
            publishedItemId: item.itemId,
            publishedItemVersionId: item.itemVersionId,
            pendingSubmissionId: null,
            rank:
              item.rank === "canonical" || item.rank === "exemplar"
                ? item.rank
                : "normal",
            purpose: "Backfilled accessible corpus",
            status: "active",
            createdAt: timestamp,
            updatedAt: timestamp,
            ownerEmail: actor.ownerEmail,
            orgId: actor.orgId,
          })),
        );
      await appendAudit(tx, created.id, "backfill-default", {
        members: corpus.length,
        brandProfileId: profileRows[0]?.id ?? null,
      });
    });
  return getCreativeContextById(created.id);
}

export async function getCreativeContextById(
  contextId: string,
): Promise<CreativeContextSummary | null> {
  const access = await resolveAccess("creative-context", contextId);
  if (!access) return null;
  const { getDb, schema } = getCreativeContext();
  const [membershipCount] = await getDb()
    .select({ value: count() })
    .from(schema.creativeContextMemberships)
    .where(
      and(
        eq(schema.creativeContextMemberships.contextId, contextId),
        eq(schema.creativeContextMemberships.status, "active"),
      ),
    );
  return mapContext(access.resource, Number(membershipCount?.value ?? 0));
}

export async function getCreativeContextAppBinding(
  appId: string,
): Promise<CreativeContextSummary | null> {
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const scope = actor.orgId
    ? eq(schema.creativeContextAppBindings.orgId, actor.orgId)
    : isNull(schema.creativeContextAppBindings.orgId);
  const rows = await getDb()
    .select({ contextId: schema.creativeContextAppBindings.contextId })
    .from(schema.creativeContextAppBindings)
    .where(
      and(
        eq(schema.creativeContextAppBindings.appId, appId),
        scope,
        ...(actor.orgId
          ? []
          : [eq(schema.creativeContextAppBindings.ownerEmail, actor.ownerEmail)]),
      ),
    )
    .orderBy(asc(schema.creativeContextAppBindings.updatedAt))
    .limit(1);
  return rows[0] ? getCreativeContextById(rows[0].contextId) : null;
}

export async function listCreativeContexts(input: {
  limit: number;
  cursor?: string;
  includeArchived?: boolean;
}) {
  await ensureDefaultCreativeContext();
  const { getDb, schema } = getCreativeContext();
  const filters: any[] = [
    accessFilter(schema.creativeContexts, schema.creativeContextShares),
  ];
  if (input.cursor) filters.push(gt(schema.creativeContexts.id, input.cursor));
  if (!input.includeArchived)
    filters.push(isNull(schema.creativeContexts.archivedAt));
  const rows = await getDb()
    .select()
    .from(schema.creativeContexts)
    .where(and(...filters))
    .orderBy(asc(schema.creativeContexts.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit) as any[];
  const counts = page.length
    ? await getDb()
        .select({
          contextId: schema.creativeContextMemberships.contextId,
          id: schema.creativeContextMemberships.id,
        })
        .from(schema.creativeContextMemberships)
        .where(
          and(
            inArray(
              schema.creativeContextMemberships.contextId,
              page.map((row) => row.id),
            ),
            eq(schema.creativeContextMemberships.status, "active"),
          ),
        )
    : [];
  const byContext = new Map<string, number>();
  for (const row of counts as any[])
    byContext.set(row.contextId, (byContext.get(row.contextId) ?? 0) + 1);
  return {
    contexts: page.map((row) => mapContext(row, byContext.get(row.id) ?? 0)),
    nextCursor: rows.length > input.limit ? page.at(-1)?.id : undefined,
  };
}

export async function updateCreativeContext(
  contextId: string,
  patch: {
    name?: string;
    description?: string | null;
    brandProfileId?: string | null;
    approvalPolicy?: CreativeContextApprovalPolicy;
  },
) {
  await assertContextRole(contextId, "editor");
  const { getDb, schema } = getCreativeContext();
  const values = { ...patch, updatedAt: nowIso() };
  await getDb().transaction(async (tx: any) => {
    await tx
      .update(schema.creativeContexts)
      .set(values)
      .where(eq(schema.creativeContexts.id, contextId));
    await appendAudit(tx, contextId, "update", { fields: Object.keys(patch) });
  });
  return getCreativeContextById(contextId);
}

export async function archiveCreativeContext(contextId: string) {
  await assertContextRole(contextId, "admin");
  const { getDb, schema } = getCreativeContext();
  await getDb()
    .update(schema.creativeContexts)
    .set({ archivedAt: nowIso(), updatedAt: nowIso() })
    .where(eq(schema.creativeContexts.id, contextId));
  return getCreativeContextById(contextId);
}

export async function setCreativeContextAppDefault(
  contextId: string,
  appId: string,
) {
  const access = await assertContextRole(contextId, "admin");
  if (access.resource.orgId)
    await assertCurrentRequestUserIsOrgAdmin(access.resource.orgId);
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const timestamp = nowIso();
  await getDb().transaction(async (tx: any) => {
    await tx
      .delete(schema.creativeContextAppBindings)
      .where(
        and(
          eq(schema.creativeContextAppBindings.appId, appId),
          eq(schema.creativeContextAppBindings.ownerEmail, actor.ownerEmail),
        ),
      );
    await tx
      .insert(schema.creativeContextAppBindings)
      .values({
        id: newId("ccab"),
        appId,
        contextId,
        createdAt: timestamp,
        updatedAt: timestamp,
        ownerEmail: actor.ownerEmail,
        orgId: actor.orgId,
      });
    await appendAudit(tx, contextId, "set-app-default", { appId });
  });
  return getCreativeContextById(contextId);
}

export async function listContextMemberships(input: {
  contextId: string;
  status?: "active" | "removed";
  limit: number;
  cursor?: string;
}) {
  const access = await assertContextRole(input.contextId, "viewer");
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const filters: any[] = [
    eq(schema.creativeContextMemberships.contextId, input.contextId),
  ];
  if (input.status)
    filters.push(eq(schema.creativeContextMemberships.status, input.status));
  if (input.cursor)
    filters.push(gt(schema.creativeContextMemberships.id, input.cursor));
  const rows = await getDb()
    .select()
    .from(schema.creativeContextMemberships)
    .where(and(...filters))
    .orderBy(asc(schema.creativeContextMemberships.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit) as any[];
  const showPending =
    access.role === "owner" ||
    access.role === "editor" ||
    access.role === "admin";
  const pendingIds = page
    .map((row) => row.pendingSubmissionId)
    .filter(Boolean) as string[];
  const submissions = pendingIds.length
    ? await getDb()
        .select()
        .from(schema.creativeContextSubmissions)
        .where(inArray(schema.creativeContextSubmissions.id, pendingIds))
    : [];
  const visiblePending = new Map(
    (submissions as any[])
      .filter((row) => showPending || row.submittedBy === actor.ownerEmail)
      .map((row) => [row.id, mapSubmission(row)]),
  );
  const publishedVersionIds = page.flatMap((row) =>
    row.publishedItemVersionId ? [row.publishedItemVersionId] : [],
  );
  const [publishedItems, previewMedia] = publishedVersionIds.length
    ? await Promise.all([
        getDb()
          .select({
            id: schema.contextItems.id,
            itemVersionId: schema.contextItemVersions.id,
            title: schema.contextItemVersions.title,
            kind: schema.contextItems.kind,
            canonicalUrl: schema.contextItems.canonicalUrl,
            status: schema.contextItems.status,
          })
          .from(schema.contextItemVersions)
          .innerJoin(
            schema.contextItems,
            eq(schema.contextItems.id, schema.contextItemVersions.itemId),
          )
          .where(inArray(schema.contextItemVersions.id, publishedVersionIds)),
        getDb()
          .select({
            id: schema.contextMedia.id,
            itemVersionId: schema.contextMedia.itemVersionId,
            kind: schema.contextMedia.kind,
            mimeType: schema.contextMedia.mimeType,
          })
          .from(schema.contextMedia)
          .where(
            inArray(schema.contextMedia.itemVersionId, publishedVersionIds),
          ),
      ])
    : [[], []];
  const mediaByVersion = new Map<
    string,
    Array<{ id: string; kind: any; mimeType: string | null; url: string }>
  >();
  for (const media of previewMedia as any[]) {
    const list = mediaByVersion.get(media.itemVersionId) ?? [];
    list.push({
      id: media.id,
      kind: media.kind,
      mimeType: media.mimeType ?? null,
      url: creativeContextMediaUrl({ mediaId: media.id }),
    });
    mediaByVersion.set(media.itemVersionId, list);
  }
  const previewByVersion = new Map(
    (publishedItems as any[]).map((item) => [
      item.itemVersionId,
      {
        id: item.id,
        itemVersionId: item.itemVersionId,
        title: item.title,
        kind: item.kind,
        canonicalUrl:
          typeof sanitizePublicMetadata(item.canonicalUrl) === "string"
            ? (sanitizePublicMetadata(item.canonicalUrl) as string)
            : null,
        status: item.status,
        media: mediaByVersion.get(item.itemVersionId) ?? [],
      },
    ]),
  );
  return {
    memberships: page.map((row) => ({
      ...mapMembership(row),
      publishedItem: row.publishedItemVersionId
        ? (previewByVersion.get(row.publishedItemVersionId) ?? null)
        : null,
      pendingSubmission: row.pendingSubmissionId
        ? (visiblePending.get(row.pendingSubmissionId) ?? null)
        : null,
    })),
    nextCursor: rows.length > input.limit ? page.at(-1)?.id : undefined,
  };
}

async function resolveSubmissionItem(input: {
  itemId?: string;
  itemVersionId?: string;
  nativeResource?: NativeCreativeResourceRef;
}) {
  if (input.nativeResource) {
    const captured = await captureNativeCreativeResource(input.nativeResource);
    if (!captured.items.length)
      throw new Error("Native capture returned no artifacts");
    return {
      artifactKey: captured.artifactKey,
      items: captured.items,
      privateMetadata: {
        ...(captured.privateMetadata ?? {}),
        nativeResource: input.nativeResource,
      },
    };
  }
  if (!input.itemId) throw new Error("itemId or nativeResource is required");
  const detail = await getCreativeContextItem(
    input.itemId,
    input.itemVersionId,
  );
  if (!detail)
    throw new Error("Context item version not found or not accessible");
  return {
    artifactKey: `${detail.item.sourceId}:${detail.item.externalId}`,
    items: [normalizedFromDetail(detail)],
    privateMetadata: {},
  };
}

async function approveSubmission(
  context: any,
  membership: any,
  submission: any,
) {
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const staged = await readSnapshot(
    submission.stagingItemId,
    submission.stagingItemVersionId,
  );
  const published = await writeSnapshot({
    sourceId: context.publishedSourceId,
    artifactKey: submission.artifactKey,
    item: staged,
    ownerEmail: context.ownerEmail,
    orgId: context.orgId ?? null,
  });
  const privateMetadata = parseJson<Record<string, unknown>>(
    submission.privateMetadata,
    {},
  );
  for (const child of Array.isArray(privateMetadata.stagedChildren)
    ? (privateMetadata.stagedChildren as Array<{
        artifactKey?: string;
        itemId?: string;
        itemVersionId?: string;
      }>)
    : []) {
    if (
      typeof child.artifactKey !== "string" ||
      typeof child.itemId !== "string" ||
      typeof child.itemVersionId !== "string"
    )
      continue;
    await writeSnapshot({
      sourceId: context.publishedSourceId,
      artifactKey: child.artifactKey,
      item: await readSnapshot(child.itemId, child.itemVersionId),
      ownerEmail: context.ownerEmail,
      orgId: context.orgId ?? null,
    });
  }
  const timestamp = nowIso();
  await getDb().transaction(async (tx: any) => {
    await tx
      .update(schema.creativeContextSubmissions)
      .set({
        status: "approved",
        publishedItemId: published.itemId,
        publishedItemVersionId: published.itemVersionId,
        reviewedBy: actor.ownerEmail,
        reviewedAt: timestamp,
      })
      .where(eq(schema.creativeContextSubmissions.id, submission.id));
    await tx
      .update(schema.creativeContextMemberships)
      .set({
        publishedItemId: published.itemId,
        publishedItemVersionId: published.itemVersionId,
        pendingSubmissionId: null,
        status: "active",
        updatedAt: timestamp,
      })
      .where(eq(schema.creativeContextMemberships.id, membership.id));
    await tx
      .insert(schema.creativeContextPublishedSnapshots)
      .values({
        id: newId("ccps"),
        contextId: context.id,
        sourceId: context.publishedSourceId,
        membershipId: membership.id,
        itemId: published.itemId,
        itemVersionId: published.itemVersionId,
        submissionId: submission.id,
        createdAt: timestamp,
        ownerEmail: context.ownerEmail,
        orgId: context.orgId ?? null,
      });
    await appendAudit(tx, context.id, "approve-submission", {
      submissionId: submission.id,
      membershipId: membership.id,
    });
  });
}

export async function manageContextMembership(input: {
  operation: "submit" | "approve" | "request-changes" | "withdraw" | "remove";
  contextId: string;
  membershipId?: string;
  itemId?: string;
  itemVersionId?: string;
  nativeResource?: NativeCreativeResourceRef;
  note?: string;
  rank?: Rank;
  purpose?: string;
  confirmBroaderPublication?: boolean;
}) {
  const { getDb, schema } = getCreativeContext();
  const access = await assertContextRole(
    input.contextId,
    input.operation === "submit" ? "editor" : "viewer",
  );
  const context = access.resource as any;
  const actor = requireActor();
  if (input.operation === "submit") {
    if (context.visibility !== "private" && !input.confirmBroaderPublication)
      throw new Error(
        "Confirm broader publication before submitting an artifact to a shared Creative Context",
      );
    const captured = await resolveSubmissionItem(input);
    const root = captured.items[0];
    if (!root) throw new Error("Submission did not include a root artifact");
    const timestamp = nowIso();
    let membership = (
      await getDb()
        .select()
        .from(schema.creativeContextMemberships)
        .where(
          and(
            eq(schema.creativeContextMemberships.contextId, input.contextId),
            eq(
              schema.creativeContextMemberships.artifactKey,
              captured.artifactKey,
            ),
          ),
        )
        .limit(1)
    )[0] as any;
    const membershipId = membership?.id ?? newId("ccmbr");
    const staged = await writeSnapshot({
      sourceId: context.stagingSourceId,
      artifactKey: captured.artifactKey,
      item: root,
      ownerEmail: context.ownerEmail,
      orgId: context.orgId ?? null,
    });
    const stagedChildren = await Promise.all(
      captured.items.slice(1).map(async (item) => {
        const snapshot = await writeSnapshot({
          sourceId: context.stagingSourceId,
          artifactKey: `${captured.artifactKey}:${item.externalId}`,
          item,
          ownerEmail: context.ownerEmail,
          orgId: context.orgId ?? null,
        });
        return {
          artifactKey: `${captured.artifactKey}:${item.externalId}`,
          ...snapshot,
        };
      }),
    );
    const submissionId = newId("ccsub");
    const autoApprove =
      context.approvalPolicy === "open" ||
      (context.approvalPolicy === "admins-only" &&
        (await currentRequestUserIsOrgAdmin(context.orgId ?? undefined)));
    await getDb().transaction(async (tx: any) => {
      if (membership?.pendingSubmissionId)
        await tx
          .update(schema.creativeContextSubmissions)
          .set({
            status: "superseded",
            reviewedBy: actor.ownerEmail,
            reviewedAt: timestamp,
          })
          .where(
            eq(
              schema.creativeContextSubmissions.id,
              membership.pendingSubmissionId,
            ),
          );
      if (!membership)
        await tx
          .insert(schema.creativeContextMemberships)
          .values({
            id: membershipId,
            contextId: input.contextId,
            artifactKey: captured.artifactKey,
            publishedItemId: null,
            publishedItemVersionId: null,
            pendingSubmissionId: submissionId,
            rank: input.rank ?? "normal",
            purpose: input.purpose ?? null,
            status: "active",
            createdAt: timestamp,
            updatedAt: timestamp,
            ownerEmail: context.ownerEmail,
            orgId: context.orgId ?? null,
          });
      else
        await tx
          .update(schema.creativeContextMemberships)
          .set({
            pendingSubmissionId: submissionId,
            rank: input.rank ?? membership.rank,
            purpose: input.purpose ?? membership.purpose,
            status: "active",
            updatedAt: timestamp,
          })
          .where(eq(schema.creativeContextMemberships.id, membershipId));
      await tx
        .insert(schema.creativeContextSubmissions)
        .values({
          id: submissionId,
          contextId: input.contextId,
          membershipId,
          artifactKey: captured.artifactKey,
          stagingItemId: staged.itemId,
          stagingItemVersionId: staged.itemVersionId,
          publishedItemId: null,
          publishedItemVersionId: null,
          note: input.note ?? null,
          privateMetadata: stringifyJson({
            ...captured.privateMetadata,
            stagedChildren,
          }),
          status: "pending",
          submittedBy: actor.ownerEmail,
          reviewedBy: null,
          reviewNote: null,
          createdAt: timestamp,
          reviewedAt: null,
          ownerEmail: context.ownerEmail,
          orgId: context.orgId ?? null,
        });
      await appendAudit(tx, input.contextId, "submit", {
        membershipId,
        submissionId,
        childCount: stagedChildren.length,
      });
    });
    membership = { id: membershipId };
    const submission = (
      await getDb()
        .select()
        .from(schema.creativeContextSubmissions)
        .where(eq(schema.creativeContextSubmissions.id, submissionId))
        .limit(1)
    )[0];
    if (autoApprove) await approveSubmission(context, membership, submission);
    return {
      membershipId,
      submission: mapSubmission(
        (
          await getDb()
            .select()
            .from(schema.creativeContextSubmissions)
            .where(eq(schema.creativeContextSubmissions.id, submissionId))
            .limit(1)
        )[0],
      ),
    };
  }
  if (!input.membershipId) throw new Error("membershipId is required");
  const membership = (
    await getDb()
      .select()
      .from(schema.creativeContextMemberships)
      .where(
        and(
          eq(schema.creativeContextMemberships.id, input.membershipId),
          eq(schema.creativeContextMemberships.contextId, input.contextId),
        ),
      )
      .limit(1)
  )[0] as any;
  if (!membership) throw new Error("Context membership not found");
  if (input.operation === "remove") {
    await requireReviewer(input.contextId, context.approvalPolicy);
    await getDb()
      .update(schema.creativeContextMemberships)
      .set({
        status: "removed",
        pendingSubmissionId: null,
        updatedAt: nowIso(),
      })
      .where(eq(schema.creativeContextMemberships.id, membership.id));
    return {
      membership: mapMembership({
        ...membership,
        status: "removed",
        pendingSubmissionId: null,
      }),
    };
  }
  const submission = membership.pendingSubmissionId
    ? ((
        await getDb()
          .select()
          .from(schema.creativeContextSubmissions)
          .where(
            eq(
              schema.creativeContextSubmissions.id,
              membership.pendingSubmissionId,
            ),
          )
          .limit(1)
      )[0] as any)
    : null;
  if (!submission) throw new Error("No pending submission for this membership");
  if (input.operation === "withdraw") {
    if (submission.submittedBy !== actor.ownerEmail)
      await requireReviewer(input.contextId, context.approvalPolicy);
    await getDb().transaction(async (tx: any) => {
      await tx
        .update(schema.creativeContextSubmissions)
        .set({
          status: "withdrawn",
          reviewedBy: actor.ownerEmail,
          reviewedAt: nowIso(),
        })
        .where(eq(schema.creativeContextSubmissions.id, submission.id));
      await tx
        .update(schema.creativeContextMemberships)
        .set({ pendingSubmissionId: null, updatedAt: nowIso() })
        .where(eq(schema.creativeContextMemberships.id, membership.id));
    });
    return { withdrawn: true };
  }
  await requireReviewer(input.contextId, context.approvalPolicy);
  if (input.operation === "request-changes") {
    await getDb().transaction(async (tx: any) => {
      await tx
        .update(schema.creativeContextSubmissions)
        .set({
          status: "rejected",
          reviewedBy: actor.ownerEmail,
          reviewNote: input.note ?? "Changes requested",
          reviewedAt: nowIso(),
        })
        .where(eq(schema.creativeContextSubmissions.id, submission.id));
      await tx
        .update(schema.creativeContextMemberships)
        .set({ pendingSubmissionId: null, updatedAt: nowIso() })
        .where(eq(schema.creativeContextMemberships.id, membership.id));
      await appendAudit(tx, input.contextId, "request-changes", {
        submissionId: submission.id,
      });
    });
    return { requestChanges: true };
  }
  await approveSubmission(context, membership, submission);
  return { approved: true };
}

export async function resolveNativeContextCloneReference(
  input: NativeCreativeResourceRef & { contextId: string; artifactKey: string },
) {
  await assertContextRole(input.contextId, "viewer");
  const { getDb, schema } = getCreativeContext();
  const [membership] = await getDb()
    .select()
    .from(schema.creativeContextMemberships)
    .where(
      and(
        eq(schema.creativeContextMemberships.contextId, input.contextId),
        eq(schema.creativeContextMemberships.artifactKey, input.artifactKey),
        eq(schema.creativeContextMemberships.status, "active"),
      ),
    )
    .limit(1);
  if (!membership?.publishedItemId || !membership?.publishedItemVersionId)
    throw new Error("Creative context artifact is not published");
  const [submission] = await getDb()
    .select()
    .from(schema.creativeContextSubmissions)
    .where(
      and(
        eq(schema.creativeContextSubmissions.membershipId, membership.id),
        eq(schema.creativeContextSubmissions.status, "approved"),
        eq(
          schema.creativeContextSubmissions.publishedItemVersionId,
          membership.publishedItemVersionId,
        ),
      ),
    )
    .limit(1);
  const metadata = parseJson<Record<string, unknown>>(
    submission?.privateMetadata,
    {},
  );
  const clone = metadata.clone as
    | {
        handle?: unknown;
        appId?: unknown;
        resourceType?: unknown;
        resourceId?: unknown;
        updatedAt?: unknown;
      }
    | undefined;
  if (
    !clone ||
    !clone.handle ||
    clone.appId !== input.appId ||
    clone.resourceType !== input.resourceType ||
    clone.resourceId !== input.resourceId ||
    (input.expectedUpdatedAt !== undefined &&
      clone.updatedAt !== input.expectedUpdatedAt)
  )
    throw new Error(
      "Native creative resource reference does not match the governed context submission",
    );
  return {
    publishedItemId: membership.publishedItemId,
    publishedItemVersionId: membership.publishedItemVersionId,
    cloneHandle: clone.handle,
  };
}
