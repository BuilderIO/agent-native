import { fail, isActionContractError } from "@agent-native/core/action";
import { and, eq, sql } from "@agent-native/core/db/schema";
import {
  deletePrivateBlob,
  isPrivateBlobError,
  readPrivateBlob,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";

import {
  dataframeMaterializationSchema,
  type CellOutput,
} from "../../app/lib/model/contracts.js";
import { getDb, schema } from "../db/index.js";
import { nowIso } from "./clock.js";
import { StoredDataError } from "./json-column.js";
import { type Queryable, type WorkspaceScope } from "./scope.js";

const { dataframeBlobs, cellOutputs, runs, publishedCellOutputs, projects } =
  schema;

/** Ledger rows examined per sweep; a larger backlog continues on the next one. */
const SWEEP_BATCH = 200;
const DELETED_TOMBSTONE = "deleted";

function pendingDeletion() {
  return sql`coalesce(${dataframeBlobs.lastError}, '') <> ${DELETED_TOMBSTONE}`;
}

/**
 * Records, in the writer's own transaction, that this output refers to a
 * private dataframe blob. The reference and its ledger row commit together, so
 * a blob that an output names is never invisible to cleanup, and a rolled-back
 * write leaves no ledger row for a blob the caller discards itself.
 */
export async function registerOutputDataframe(
  tx: Queryable,
  scope: WorkspaceScope,
  projectId: string,
  output: CellOutput | null,
): Promise<void> {
  if (output?.type !== "table" || !output.materialization) return;
  const handle = output.materialization.handle;
  // Sweep takes the project lock before ledger locks; publishers must use the
  // same order, including before the output's project foreign-key check.
  const [project] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.ownerEmail, scope.ownerEmail),
        eq(projects.orgId, scope.orgId),
      ),
    )
    .limit(1)
    .for("update");
  if (!project)
    fail("The project for this dataframe is no longer available.", {
      statusCode: 409,
      errorCode: "project_dataframe_blob_unavailable",
    });
  await tx
    .insert(dataframeBlobs)
    .values({
      provider: handle.provider,
      handleId: handle.id,
      ownerEmail: scope.ownerEmail,
      orgId: scope.orgId,
      projectId,
      handleJson: JSON.stringify(handle),
      createdAt: nowIso(),
    })
    .onConflictDoNothing();
  const [row] = await tx
    .select({
      state: dataframeBlobs.state,
      projectId: dataframeBlobs.projectId,
      ownerEmail: dataframeBlobs.ownerEmail,
      orgId: dataframeBlobs.orgId,
    })
    .from(dataframeBlobs)
    .where(
      and(
        eq(dataframeBlobs.provider, handle.provider),
        eq(dataframeBlobs.handleId, handle.id),
      ),
    )
    .limit(1)
    .for("update");
  if (
    !row ||
    row.state !== "live" ||
    row.projectId !== projectId ||
    row.ownerEmail !== scope.ownerEmail ||
    row.orgId !== scope.orgId
  )
    fail("The stored dataframe for this result is no longer available.", {
      statusCode: 409,
      errorCode: "project_dataframe_blob_unavailable",
    });
}

function scopeFilter(scope: WorkspaceScope, projectId: string) {
  return and(
    eq(dataframeBlobs.ownerEmail, scope.ownerEmail),
    eq(dataframeBlobs.orgId, scope.orgId),
    eq(dataframeBlobs.projectId, projectId),
  );
}

async function confirmedGone(handle: PrivateBlobHandle): Promise<boolean> {
  try {
    await readPrivateBlob(handle);
    return false;
  } catch (error) {
    return (
      isPrivateBlobError(error) &&
      (error.kind === "not_found" || error.kind === "gone")
    );
  }
}

function storedHandle(json: string): PrivateBlobHandle {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new StoredDataError(
      "A stored dataframe handle is unreadable.",
      error,
    );
  }
  const parsed = dataframeMaterializationSchema.shape.handle.safeParse(raw);
  if (!parsed.success)
    throw new StoredDataError(
      "A stored dataframe handle is invalid.",
      parsed.error,
    );
  return raw as PrivateBlobHandle;
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.name : "unknown_error";
}

/**
 * Deletes private dataframe blobs of one project that no working output, run
 * or published snapshot refers to. Safe to repeat: a blob is first marked for
 * deletion under the project lock (so no copy of a reference can appear
 * afterwards), then removed from storage outside any transaction. Confirmed
 * removal leaves a tombstone so a stale publisher cannot resurrect the handle.
 * A storage failure leaves the row
 * marked and is reported as a typed failure; the next sweep retries it.
 */
