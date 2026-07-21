import { currentRequestUserIsOrgAdmin } from "@agent-native/core/server";
import {
  accessFilter,
  assertAccess,
  resolveAccess,
} from "@agent-native/core/sharing";
import type { WorkspaceConnectionLifecycleEvent } from "@agent-native/core/workspace-connections";
import { and, asc, eq, gt, inArray, isNull, lt, ne, or } from "drizzle-orm";

import { getCreativeContext } from "../server/context.js";
import type {
  ContextSource,
  ContextSourceStatus,
  ContextSourceHealth,
  ContextSourceSummary,
  ContextSourcePromotionPreview,
  UpstreamAccess,
} from "../types.js";
import {
  newId,
  nowIso,
  parseJson,
  requireActor,
  sha256,
  stringifyJson,
} from "./helpers.js";
import { createJob } from "./jobs.js";

function mapSource(row: any): ContextSource {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    externalRef: row.externalRef ?? null,
    connectionId: row.connectionId ?? null,
    containerOwnerVerifiedAt: row.containerOwnerVerifiedAt ?? null,
    config: parseJson(row.config, {}),
    upstreamAccess: row.upstreamAccess,
    status: row.status,
    healthStatus: row.healthStatus,
    syncCursor: row.syncCursor ?? null,
    itemCount: row.itemCount,
    restrictedItemCount: row.restrictedItemCount,
    lastSyncedAt: row.lastSyncedAt ?? null,
    lastError: row.lastError ?? null,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId ?? null,
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function assertSafeSourceConfig(config: Record<string, unknown>): void {
  const pending: unknown[] = [config];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    for (const [key, child] of Object.entries(value)) {
      if (
        /(?:secret|token|password|api[-_]?key|credential|authorization)/i.test(
          key,
        )
      ) {
        throw new Error(
          "Context source config may contain public settings only; store credentials in a connection and reference connectionId",
        );
      }
      pending.push(child);
    }
  }
}

async function appendSourceAudit(
  tx: any,
  sourceId: string,
  operation: string,
  details: Record<string, unknown>,
): Promise<void> {
  const { schema } = getCreativeContext();
  const actor = requireActor();
  await tx.insert(schema.contextSourceAudit).values({
    id: newId("ccsa"),
    sourceId,
    operation,
    actorEmail: actor.ownerEmail,
    details: stringifyJson(details),
    ownerEmail: actor.ownerEmail,
    orgId: actor.orgId,
    createdAt: nowIso(),
  });
}

export function toSourceSummary(source: ContextSource): ContextSourceSummary {
  const {
    id,
    name,
    kind,
    externalRef,
    connectionId,
    containerOwnerVerifiedAt,
    upstreamAccess,
    status,
    healthStatus,
    itemCount,
    restrictedItemCount,
    lastSyncedAt,
    lastError,
    visibility,
    createdAt,
    updatedAt,
  } = source;
  return {
    id,
    name,
    kind,
    externalRef,
    connectionId,
    containerOwnerVerifiedAt,
    upstreamAccess,
    status,
    healthStatus,
    itemCount,
    restrictedItemCount,
    lastSyncedAt,
    lastError,
    visibility,
    createdAt,
    updatedAt,
  };
}

export function initialContextSourceHealth(
  kind: string,
  connectionId?: string,
): ContextSourceHealth {
  if (kind === "manual" || kind === "upload") return "healthy";
  if (kind === "website") return "stale";
  return connectionId ? "stale" : "needs_setup";
}

