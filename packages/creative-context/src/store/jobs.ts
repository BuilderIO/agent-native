import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import { getCreativeContext } from "../server/context.js";
import type {
  ContextImportMode,
  ContextJob,
  ContextJobKind,
  ContextJobStatus,
} from "../types.js";
import {
  newId,
  nowIso,
  parseJson,
  requireActor,
  stringifyJson,
} from "./helpers.js";

function mapJob(row: any): ContextJob {
  return {
    id: row.id,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId ?? null,
    sourceId: row.sourceId ?? null,
    kind: row.kind,
    status: row.status,
    mode: row.mode ?? null,
    progressCurrent: row.progressCurrent,
    progressTotal: row.progressTotal ?? null,
    attempts: row.attempts,
    leaseOwner: row.leaseOwner ?? null,
    leaseToken: row.leaseToken ?? null,
    leaseExpiresAt: row.leaseExpiresAt ?? null,
    nextResumeAt: row.nextResumeAt ?? null,
    budget: parseJson(row.budget, null),
    checkpoint: parseJson(row.checkpoint, null),
    request: parseJson(row.request, {}),
    result: parseJson(row.result, null),
    error: row.error ?? null,
    createdAt: row.createdAt,
    startedAt: row.startedAt ?? null,
    completedAt: row.completedAt ?? null,
  };
}

export async function createJob(input: {
  sourceId?: string;
  kind: ContextJobKind;
  mode?: ContextImportMode;
  request?: Record<string, unknown>;
  progressTotal?: number;
  budget?: Record<string, unknown>;
  dedupeKey?: string;
}): Promise<ContextJob> {
  if (input.sourceId) {
    await assertAccess(
      "creative-context-source",
      input.sourceId,
      "editor",
      undefined,
      { skipResourceBody: true },
    );
  }
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const id = newId("ccj");
  const row = {
    id,
    dedupeKey: input.dedupeKey ?? null,
    sourceId: input.sourceId ?? null,
    kind: input.kind,
    status: "queued",
    mode: input.mode ?? null,
    progressCurrent: 0,
    progressTotal: input.progressTotal ?? null,
    attempts: 0,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    nextResumeAt: null,
    budget: input.budget ? stringifyJson(input.budget) : null,
    checkpoint: null,
    request: stringifyJson(input.request),
    result: null,
    error: null,
    ownerEmail: actor.ownerEmail,
    orgId: actor.orgId,
    createdAt: nowIso(),
    startedAt: null,
    completedAt: null,
  };
  if (input.dedupeKey) {
    await getDb()
      .insert(schema.contextJobs)
      .values(row)
      .onConflictDoNothing({ target: schema.contextJobs.dedupeKey });
    const existing = await getDb()
      .select()
      .from(schema.contextJobs)
      .where(
        and(
          eq(schema.contextJobs.dedupeKey, input.dedupeKey),
          eq(schema.contextJobs.ownerEmail, actor.ownerEmail),
        ),
      )
      .limit(1);
    if (existing[0]) return mapJob(existing[0]);
  } else {
    await getDb().insert(schema.contextJobs).values(row);
  }
  const created = await getJob(id);
  if (!created) throw new Error("Failed to create creative context job");
  return created;
}