export async function sweepDataframeBlobs(
  scope: WorkspaceScope,
  projectId: string,
): Promise<{ removed: number }> {
  if ((await countDataframeBlobs(scope, projectId)) === 0)
    return { removed: 0 };
  await getDb().transaction(async (tx) => {
    // The project row is absent once the project is deleted; then nothing can
    // refer to its blobs and every live ledger row is released.
    await tx
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.ownerEmail, scope.ownerEmail),
          eq(projects.orgId, scope.orgId),
        ),
      )
      .limit(1)
      .for("update");
    const live = await tx
      .select({
        provider: dataframeBlobs.provider,
        handleId: dataframeBlobs.handleId,
      })
      .from(dataframeBlobs)
      .where(
        and(
          scopeFilter(scope, projectId),
          eq(dataframeBlobs.state, "live"),
          sql`not exists (select 1 from ${cellOutputs} where ${cellOutputs.projectId} = ${dataframeBlobs.projectId} and strpos(${cellOutputs.output}, to_json(${dataframeBlobs.handleId}::text)::text) > 0)`,
          sql`not exists (select 1 from ${runs} where ${runs.projectId} = ${dataframeBlobs.projectId} and strpos(${runs.output}, to_json(${dataframeBlobs.handleId}::text)::text) > 0)`,
          sql`not exists (select 1 from ${publishedCellOutputs} where ${publishedCellOutputs.projectId} = ${dataframeBlobs.projectId} and strpos(${publishedCellOutputs.output}, to_json(${dataframeBlobs.handleId}::text)::text) > 0)`,
        ),
      )
      .orderBy(dataframeBlobs.provider, dataframeBlobs.handleId)
      .limit(SWEEP_BATCH)
      .for("update");
    for (const row of live) {
      await tx
        .update(dataframeBlobs)
        .set({ state: "deleting" })
        .where(
          and(
            eq(dataframeBlobs.provider, row.provider),
            eq(dataframeBlobs.handleId, row.handleId),
          ),
        );
    }
  });

  const deleting = await getDb()
    .select()
    .from(dataframeBlobs)
    .where(
      and(
        scopeFilter(scope, projectId),
        eq(dataframeBlobs.state, "deleting"),
        pendingDeletion(),
      ),
    )
    .orderBy(dataframeBlobs.provider, dataframeBlobs.handleId)
    .limit(SWEEP_BATCH);
  let removed = 0;
  let failed = 0;
  for (const row of deleting) {
    let error: unknown = null;
    try {
      const handle = storedHandle(row.handleJson);
      const result = await deletePrivateBlob(handle);
      if (!result.deleted && !(await confirmedGone(handle)))
        error = new Error("storage_delete_unconfirmed");
    } catch (caught) {
      error = caught;
    }
    if (error === null) {
      const completed = await getDb()
        .update(dataframeBlobs)
        .set({ lastError: DELETED_TOMBSTONE })
        .where(
          and(
            eq(dataframeBlobs.provider, row.provider),
            eq(dataframeBlobs.handleId, row.handleId),
            pendingDeletion(),
          ),
        )
        .returning({ handleId: dataframeBlobs.handleId });
      removed += completed.length;
    } else {
      const pending = await getDb()
        .update(dataframeBlobs)
        .set({
          attempts: sql`${dataframeBlobs.attempts} + 1`,
          lastError: describeFailure(error),
        })
        .where(
          and(
            eq(dataframeBlobs.provider, row.provider),
            eq(dataframeBlobs.handleId, row.handleId),
            pendingDeletion(),
          ),
        )
        .returning({ handleId: dataframeBlobs.handleId });
      failed += pending.length;
    }
  }
  if (failed > 0)
    fail(
      "Some stored dataframe results could not be removed yet. Try again to finish cleanup.",
      { statusCode: 503, errorCode: "project_dataframe_cleanup_failed" },
    );
  return { removed };
}

/** Blobs of one project still waiting for cleanup, for repair and tests. */
export async function countDataframeBlobs(
  scope: WorkspaceScope,
  projectId: string,
): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(dataframeBlobs)
    .where(and(scopeFilter(scope, projectId), pendingDeletion()));
  if (!row) throw new Error("Dataframe cleanup count returned no result.");
  return row.count;
}

/**
 * Cleanup after a write that already succeeded (an output was replaced, or an
 * unpublished blob was dropped). A cleanup failure explicitly reports that the
 * preceding write committed; the ledger retains pending cleanup for retry.
 */
export async function sweepDataframeBlobsAfterWrite(
  scope: WorkspaceScope,
  projectId: string,
): Promise<void> {
  try {
    await sweepDataframeBlobs(scope, projectId);
  } catch (error) {
    fail(
      "The write was committed, but dataframe cleanup could not be confirmed. Retry cleanup.",
      {
        statusCode: 503,
        errorCode: "project_dataframe_cleanup_pending",
        details: {
          committed: true,
          cause: isActionContractError(error)
            ? error.errorCode
            : describeFailure(error),
        },
      },
    );
  }
}

/** Discards a blob whose publication failed, recording it first so a failed delete is retried. */
export async function discardUnpublishedDataframe(
  scope: WorkspaceScope,
  projectId: string,
  handle: PrivateBlobHandle,
): Promise<void> {
  await getDb()
    .insert(dataframeBlobs)
    .values({
      provider: handle.provider,
      handleId: handle.id,
      ownerEmail: scope.ownerEmail,
      orgId: scope.orgId,
      projectId,
      handleJson: JSON.stringify(handle),
      state: "deleting",
      createdAt: nowIso(),
    })
    .onConflictDoNothing();
  await sweepDataframeBlobs(scope, projectId);
}