export async function listContextSources(input: {
  status?: ContextSourceStatus;
  healthStatus?: ContextSourceHealth;
  kind?: string;
  limit: number;
  cursor?: string;
}): Promise<{ sources: ContextSourceSummary[]; nextCursor?: string }> {
  const { getDb, schema } = getCreativeContext();
  const filters: any[] = [
    accessFilter(schema.contextSources, schema.contextSourceShares),
  ];
  if (input.status)
    filters.push(eq(schema.contextSources.status, input.status));
  if (input.healthStatus) {
    filters.push(eq(schema.contextSources.healthStatus, input.healthStatus));
  }
  if (input.kind) filters.push(eq(schema.contextSources.kind, input.kind));
  if (input.cursor) filters.push(gt(schema.contextSources.id, input.cursor));

  const rows = await getDb()
    .select({
      id: schema.contextSources.id,
      name: schema.contextSources.name,
      kind: schema.contextSources.kind,
      externalRef: schema.contextSources.externalRef,
      connectionId: schema.contextSources.connectionId,
      containerOwnerVerifiedAt: schema.contextSources.containerOwnerVerifiedAt,
      upstreamAccess: schema.contextSources.upstreamAccess,
      status: schema.contextSources.status,
      healthStatus: schema.contextSources.healthStatus,
      itemCount: schema.contextSources.itemCount,
      restrictedItemCount: schema.contextSources.restrictedItemCount,
      lastSyncedAt: schema.contextSources.lastSyncedAt,
      lastError: schema.contextSources.lastError,
      visibility: schema.contextSources.visibility,
      createdAt: schema.contextSources.createdAt,
      updatedAt: schema.contextSources.updatedAt,
    })
    .from(schema.contextSources)
    .where(and(...filters))
    .orderBy(asc(schema.contextSources.id))
    .limit(input.limit + 1);
  const hasMore = rows.length > input.limit;
  const page = rows.slice(0, input.limit) as ContextSourceSummary[];
  return {
    sources: page,
    nextCursor: hasMore ? page.at(-1)?.id : undefined,
  };
}

export async function getContextSource(
  sourceId: string,
): Promise<ContextSource | null> {
  const access = await resolveAccess("creative-context-source", sourceId);
  return access ? mapSource(access.resource) : null;
}

export async function handleWorkspaceConnectionLifecycle(
  event: WorkspaceConnectionLifecycleEvent,
): Promise<{ sources: number; jobs: number }> {
  const { getDb, schema } = getCreativeContext();
  const sources = await getDb()
    .select({ id: schema.contextSources.id })
    .from(schema.contextSources)
    .where(
      and(
        accessFilter(schema.contextSources, schema.contextSourceShares),
        eq(schema.contextSources.connectionId, event.connectionId),
        ne(schema.contextSources.status, "archived"),
      ),
    );
  const sourceIds = sources.map((row: any) => row.id as string);
  if (!sourceIds.length) return { sources: 0, jobs: 0 };
  const timestamp = nowIso();
  await getDb().transaction(async (tx: any) => {
    await tx
      .update(schema.contextSources)
      .set({
        status: "paused",
        healthStatus: "needs_setup",
        lastError: "Workspace connection access was removed.",
        updatedAt: timestamp,
      })
      .where(inArray(schema.contextSources.id, sourceIds));
    await tx
      .update(schema.contextItems)
      .set({
        status: "unavailable",
        inventoryState: "removed",
        updatedAt: timestamp,
      })
      .where(inArray(schema.contextItems.sourceId, sourceIds));
  });
  for (const sourceId of sourceIds) {
    await createJob({
      sourceId,
      kind: "purge",
      request: {
        reason: event.type,
        connectionId: event.connectionId,
        ...(event.type === "grant-revoked" ? { appId: event.appId } : {}),
      },
    });
  }
  return { sources: sourceIds.length, jobs: sourceIds.length };
}

export async function listContextSourcesDueForMaintenance(input: {
  before: string;
  limit?: number;
}): Promise<
  Array<{ sourceId: string; ownerEmail: string; orgId: string | null }>
> {
  const { getDb, schema } = getCreativeContext();
  // guard:allow-unscoped — the daily system scheduler returns only owner
  // dispatch coordinates, then re-enters that owner's request context.
  const rows = await getDb()
    .select({
      sourceId: schema.contextSources.id,
      ownerEmail: schema.contextSources.ownerEmail,
      orgId: schema.contextSources.orgId,
    })
    .from(schema.contextSources)
    .where(
      and(
        eq(schema.contextSources.status, "active"),
        inArray(schema.contextSources.kind, [
          "website",
          "figma",
          "notion",
          "google-slides",
        ]),
        or(
          isNull(schema.contextSources.lastSyncedAt),
          lt(schema.contextSources.lastSyncedAt, input.before),
        ),
      ),
    )
    .orderBy(asc(schema.contextSources.lastSyncedAt))
    .limit(Math.max(1, Math.min(input.limit ?? 100, 500)));
  if (!rows.length) return [];
  const activeJobs = await getDb()
    .select({ sourceId: schema.contextJobs.sourceId })
    .from(schema.contextJobs)
    .where(
      and(
        inArray(
          schema.contextJobs.sourceId,
          rows.map((row: any) => row.sourceId),
        ),
        eq(schema.contextJobs.kind, "import"),
        inArray(schema.contextJobs.status, ["queued", "running", "paused"]),
      ),
    );
  const busy = new Set(activeJobs.map((row: any) => row.sourceId));
  return rows
    .filter((row: any) => !busy.has(row.sourceId))
    .map((row: any) => ({
      sourceId: row.sourceId,
      ownerEmail: row.ownerEmail,
      orgId: row.orgId ?? null,
    }));
}