export async function createDailyMaintenanceJob(input: {
  sourceId: string;
  scheduledAt: string;
}): Promise<{ job: ContextJob; created: boolean }> {
  await assertAccess(
    "creative-context-source",
    input.sourceId,
    "editor",
    undefined,
    { skipResourceBody: true },
  );
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const day = input.scheduledAt.slice(0, 10);
  const dedupeKey = `daily-maintenance:${input.sourceId}:${day}`;
  const id = newId("ccj");
  const inserted = await getDb()
    .insert(schema.contextJobs)
    .values({
      id,
      dedupeKey,
      sourceId: input.sourceId,
      kind: "import",
      status: "queued",
      mode: "incremental",
      progressCurrent: 0,
      progressTotal: null,
      attempts: 0,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      nextResumeAt: null,
      budget: stringifyJson({
        maxRuntimeMs: 45_000,
        remainingMode: "durable-continuation",
      }),
      checkpoint: null,
      request: stringifyJson({
        mode: "metadata-refresh",
        reconcile: true,
        infer: false,
        scheduledAt: input.scheduledAt,
      }),
      result: null,
      error: null,
      ownerEmail: actor.ownerEmail,
      orgId: actor.orgId,
      createdAt: nowIso(),
      startedAt: null,
      completedAt: null,
    })
    .onConflictDoNothing({ target: schema.contextJobs.dedupeKey })
    .returning({ id: schema.contextJobs.id });
  const rows = await getDb()
    .select()
    .from(schema.contextJobs)
    .where(
      and(
        eq(schema.contextJobs.dedupeKey, dedupeKey),
        eq(schema.contextJobs.ownerEmail, actor.ownerEmail),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("Failed to create scheduled maintenance job");
  return { job: mapJob(row), created: inserted.length === 1 };
}

export async function enqueueContextRebuildJob(input: {
  sourceId: string;
  operation: "rebuild-fts" | "rebuild-embeddings";
  itemIds: string[];
}): Promise<ContextJob> {
  await assertAccess(
    "creative-context-source",
    input.sourceId,
    "editor",
    undefined,
    { skipResourceBody: true },
  );
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const candidates = await getDb()
    .select()
    .from(schema.contextJobs)
    .where(
      and(
        eq(schema.contextJobs.ownerEmail, actor.ownerEmail),
        eq(schema.contextJobs.sourceId, input.sourceId),
        eq(schema.contextJobs.kind, "embed"),
        inArray(schema.contextJobs.status, ["queued", "paused"]),
        isNull(schema.contextJobs.leaseToken),
      ),
    )
    .limit(20);
  const existing = candidates.find(
    (row: any) =>
      parseJson<Record<string, unknown>>(row.request, {}).operation ===
      input.operation,
  );
  if (!existing) {
    return createJob({
      sourceId: input.sourceId,
      kind: "embed",
      request: {
        operation: input.operation,
        itemIds: [...new Set(input.itemIds)],
      },
      progressTotal: input.itemIds.length,
      budget: {
        eagerLimit: 250,
        remainingMode: "durable-continuation",
      },
    });
  }
  const request = parseJson<Record<string, unknown>>(existing.request, {});
  const prior = Array.isArray(request.itemIds)
    ? request.itemIds.filter((item): item is string => typeof item === "string")
    : [];
  const itemIds = [...new Set([...prior, ...input.itemIds])];
  await getDb()
    .update(schema.contextJobs)
    .set({
      request: stringifyJson({ ...request, itemIds }),
      progressTotal: itemIds.length,
      nextResumeAt: null,
    })
    .where(eq(schema.contextJobs.id, existing.id));
  const merged = await getJob(existing.id);
  if (!merged) throw new Error("Rebuild job was not accessible after merge.");
  return merged;
}

export async function getJob(jobId: string): Promise<ContextJob | null> {
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const rows = await getDb()
    .select()
    .from(schema.contextJobs)
    .where(
      and(
        eq(schema.contextJobs.id, jobId),
        eq(schema.contextJobs.ownerEmail, actor.ownerEmail),
      ),
    )
    .limit(1);
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function listDueContextImportJobDispatches(input: {
  appId: string;
  now?: string;
  limit?: number;
}): Promise<
  Array<{
    jobId: string;
    ownerEmail: string;
    orgId: string | null;
    appId: string;
    resumeAt: string | null;
  }>
> {
  const { getDb, schema } = getCreativeContext();
  const timestamp = input.now ?? nowIso();
  // guard:allow-unscoped — the system worker only reads dispatch coordinates,
  // then re-enters each job owner's request context before accessing content.
  const rows = await getDb()
    .select({
      jobId: schema.contextJobs.id,
      ownerEmail: schema.contextJobs.ownerEmail,
      orgId: schema.contextJobs.orgId,
      resumeAt: schema.contextJobs.nextResumeAt,
    })
    .from(schema.contextJobs)
    .where(
      and(
        eq(schema.contextJobs.kind, "import"),
        or(
          eq(schema.contextJobs.status, "queued"),
          and(
            eq(schema.contextJobs.status, "paused"),
            or(
              isNull(schema.contextJobs.nextResumeAt),
              lte(schema.contextJobs.nextResumeAt, timestamp),
            ),
          ),
        ),
        or(
          isNull(schema.contextJobs.leaseToken),
          lt(schema.contextJobs.leaseExpiresAt, timestamp),
        ),
      ),
    )
    .limit(Math.max(1, Math.min(input.limit ?? 25, 100)));
  return rows.map((row: any) => ({
    jobId: row.jobId,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId ?? null,
    appId: input.appId,
    resumeAt: row.resumeAt ?? null,
  }));
}

const BACKGROUND_JOB_KINDS: ContextJobKind[] = [
  "embed",
  "enrich-media",
  "brand-dna",
  "canonical-logo",
  "layout-suggestion",
  "metadata-refresh",
  "purge",
];

export async function listDueContextBackgroundJobDispatches(input: {
  appId: string;
  now?: string;
  limit?: number;
}): Promise<
  Array<{
    jobId: string;
    ownerEmail: string;
    orgId: string | null;
    appId: string;
    resumeAt: string | null;
  }>
> {
  const { getDb, schema } = getCreativeContext();
  const timestamp = input.now ?? nowIso();
  // guard:allow-unscoped — only dispatch coordinates leave this query; each
  // processor re-enters the owner's request context before loading a job.
  const rows = await getDb()
    .select({
      jobId: schema.contextJobs.id,
      ownerEmail: schema.contextJobs.ownerEmail,
      orgId: schema.contextJobs.orgId,
      resumeAt: schema.contextJobs.nextResumeAt,
    })
    .from(schema.contextJobs)
    .where(
      and(
        inArray(schema.contextJobs.kind, BACKGROUND_JOB_KINDS),
        or(
          eq(schema.contextJobs.status, "queued"),
          and(
            eq(schema.contextJobs.status, "paused"),
            or(
              isNull(schema.contextJobs.nextResumeAt),
              lte(schema.contextJobs.nextResumeAt, timestamp),
            ),
          ),
        ),
        or(
          isNull(schema.contextJobs.leaseToken),
          lt(schema.contextJobs.leaseExpiresAt, timestamp),
        ),
      ),
    )
    .limit(Math.max(1, Math.min(input.limit ?? 25, 100)));
  return rows.map((row: any) => ({
    jobId: row.jobId,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId ?? null,
    appId: input.appId,
    resumeAt: row.resumeAt ?? null,
  }));
}

export interface JobPatch {
  status?: ContextJobStatus;
  progressCurrent?: number;
  progressTotal?: number | null;
  checkpoint?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  nextResumeAt?: string | null;
  budget?: Record<string, unknown> | null;
}

function patchValues(patch: JobPatch): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.progressCurrent !== undefined)
    values.progressCurrent = patch.progressCurrent;
  if (patch.progressTotal !== undefined)
    values.progressTotal = patch.progressTotal;
  if (patch.checkpoint !== undefined)
    values.checkpoint =
      patch.checkpoint === null ? null : stringifyJson(patch.checkpoint);
  if (patch.result !== undefined)
    values.result = patch.result === null ? null : stringifyJson(patch.result);
  if (patch.error !== undefined) values.error = patch.error;
  if (patch.startedAt !== undefined) values.startedAt = patch.startedAt;
  if (patch.completedAt !== undefined) values.completedAt = patch.completedAt;
  if (patch.nextResumeAt !== undefined)
    values.nextResumeAt = patch.nextResumeAt;
  if (patch.budget !== undefined) {
    values.budget = patch.budget === null ? null : stringifyJson(patch.budget);
  }
  if (
    patch.status === "completed" ||
    patch.status === "failed" ||
    patch.status === "cancelled"
  ) {
    values.completedAt = patch.completedAt ?? nowIso();
  }
  return values;
}

export async function updateJob(
  jobId: string,
  patch: JobPatch,
): Promise<ContextJob> {
  const current = await getJob(jobId);
  if (!current) throw new Error("Creative context job not found");
  if (current.leaseToken) {
    throw new Error("Leased jobs must be updated with updateLeasedJob");
  }
  const { getDb, schema } = getCreativeContext();
  await getDb()
    .update(schema.contextJobs)
    .set(patchValues(patch))
    .where(eq(schema.contextJobs.id, jobId));
  const updated = await getJob(jobId);
  if (!updated) throw new Error("Creative context job not found after update");
  return updated;
}

export async function claimJobLease(input: {
  jobId: string;
  owner: string;
  token: string;
  expiresAt: string;
}): Promise<ContextJob | null> {
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const timestamp = nowIso();
  await getDb()
    .update(schema.contextJobs)
    .set({
      status: "running",
      leaseOwner: input.owner,
      leaseToken: input.token,
      leaseExpiresAt: input.expiresAt,
      attempts: sql`${schema.contextJobs.attempts} + 1`,
      startedAt: timestamp,
    })
    .where(
      and(
        eq(schema.contextJobs.id, input.jobId),
        eq(schema.contextJobs.ownerEmail, actor.ownerEmail),
        or(
          isNull(schema.contextJobs.leaseToken),
          lt(schema.contextJobs.leaseExpiresAt, timestamp),
        ),
        or(
          eq(schema.contextJobs.status, "queued"),
          eq(schema.contextJobs.status, "running"),
          and(
            eq(schema.contextJobs.status, "paused"),
            or(
              isNull(schema.contextJobs.nextResumeAt),
              lte(schema.contextJobs.nextResumeAt, timestamp),
            ),
          ),
        ),
      ),
    );
  const claimed = await getJob(input.jobId);
  return claimed?.leaseToken === input.token ? claimed : null;
}

export async function renewJobLease(input: {
  jobId: string;
  token: string;
  expiresAt: string;
}): Promise<boolean> {
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const timestamp = nowIso();
  await getDb()
    .update(schema.contextJobs)
    .set({ leaseExpiresAt: input.expiresAt })
    .where(
      and(
        eq(schema.contextJobs.id, input.jobId),
        eq(schema.contextJobs.ownerEmail, actor.ownerEmail),
        eq(schema.contextJobs.leaseToken, input.token),
        gt(schema.contextJobs.leaseExpiresAt, timestamp),
      ),
    );
  const renewed = await getJob(input.jobId);
  return (
    renewed?.leaseToken === input.token &&
    renewed.leaseExpiresAt === input.expiresAt
  );
}

export async function continueJob(jobId: string): Promise<ContextJob> {
  const current = await getJob(jobId);
  if (!current) throw new Error("Creative context job not found");
  if (current.kind !== "import") {
    throw new Error("Only creative context import jobs can be continued");
  }
  if (current.status === "completed" || current.status === "cancelled") {
    throw new Error(`A ${current.status} import job cannot be continued`);
  }
  const timestamp = nowIso();
  if (
    current.leaseToken &&
    current.leaseExpiresAt &&
    current.leaseExpiresAt > timestamp
  ) {
    throw new Error("Import job is already running with an active lease");
  }
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  await getDb()
    .update(schema.contextJobs)
    .set({
      status: "queued",
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      error: null,
      completedAt: null,
      nextResumeAt: null,
    })
    .where(
      and(
        eq(schema.contextJobs.id, jobId),
        eq(schema.contextJobs.ownerEmail, actor.ownerEmail),
        or(
          isNull(schema.contextJobs.leaseToken),
          lt(schema.contextJobs.leaseExpiresAt, timestamp),
        ),
      ),
    );
  const continued = await getJob(jobId);
  if (!continued || continued.status !== "queued") {
    throw new Error("Import job could not be continued");
  }
  return continued;
}

export async function releaseJobLease(input: {
  jobId: string;
  token: string;
}): Promise<boolean> {
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const current = await getJob(input.jobId);
  if (current?.leaseToken !== input.token) return false;
  await getDb()
    .update(schema.contextJobs)
    .set({ leaseOwner: null, leaseToken: null, leaseExpiresAt: null })
    .where(
      and(
        eq(schema.contextJobs.id, input.jobId),
        eq(schema.contextJobs.ownerEmail, actor.ownerEmail),
        eq(schema.contextJobs.leaseToken, input.token),
      ),
    );
  const released = await getJob(input.jobId);
  return released?.leaseToken === null;
}

export async function updateLeasedJob(input: {
  jobId: string;
  leaseToken: string;
  patch: JobPatch;
}): Promise<ContextJob | null> {
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const timestamp = nowIso();
  await getDb()
    .update(schema.contextJobs)
    .set(patchValues(input.patch))
    .where(
      and(
        eq(schema.contextJobs.id, input.jobId),
        eq(schema.contextJobs.ownerEmail, actor.ownerEmail),
        eq(schema.contextJobs.leaseToken, input.leaseToken),
        gt(schema.contextJobs.leaseExpiresAt, timestamp),
      ),
    );
  const updated = await getJob(input.jobId);
  if (
    !updated ||
    updated.leaseToken !== input.leaseToken ||
    !updated.leaseExpiresAt ||
    updated.leaseExpiresAt <= timestamp
  ) {
    return null;
  }
  return updated;
}