export async function createContextSource(input: {
  name: string;
  kind: string;
  externalRef?: string;
  connectionId?: string;
  config?: Record<string, unknown>;
  upstreamAccess?: UpstreamAccess;
}): Promise<ContextSource> {
  const { getDb, schema, connectors } = getCreativeContext();
  connectors.get(input.kind);
  const actor = requireActor();
  const timestamp = nowIso();
  const id = newId("ccs");
  assertSafeSourceConfig(input.config ?? {});
  await getDb().transaction(async (tx: any) => {
    await tx.insert(schema.contextSources).values({
      id,
      name: input.name,
      kind: input.kind,
      externalRef: input.externalRef ?? null,
      connectionId: input.connectionId ?? null,
      containerOwnerVerifiedAt:
        input.kind === "manual" || input.kind === "upload" ? timestamp : null,
      config: stringifyJson(input.config),
      upstreamAccess: input.upstreamAccess ?? "unknown",
      status: "active",
      healthStatus: initialContextSourceHealth(input.kind, input.connectionId),
      syncCursor: null,
      itemCount: 0,
      restrictedItemCount: 0,
      lastSyncedAt: null,
      lastError: null,
      ownerEmail: actor.ownerEmail,
      orgId: actor.orgId,
      visibility: "private",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await appendSourceAudit(tx, id, "create", {
      kind: input.kind,
      connectionId: input.connectionId ?? null,
    });
  });
  const created = await getContextSource(id);
  if (!created) throw new Error("Failed to create context source");
  return created;
}

export async function updateContextSource(
  sourceId: string,
  patch: {
    name?: string;
    externalRef?: string | null;
    connectionId?: string | null;
    config?: Record<string, unknown>;
    upstreamAccess?: UpstreamAccess;
    status?: ContextSourceStatus;
    healthStatus?: ContextSourceHealth;
    syncCursor?: string | null;
    itemCount?: number;
    lastSyncedAt?: string | null;
    lastError?: string | null;
  },
): Promise<ContextSource> {
  await assertAccess("creative-context-source", sourceId, "editor", undefined, {
    skipResourceBody: true,
  });
  const { getDb, schema } = getCreativeContext();
  const values: Record<string, unknown> = { updatedAt: nowIso() };
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.externalRef !== undefined) values.externalRef = patch.externalRef;
  if (patch.connectionId !== undefined)
    values.connectionId = patch.connectionId;
  if (patch.config !== undefined) {
    assertSafeSourceConfig(patch.config);
    values.config = stringifyJson(patch.config);
  }
  if (patch.upstreamAccess !== undefined)
    values.upstreamAccess = patch.upstreamAccess;
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.healthStatus !== undefined)
    values.healthStatus = patch.healthStatus;
  if (patch.status === "paused") values.healthStatus = "paused";
  if (patch.status === "active" && patch.healthStatus === undefined) {
    values.healthStatus = patch.lastError ? "error" : "stale";
  }
  if (patch.connectionId === null) values.healthStatus = "needs_setup";
  if (patch.syncCursor !== undefined) values.syncCursor = patch.syncCursor;
  if (patch.itemCount !== undefined) values.itemCount = patch.itemCount;
  if (patch.lastSyncedAt !== undefined)
    values.lastSyncedAt = patch.lastSyncedAt;
  if (patch.lastError !== undefined) values.lastError = patch.lastError;
  await getDb().transaction(async (tx: any) => {
    await tx
      .update(schema.contextSources)
      .set(values)
      .where(eq(schema.contextSources.id, sourceId));
    await appendSourceAudit(tx, sourceId, "update", {
      fields: Object.keys(patch),
    });
  });
  const source = await getContextSource(sourceId);
  if (!source) throw new Error("Context source not found after update");
  return source;
}

export async function archiveContextSource(
  sourceId: string,
): Promise<ContextSource> {
  return updateContextSource(sourceId, {
    status: "archived",
    healthStatus: "paused",
  });
}

export async function restoreContextSource(
  sourceId: string,
): Promise<ContextSource> {
  return updateContextSource(sourceId, {
    status: "active",
    healthStatus: "stale",
    lastError: null,
  });
}

export async function promoteContextSource(
  sourceId: string,
  confirmation: {
    containerRef: string;
    boundaryHash: string;
    itemCount: number;
  },
): Promise<ContextSource> {
  const preview = await previewContextSourcePromotion(sourceId);
  assertContextSourcePromotionConfirmation(preview, confirmation);
  const { getDb, schema } = getCreativeContext();
  await getDb().transaction(async (tx: any) => {
    await tx
      .update(schema.contextSources)
      .set({
        orgId: preview.targetOrgId,
        visibility: "org",
        updatedAt: nowIso(),
      })
      .where(eq(schema.contextSources.id, sourceId));
    await appendSourceAudit(tx, sourceId, "promote-to-org", { ...preview });
  });
  const source = await getContextSource(sourceId);
  if (!source) throw new Error("Context source not found after promotion");
  return source;
}

export function assertContextSourcePromotionConfirmation(
  preview: Pick<
    ContextSourcePromotionPreview,
    "containerRef" | "boundaryHash" | "itemCount"
  >,
  confirmation: {
    containerRef: string;
    boundaryHash: string;
    itemCount: number;
  },
): void {
  if (
    preview.containerRef !== confirmation.containerRef ||
    preview.boundaryHash !== confirmation.boundaryHash ||
    preview.itemCount !== confirmation.itemCount
  ) {
    throw new Error(
      "Source changed after promotion preview; review the container and item count again",
    );
  }
}

const BOUNDARY_KEYS_BY_KIND: Record<string, readonly string[]> = {
  "google-slides": [
    "presentationIds",
    "folderId",
    "folderUrl",
    "sharedDriveId",
    "sharedDriveUrl",
  ],
  figma: [
    "fileKeys",
    "fileUrls",
    "files",
    "projectIds",
    "projectUrls",
    "teamIds",
    "teamUrls",
  ],
  notion: [
    "rootPageIds",
    "rootPageUrls",
    "teamspaceRootPageIds",
    "teamspaceRootPageUrls",
    "roots",
  ],
  website: ["urls", "pages", "domains", "baseUrls", "sitemapUrls"],
  upload: ["fileUrls"],
};

function safeBoundaryValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const canonical = value
      .slice(0, 100)
      .map(safeBoundaryValue)
      .filter((entry) => entry !== undefined);
    return [
      ...new Map(
        canonical.map((entry) => [stringifyJson(entry), entry]),
      ).values(),
    ].sort((left, right) =>
      stringifyJson(left).localeCompare(stringifyJson(right)),
    );
  }
  if (value && typeof value === "object") {
    const selected: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (/(?:secret|token|password|api[-_]?key|authorization)/i.test(key)) {
        continue;
      }
      const child = safeBoundaryValue((value as Record<string, unknown>)[key]);
      if (child !== undefined) selected[key] = child;
    }
    return Object.keys(selected).length ? selected : undefined;
  }
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, 300);
  if (!trimmed || /(?:token|secret|password|authorization)=/i.test(trimmed)) {
    return undefined;
  }
  try {
    const url = new URL(trimmed);
    return `${url.origin}${url.pathname}`.slice(0, 300);
  } catch {
    return /^[\p{L}\p{N}._:/ -]+$/u.test(trimmed) ? trimmed : undefined;
  }
}

export async function contextSourceBoundary(input: {
  kind: string;
  externalRef: string | null;
  config: Record<string, unknown>;
}): Promise<{
  summary: string;
  hash: string;
  selected: Record<string, unknown>;
}> {
  const selected: Record<string, unknown> = {};
  for (const key of BOUNDARY_KEYS_BY_KIND[input.kind] ?? []) {
    const value = safeBoundaryValue(input.config[key]);
    if (value !== undefined && (!Array.isArray(value) || value.length)) {
      selected[key] = value;
    }
  }
  const externalRef = safeBoundaryValue(input.externalRef);
  const canonical = { kind: input.kind, externalRef, selected };
  const entries = Object.entries(selected).map(
    ([key, value]) =>
      `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`,
  );
  const summary =
    (typeof externalRef === "string" ? externalRef : null) ??
    entries.join("; ") ??
    `${input.kind} source`;
  return {
    summary: summary || `${input.kind} source`,
    hash: await sha256(stringifyJson(canonical)),
    selected,
  };
}

export async function previewContextSourcePromotion(
  sourceId: string,
): Promise<ContextSourcePromotionPreview> {
  const access = await assertAccess(
    "creative-context-source",
    sourceId,
    "admin",
  );
  const actor = requireActor();
  if (!actor.orgId) {
    throw new Error("Select an organization before promoting a context source");
  }
  const orgAdmin = await currentRequestUserIsOrgAdmin(actor.orgId);
  const verifiedOwner =
    access.role === "owner" &&
    Boolean(access.resource.containerOwnerVerifiedAt);
  if (!orgAdmin && !verifiedOwner) {
    throw new Error(
      "Source promotion requires an organization admin or verified container owner",
    );
  }
  const source = mapSource(access.resource);
  const boundary = await contextSourceBoundary(source);
  return {
    sourceId,
    containerRef: boundary.summary,
    boundaryHash: boundary.hash,
    itemCount: source.itemCount,
    restrictedItemCount: source.restrictedItemCount,
    targetOrgId: actor.orgId,
    callerAuthority: orgAdmin ? "org-admin" : "verified-container-owner",
  };
}

export async function markSourceContainerOwnerVerified(
  sourceId: string,
): Promise<void> {
  await assertAccess("creative-context-source", sourceId, "owner", undefined, {
    skipResourceBody: true,
  });
  const { getDb, schema } = getCreativeContext();
  await getDb()
    .update(schema.contextSources)
    .set({ containerOwnerVerifiedAt: nowIso(), updatedAt: nowIso() })
    .where(eq(schema.contextSources.id, sourceId));
}

export async function deleteContextSource(
  sourceId: string,
): Promise<{ source: ContextSource; purgeJobId: string }> {
  await assertAccess("creative-context-source", sourceId, "admin", undefined, {
    skipResourceBody: true,
  });
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const timestamp = nowIso();
  const purgeJobId = newId("ccj");
  await getDb().transaction(async (tx: any) => {
    await tx
      .update(schema.contextSources)
      .set({
        status: "archived",
        upstreamAccess: "restricted",
        connectionId: null,
        syncCursor: null,
        updatedAt: timestamp,
      })
      .where(eq(schema.contextSources.id, sourceId));
    await tx
      .update(schema.contextItems)
      .set({
        status: "deleted",
        curationStatus: "excluded",
        indexState: "stale",
        updatedAt: timestamp,
      })
      .where(eq(schema.contextItems.sourceId, sourceId));
    await appendSourceAudit(tx, sourceId, "delete-requested", {
      purgeJobId,
    });
    await tx
      .delete(schema.contextSourceShares)
      .where(eq(schema.contextSourceShares.resourceId, sourceId));
    await tx.insert(schema.contextJobs).values({
      id: purgeJobId,
      sourceId,
      kind: "purge",
      status: "queued",
      mode: null,
      progressCurrent: 0,
      progressTotal: null,
      attempts: 0,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      checkpoint: null,
      request: stringifyJson({ sourceId }),
      result: null,
      error: null,
      createdAt: timestamp,
      startedAt: null,
      completedAt: null,
      ownerEmail: actor.ownerEmail,
      orgId: actor.orgId,
    });
  });
  const source = await getContextSource(sourceId);
  if (!source) throw new Error("Context source tombstone not found");
  return { source, purgeJobId };
}
