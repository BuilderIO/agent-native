import { randomUUID } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import enUS from "../../app/i18n/en-US.js";
import { notebookMessages } from "../../app/i18n/messages/notebook.js";
import {
  withoutPendingCellEdit,
  type ProjectDocument,
} from "../../app/lib/model/contracts.js";
import { compareOrder } from "../../app/lib/model/order.js";
import {
  appDocumentSchema,
  appTabSlugs,
  DEFAULT_APP_STALE_HOURS,
} from "../../shared/app-layout.js";
import {
  appSessionOperationOutput,
  appSessionProjectionSchema,
  refreshAppResultsOutput,
  inputValueFromControl,
  serializeInputValue,
  type AppInputValues,
  type AppSessionOperation,
  type AppSessionProjection,
  type AppSessionRefresh,
  type InputValue,
  type appSessionRefSchema,
  type openAppSessionInput,
  type refreshAppResultsInput,
  type resetAppSessionInput,
  type saveAppViewInput,
  type setAppInputsInput,
} from "../../shared/app-session-operations.js";
import { capabilityScopeRefSchema } from "../../shared/capabilities.js";
import {
  appSessionIdSchema,
  executionSnapshotSchema,
  namespaceIdSchema,
  releaseIdSchema,
  resultIdSchema,
  runRequestSchema,
  runReceiptSchema,
  type RunReceipt,
  type Snapshot,
} from "../../shared/notebook-execution.js";
import {
  completeResultManifestSchema,
  resultManifestSchema,
  type AuthorizedResultRef,
} from "../../shared/notebook-result-contract.js";
import {
  notebookCellIdSchema,
  outputFenceSchema,
  revisionSchema,
} from "../../shared/notebook-snapshot-contract.js";
import type { ReleaseOutput } from "../../shared/project-publish.js";
import {
  appViewerCellIds,
  appViewerDocument,
} from "../../shared/published-app-projection.js";
import { getDb, schema } from "../db/index.js";
import type { BaselineResult } from "../db/schema.js";
import { usesBrowserNotebookKernel } from "../execution/kernel-client.js";
import { inputBinding, SqlBindingError } from "../execution/sql-compiler.js";
import {
  ANALYTICS_CONTROL_IDS,
  requireCapability,
} from "../lib/analytics-capabilities.js";
import {
  digest,
  notebookGraph,
  type CellId,
  type ExecutionCell,
} from "./notebook-execution/planner.js";
import { lockNotebookRunOutputs } from "./notebook-execution/run-store.js";
import {
  notebookOutputs as outputs,
  notebookResultManifests as manifests,
  notebookRuns as runs,
  notebookRunAttempts as attempts,
  notebookRunWork as work,
} from "./notebook-execution/schema.js";
import {
  findClaimableNotebookRunActor,
  notebookRunStore,
  wakeNotebookRun,
} from "./notebook-execution/service.js";
import {
  MAX_NOTEBOOK_CELLS,
  type ExecutionActor,
  type SnapshotReader,
} from "./notebook-execution/snapshot.js";
import {
  checkNotebookAuthorities,
  primaryResultId,
  readNotebookResultChoices,
} from "./notebook-results.js";
import {
  type ProjectRow,
  resolvePublishedProjectAccess,
} from "./project-access.js";
import {
  canEditProject,
  canManageProject,
  projectAccessLevel,
} from "./project-grant-access.js";
import { readAccessibleProjectOutputs } from "./project-output-access.js";
import {
  isLegacySynthesizedRelease,
  readProjectRelease,
  readReleaseManifest,
} from "./project-releases.js";
import { recordProjectView } from "./project-views.js";
import { getReadableProjectDocument } from "./projects-store.js";
import type { Queryable } from "./scope.js";

const {
  publishedAppDefaultCaches: caches,
  publishedAppSavedViews: views,
  publishedAppSessionReceipts: receipts,
  publishedAppSessions: sessions,
} = schema;
type Session = typeof sessions.$inferSelect;
type Cache = typeof caches.$inferSelect;
type ResultId = z.infer<typeof resultIdSchema>;
type SessionRef = z.infer<typeof appSessionRefSchema>;
type Release = NonNullable<Awaited<ReturnType<typeof readProjectRelease>>>;
type Access = {
  project: ProjectRow;
  appOnly: boolean;
  canViewSource: boolean;
  canRefreshDefault: boolean;
};
type AppSessionScope = {
  session: Session;
  access: Access;
  release: Release | null;
  document: ProjectDocument;
};
const RETRY_STALE_AFTER_MS = 5 * 60_000;
const RESULT_UNAVAILABLE = "This output is unavailable in this release.";

function notFound(): never {
  return fail("This app is unavailable.", {
    statusCode: 404,
    errorCode: "project_version_not_found",
  });
}
function sessionConflict(code: string, message: string): never {
  return fail(message, { statusCode: 409, errorCode: code });
}
function sessionUnreadable(): never {
  return fail("The app session is temporarily unavailable.", {
    statusCode: 503,
    errorCode: "app_session_unreadable",
  });
}

async function appAccess(
  actor: ExecutionActor,
  projectId: string,
  db: Queryable,
  lock = false,
) {
  const access = await resolvePublishedProjectAccess(
    actor,
    projectId,
    db,
    lock,
  );
  if (!access) return null;
  const { project, appOnly } = access;
  if (appOnly)
    return { ...access, canViewSource: false, canRefreshDefault: false };
  const level = await projectAccessLevel(actor, project, [], db);
  if (!level) return null;
  return {
    project,
    appOnly,
    canViewSource: canEditProject(level),
    canRefreshDefault: canManageProject(level),
  };
}

function actorSessions(actor: ExecutionActor) {
  return and(
    eq(sessions.orgId, actor.orgId),
    eq(sessions.ownerEmail, actor.ownerEmail),
  );
}

async function findSession(
  actor: ExecutionActor,
  sessionId: string,
  db: Queryable,
  lock = false,
) {
  const query = db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), actorSessions(actor)))
    .limit(1);
  const [session] = await (lock ? query.for("update") : query);
  return session;
}

export async function publishedSessionOutputNamespace(
  actor: ExecutionActor,
  {
    projectId,
    releaseId,
    sessionId,
    cellId,
  }: {
    projectId: string;
    releaseId: string;
    sessionId: string;
    cellId: string;
  },
) {
  const db = getDb();
  const session = await findSession(actor, sessionId, db);
  if (session?.projectId !== projectId || session.releaseId !== releaseId)
    return null;
  const access = await appAccess(actor, projectId, db);
  if (!access) return null;
  if (access.appOnly) {
    const release = await readProjectRelease(db, session);
    if (!release || !appViewerCellIds(release.project).has(cellId)) return null;
  }
  return sessionNamespace(session).namespaceId;
}

async function scopedSession(
  actor: ExecutionActor,
  ref: SessionRef,
  db = getDb(),
  lock = false,
): Promise<AppSessionScope> {
  const session = await findSession(actor, ref.sessionId, db, lock);
  if (!session) notFound();
  if (ref.releaseId !== session.releaseId)
    sessionConflict(
      "session_release_mismatch",
      "This app session belongs to a different published version.",
    );
  const access = await appAccess(actor, session.projectId, db, lock);
  if (!access) notFound();
  const release = await readProjectRelease(db, session);
  const document =
    release?.project ??
    (await getReadableProjectDocument(
      actor,
      session.projectId,
      session.releaseId,
      "published",
    ));
  if (!document) notFound();
  return { session, access, release: release ?? null, document };
}

export function releaseCells(
  document: ProjectDocument,
  overrides: AppInputValues = {},
): ExecutionCell[] {
  return document.cells
    .flatMap(({ id, contents }): ExecutionCell[] => {
      const cellId = notebookCellIdSchema.parse(id);
      if (contents.kind === "input") {
        const value = overrides[id];
        return [
          {
            id: cellId,
            contents: value
              ? { ...contents, defaultValueString: serializeInputValue(value) }
              : contents,
          },
        ];
      }
      return contents.kind === "sql" || contents.kind === "code"
        ? [{ id: cellId, contents }]
        : [];
    })
    .sort((a, b) => compareOrder(a.contents.order, b.contents.order));
}

function effectiveValues(document: ProjectDocument, overrides: AppInputValues) {
  return Object.fromEntries(
    document.cells.flatMap(({ id, contents }) =>
      contents.kind === "input"
        ? [
            [
              id,
              overrides[id] ??
                inputValueFromControl(contents, contents.defaultValueString),
            ],
          ]
        : [],
    ),
  );
}

function sessionNamespace(session: Session) {
  return {
    kind: "release-session",
    namespaceId: namespaceIdSchema.parse(
      digest(["release-session", session.orgId, session.releaseId, session.id]),
    ),
    sessionId: appSessionIdSchema.parse(session.id),
    releaseId: releaseIdSchema.parse(session.releaseId),
  } as const;
}

function defaultNamespace(orgId: string, cache: Cache) {
  return {
    kind: "release-default",
    namespaceId: namespaceIdSchema.parse(
      digest([
        "release-default",
        orgId,
        cache.releaseId,
        String(cache.generation),
      ]),
    ),
    releaseId: releaseIdSchema.parse(cache.releaseId),
  } as const;
}

export function executionSnapshot(
  release: Release,
  namespace: Snapshot["namespace"],
  inputRevision: bigint,
  cells: ExecutionCell[],
) {
  return executionSnapshotSchema.parse({
    ref: release.snapshot.ref,
    namespace,
    inputRevision: String(inputRevision),
    executionFingerprint: digest(
      notebookGraph(cells).map(({ signature }) => signature),
    ),
  });
}

async function readCache(db: Queryable, releaseId: string, lock = false) {
  const query = db
    .select()
    .from(caches)
    .where(eq(caches.releaseId, releaseId))
    .limit(1);
  const [cache] = await (lock ? query.for("update") : query);
  return cache;
}

export const readPublishedExecutionSnapshot: SnapshotReader = async (
  actor,
  requested,
  tx,
) => {
  const { ref, namespace } = requested;
  if (ref.workspaceId !== actor.orgId) return { status: "denied" };
  if (
    namespace.kind !== "release-session" &&
    namespace.kind !== "release-default"
  )
    return { status: "pending" };
  const db = tx ?? getDb();
  const access = await appAccess(actor, ref.projectId, db, tx !== undefined);
  if (!access) return { status: "denied" };
  const release = await readProjectRelease(db, {
    orgId: actor.orgId,
    projectId: ref.projectId,
    releaseId: namespace.releaseId,
  });
  if (!release) return { status: "absent" };
  if (namespace.kind === "release-session") {
    const session = await findSession(
      actor,
      namespace.sessionId,
      db,
      tx !== undefined,
    );
    if (
      !session ||
      session.projectId !== ref.projectId ||
      session.releaseId !== release.id
    )
      return { status: "denied" };
    const cells = releaseCells(release.project, session.overrides);
    const snapshot = executionSnapshot(
      release,
      sessionNamespace(session),
      session.inputRevision,
      cells,
    );
    return snapshot.namespace.namespaceId === namespace.namespaceId
      ? { status: "accepted", value: { snapshot, cells } }
      : { status: "denied" };
  }
  if (access.project.ownerEmail !== actor.ownerEmail)
    return { status: "denied" };
  const cache = await readCache(db, release.id, tx !== undefined);
  if (!cache) return { status: "absent" };
  const cells = releaseCells(release.project);
  const snapshot = executionSnapshot(
    release,
    defaultNamespace(actor.orgId, cache),
    cache.generation,
    cells,
  );
  return snapshot.namespace.namespaceId === namespace.namespaceId
    ? { status: "accepted", value: { snapshot, cells } }
    : { status: "denied" };
};

export async function authorizePublishedResult(
  actor: ExecutionActor,
  run: typeof runs.$inferSelect,
  resultId: ResultId,
  sessionId?: string,
  producer?: AuthorizedResultRef["producer"],
  choiceFields?: { valueFieldId: string; displayFieldId: string | undefined },
  visualizationCellId?: string,
) {
  const denied = { status: "denied", reason: "access_denied" } as const;
  const { namespace, ref } = run.receipt.request.snapshot;
  if (run.orgId !== actor.orgId || ref.workspaceId !== actor.orgId)
    return denied;
  const id =
    sessionId ??
    (namespace.kind === "release-session" ? namespace.sessionId : undefined);
  if (!id) return denied;
  const session = await findSession(actor, id, getDb());
  if (!session || session.projectId !== ref.projectId) return denied;
  const db = getDb();
  const access = await appAccess(actor, session.projectId, db);
  if (!access) return denied;
  if (access.appOnly) {
    const release = await readProjectRelease(db, session);
    if (!release || !producer) return denied;
    const visible = appViewerCellIds(release.project);
    const metric =
      visualizationCellId && visible.has(visualizationCellId)
        ? release.project.cells.find(({ id }) => id === visualizationCellId)
            ?.contents
        : undefined;
    const metricSource =
      metric?.kind === "metric" ? metric.metricConfig?.source : null;
    if (
      !visible.has(producer.cellId) &&
      !(
        metricSource?.cellId === producer.cellId &&
        metricSource.exportId === producer.exportId
      ) &&
      !(
        choiceFields &&
        release.project.cells.some(({ id, contents }) => {
          const options =
            contents.kind === "input" ? contents.dynamicOptions : null;
          return (
            visible.has(id) &&
            options?.producerCellId === producer.cellId &&
            options.valueFieldId === choiceFields.valueFieldId &&
            options.displayFieldId === choiceFields.displayFieldId
          );
        })
      )
    )
      return denied;
  }
  if ("releaseId" in namespace && session.releaseId !== namespace.releaseId)
    return denied;
  const primaryId = primaryResultId(resultId, producer);
  if (namespace.kind === "release-session") {
    if (
      namespace.sessionId !== session.id ||
      run.ownerEmail !== actor.ownerEmail
    )
      return denied;
    const [current] = await db
      .select({ cellId: outputs.cellId })
      .from(outputs)
      .where(
        and(
          eq(outputs.namespaceId, namespace.namespaceId),
          or(
            eq(outputs.resultId, primaryId),
            eq(outputs.dependencyResultId, primaryId),
          ),
        ),
      )
      .limit(1);
    if (current) return null;
    if (
      run.receipt.request.snapshot.inputRevision !==
      String(session.inputRevision)
    )
      return denied;
    const [building] = await db
      .select({ cellId: work.cellId })
      .from(work)
      .innerJoin(
        outputs,
        and(
          eq(outputs.namespaceId, namespace.namespaceId),
          eq(outputs.attemptId, work.attemptId),
        ),
      )
      .where(
        and(
          eq(work.runId, run.id),
          eq(work.resultId, resultId),
          eq(work.done, false),
        ),
      )
      .limit(1);
    return building ? null : denied;
  }
  if (
    namespace.kind !== "preview" &&
    namespace.kind !== "draft" &&
    namespace.kind !== "release-default" &&
    namespace.kind !== "schedule-tick"
  )
    return denied;
  if (session.baseline.some((entry) => entry.resultId === primaryId))
    return null;
  return denied;
}

function publishedRefreshNeedsKernel(
  document: ProjectDocument,
  affected?: ReadonlySet<CellId>,
) {
  return (
    usesBrowserNotebookKernel() &&
    releaseCells(document).some(
      ({ id, contents }) =>
        (!affected || affected.has(id)) &&
        ((contents.kind === "code" &&
          contents.language === "python" &&
          contents.source.trim() !== "") ||
          (contents.kind === "sql" &&
            contents.connectionMode === "dataframes")),
    )
  );
}

function publishedKernelUnavailable(): never {
  return fail(enUS.publishedApp.hostedKernelRequired, {
    statusCode: 409,
    errorCode: "app_hosted_kernel_required",
  });
}

function terminal(run: RunReceipt) {
  return run.attempts.every(
    ({ state }) => state.status !== "queued" && state.status !== "running",
  );
}
function failedRun(run: RunReceipt) {
  return (
    run.plan.rejectedCells.length > 0 ||
    run.attempts.some(({ state }) => state.status !== "complete")
  );
}

function sessionHref(projectId: string, releaseId: string, sessionId: string) {
  return `/app/${encodeURIComponent(projectId)}/${encodeURIComponent(releaseId)}/${encodeURIComponent(sessionId)}`;
}

function ageStatus(
  refreshedAt: string | null,
  settings?: z.infer<typeof appDocumentSchema>["settings"],
) {
  if (!refreshedAt) return "unavailable" as const;
  const policy = settings?.staleAfter;
  const hours =
    policy?.kind === "hours" ? policy.value : DEFAULT_APP_STALE_HOURS;
  return Date.now() - Date.parse(refreshedAt) >= hours * 3_600_000
    ? ("stale" as const)
    : ("fresh" as const);
}

async function runFor(
  db: Queryable,
  id: RunReceipt["runId"],
  namespaceId: string,
) {
  const [run] = await db
    .select({ receipt: runs.receipt, sequence: runs.sequence })
    .from(runs)
    .where(and(eq(runs.id, id), eq(runs.namespaceId, namespaceId)))
    .limit(1);
  if (!run) sessionUnreadable();
  const current = await db
    .select({ receipt: attempts.receipt, finishedAt: attempts.finishedAt })
    .from(work)
    .innerJoin(attempts, eq(attempts.id, work.attemptId))
    .where(eq(work.runId, id))
    .orderBy(asc(work.ordinal))
    .limit(MAX_NOTEBOOK_CELLS + 1);
  if (current.length !== run.receipt.attempts.length) sessionUnreadable();
  return {
    ...run.receipt,
    attempts: current.map((row) => row.receipt),
    cursor: runReceiptSchema.shape.cursor.parse(String(run.sequence)),
    finishedAt:
      current
        .flatMap((row) => (row.finishedAt ? [row.finishedAt] : []))
        .sort()
        .at(-1) ?? null,
  };
}

function baselineOutputs(entries: ReleaseOutput[]) {
  return entries.flatMap(({ cellId, resultId }) =>
    resultId
      ? [
          {
            cellId: notebookCellIdSchema.parse(cellId),
            resultId: resultIdSchema.parse(resultId),
          },
        ]
      : [],
  );
}

export async function defaultCacheFor(release: Release, db = getDb()) {
  const current = await readCache(db, release.id);
  if (current) return current;
  const results = baselineOutputs(
    await readReleaseManifest(db, release.manifestId),
  );
  const ids = results.map(({ resultId }) => resultId);
  const timestamps = ids.length
    ? await db
        .select({ createdAt: manifests.createdAt })
        .from(manifests)
        .where(inArray(manifests.id, ids))
        .limit(ids.length)
    : [];
  if (timestamps.length !== ids.length) sessionUnreadable();
  const latest = timestamps.reduce<number | null>(
    (previous, { createdAt }) =>
      createdAt === null
        ? previous
        : Math.max(createdAt, previous ?? createdAt),
    null,
  );
  await db
    .insert(caches)
    .values({
      releaseId: release.id,
      results,
      refreshedAt: latest === null ? null : new Date(latest).toISOString(),
    })
    .onConflictDoNothing();
  const saved = await readCache(db, release.id);
  if (!saved) sessionUnreadable();
  return saved;
}

async function settledDefaultCache(release: Release): Promise<{
  cache: Cache;
  running: RunReceipt | null;
}> {
  const cache = await defaultCacheFor(release);
  if (!cache.runId) return { cache, running: null };
  const run = await runFor(
    getDb(),
    cache.runId,
    defaultNamespace(release.orgId, cache).namespaceId,
  );
  if (!terminal(run)) return { cache, running: run };
  const db = getDb();
  const results = run.attempts.flatMap(({ attempt, state }) =>
    state.status === "complete" && state.resultIds[0]
      ? [{ cellId: attempt.cellId, resultId: state.resultIds[0] }]
      : [],
  );
  const id = cache.runId;
  const ids = results.map(({ resultId }) => resultId);
  const artifactRows = ids.length
    ? await db
        .select({ manifest: manifests.manifest })
        .from(manifests)
        .where(inArray(manifests.id, ids))
        .limit(ids.length)
    : [];
  const complete =
    artifactRows.length === ids.length &&
    artifactRows.every(
      ({ manifest }) =>
        completeResultManifestSchema.safeParse(manifest).success,
    );
  const replacement =
    !failedRun(run) && complete && results.length > 0
      ? {
          results,
          generation: cache.generation + 1n,
          refreshedAt: run.finishedAt,
          scheduleDueAt: null,
        }
      : {};
  const [updated] = await db
    .update(caches)
    .set({ ...replacement, runId: null })
    .where(
      and(
        eq(caches.releaseId, release.id),
        eq(caches.generation, cache.generation),
        eq(caches.runId, id),
      ),
    )
    .returning();
  const settled = updated ?? (await readCache(db, release.id));
  if (!settled) sessionUnreadable();
  return { cache: settled, running: null };
}

async function seedSessionBaseline(
  db: Queryable,
  session: Session,
  document: ProjectDocument,
  baseline: BaselineResult[],
) {
  const { namespaceId } = sessionNamespace(session);
  const refs = new Map(
    baseline.map(({ cellId, resultId }) => [cellId, resultId]),
  );
  const rows = notebookGraph(releaseCells(document)).map(
    ({ cell, signature }) => {
      const resultId = refs.get(cell.id) ?? null;
      return {
        namespaceId,
        cellId: cell.id,
        generation:
          outputFenceSchema.shape.outputGeneration.parse(randomUUID()),
        attemptId: null,
        resultId,
        signature: resultId ? signature : null,
      };
    },
  );
  if (rows.length)
    await db
      .insert(outputs)
      .values(rows)
      .onConflictDoUpdate({
        target: [outputs.namespaceId, outputs.cellId],
        set: {
          generation: sql`excluded.generation`,
          attemptId: null,
          resultId: sql`excluded.result_id`,
          signature: sql`excluded.signature`,
        },
      });
}

function admitted(result: Awaited<ReturnType<typeof notebookRunStore.admit>>) {
  if (result.status === "admitted") return result;
  if (result.status === "denied")
    fail("You don’t have access to this app.", {
      statusCode: 403,
      errorCode: "capability_denied",
    });
  if (result.status === "rejected")
    sessionConflict(
      `app_run_${result.reason}`,
      "The app could not start a run.",
    );
  return sessionUnreadable();
}

async function fullSessionRun(
  tx: Queryable,
  actor: ExecutionActor,
  session: Session,
  release: Release,
  requestId: string,
  cachePolicy: "reuse" | "bypass",
) {
  const snapshot = executionSnapshot(
    release,
    sessionNamespace(session),
    session.inputRevision,
    releaseCells(release.project, session.overrides),
  );
  return admitted(
    await notebookRunStore.admit(
      actor,
      runRequestSchema.parse({
        snapshot,
        requestId,
        mode: "run-all",
        restart: false,
        cache: cachePolicy,
      }),
      undefined,
      tx,
    ),
  );
}

type RefreshRequest = z.infer<typeof refreshAppResultsInput>;

async function startDefaultRun(
  actor: ExecutionActor,
  access: Access,
  release: Release,
  input?: RefreshRequest,
) {
  const { cache } = await settledDefaultCache(release);
  const owner = { ...actor, ownerEmail: access.project.ownerEmail };
  if (
    !input &&
    (cache.runId ||
      ageStatus(cache.refreshedAt, release.project.appLayout?.settings) ===
        "fresh" ||
      (cache.attemptedAt &&
        Date.now() - Date.parse(cache.attemptedAt) < RETRY_STALE_AFTER_MS))
  )
    return null;
  const receipt = await getDb().transaction(async (tx) => {
    const cells = releaseCells(release.project);
    const namespace = defaultNamespace(owner.orgId, cache);
    await lockNotebookRunOutputs(
      tx,
      namespace.namespaceId,
      cells.map(({ id }) => id),
      true,
    );
    const current = await readCache(tx, release.id, true);
    const intent = input ? digest(["refresh", input]) : null;
    if (input && intent) {
      const { access } = await scopedSession(actor, input, tx, true);
      if (!access.canRefreshDefault)
        fail("You don’t have permission to refresh this app for all viewers.", {
          statusCode: 403,
          errorCode: "capability_denied",
        });
      const replay = await readReceipt(
        tx,
        input.sessionId,
        input.requestId,
        intent,
      );
      if (replay) return refreshAppResultsOutput.parse(replay);
    }
    if (!current || current.generation !== cache.generation) return null;
    let run = current.runId
      ? await runFor(tx, current.runId, namespace.namespaceId)
      : null;
    if (!run) {
      const admittedRun = admitted(
        await notebookRunStore.admit(
          owner,
          runRequestSchema.parse({
            snapshot: executionSnapshot(
              release,
              namespace,
              cache.generation,
              cells,
            ),
            requestId: randomUUID(),
            mode: "run-all",
            restart: false,
            cache: input?.cachePolicy ?? "reuse",
          }),
          undefined,
          tx,
        ),
      );
      await tx
        .update(caches)
        .set({
          runId: admittedRun.runId,
          attemptedAt: new Date().toISOString(),
        })
        .where(eq(caches.releaseId, release.id));
      run = { ...admittedRun, finishedAt: null };
    }
    const receipt = {
      runId: run.runId,
      cacheGeneration: revisionSchema.parse(String(cache.generation)),
      cursor: revisionSchema.parse(run.cursor),
    };
    if (input && intent)
      await tx.insert(receipts).values({
        sessionId: input.sessionId,
        requestId: input.requestId,
        intent,
        receipt,
      });
    return receipt;
  });
  if (receipt) wakeNotebookRun(owner, receipt.runId);
  return receipt;
}

function unavailableOutput(
  resultStatus: NonNullable<
    AppSessionProjection["projection"]["outputs"][string]["resultStatus"]
  >,
) {
  return {
    output: {
      type: "error" as const,
      message:
        resultStatus === "denied"
          ? notebookMessages.publishedAppSharing.resultDenied
          : RESULT_UNAVAILABLE,
      detail: null,
    },
    resultStatus,
  };
}

async function projectPublishedResults(
  actor: ExecutionActor,
  pointers: Pick<typeof outputs.$inferSelect, "cellId" | "resultId">[],
): Promise<AppSessionProjection["projection"]["outputs"]> {
  const ids = [
    ...new Set(
      pointers.flatMap(({ resultId }) => (resultId ? [resultId] : [])),
    ),
  ];
  if (!ids.length) return {};
  const rows = await getDb()
    .select()
    .from(manifests)
    .where(inArray(manifests.id, ids))
    .limit(ids.length);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const authorityChecks = new Map<
    string,
    ReturnType<typeof checkNotebookAuthorities>
  >();
  const projected = await Promise.all(
    pointers.map(async ({ cellId, resultId }) => {
      if (!resultId) return null;
      const row = byId.get(resultId);
      const parsed = resultManifestSchema.safeParse(row?.manifest);
      if (
        !parsed.success ||
        !row ||
        !row.authorities ||
        parsed.data.result.resultId !== resultId ||
        parsed.data.result.producer.cellId !== cellId
      )
        return [cellId, unavailableOutput("unreadable")] as const;
      for (const authority of row.authorities) {
        const key = digest(authority);
        const check =
          authorityChecks.get(key) ??
          checkNotebookAuthorities(actor, [authority]);
        authorityChecks.set(key, check);
        const failure = await check;
        if (failure)
          return [cellId, unavailableOutput(failure.status)] as const;
      }
      const { status } = parsed.data;
      if (status === "pending")
        return [cellId, unavailableOutput("unreadable")] as const;
      if (status === "incomplete")
        return [
          cellId,
          { ...unavailableOutput(parsed.data.reason), resultId },
        ] as const;
      return [
        cellId,
        { output: null, resultId, resultStatus: "ready" },
      ] as const;
    }),
  );
  return Object.fromEntries(projected.filter((entry) => entry !== null));
}

async function readLegacySessionOutputs(
  actor: ExecutionActor,
  access: Access,
  document: ProjectDocument,
  releaseId: string,
): Promise<AppSessionProjection["projection"]["outputs"]> {
  const cellIds = access.appOnly
    ? appViewerCellIds(document)
    : new Set(document.cells.map(({ id }) => id));
  const legacy = await readAccessibleProjectOutputs(
    access.appOnly
      ? { ...actor, ownerEmail: access.project.ownerEmail }
      : actor,
    document.id,
    releaseId,
    cellIds,
    actor.caller,
  );
  const entries: AppSessionProjection["projection"]["outputs"] = {};
  for (const [cellId, output] of Object.entries(legacy)) {
    if (output.accessStatus) {
      entries[cellId] = unavailableOutput(output.accessStatus);
    } else if (output.output) {
      entries[cellId] = { output: output.output };
    }
  }
  return entries;
}

async function readSessionPointers(db: Queryable, session: Session) {
  return db
    .select()
    .from(outputs)
    .where(eq(outputs.namespaceId, sessionNamespace(session).namespaceId))
    .limit(MAX_NOTEBOOK_CELLS + 1);
}

async function readSessionProjection(
  actor: ExecutionActor,
  scope: AppSessionScope,
): Promise<AppSessionProjection> {
  let { session } = scope;
  const { access, release, document } = scope;
  const visibleIds = access.appOnly ? appViewerCellIds(document) : null;
  const db = getDb();
  const { cache, running: defaultRun } = release
    ? await settledDefaultCache(release)
    : { cache: null, running: null };
  if (
    cache &&
    !session.runId &&
    Object.keys(session.overrides).length === 0 &&
    cache.generation > session.baselineGeneration &&
    !document.appLayout?.settings.scratchOnLoad
  ) {
    session = await db.transaction(async (tx) => {
      await lockNotebookRunOutputs(
        tx,
        sessionNamespace(session).namespaceId,
        releaseCells(document).map(({ id }) => id),
        true,
      );
      const row = await findSession(actor, session.id, tx, true);
      if (!row) notFound();
      if (
        row.runId ||
        Object.keys(row.overrides).length ||
        cache.generation <= row.baselineGeneration
      )
        return row;
      await seedSessionBaseline(tx, row, document, cache.results);
      const [updated] = await tx
        .update(sessions)
        .set({
          baseline: cache.results,
          baselineGeneration: cache.generation,
          baselineRefreshedAt: cache.refreshedAt,
          refreshedAt: cache.refreshedAt,
        })
        .where(eq(sessions.id, row.id))
        .returning();
      if (!updated) sessionUnreadable();
      return updated;
    });
  }
  const run = session.runId
    ? await runFor(db, session.runId, sessionNamespace(session).namespaceId)
    : null;
  const runPending = run !== null && !terminal(run);
  const activeDefault =
    cache?.runId && !session.runId && !Object.keys(session.overrides).length;
  const runningCellIds = (
    (activeDefault ? defaultRun : run)?.attempts ?? []
  ).flatMap(({ attempt, state }) =>
    (state.status === "queued" || state.status === "running") &&
    (!visibleIds || visibleIds.has(attempt.cellId))
      ? [attempt.cellId]
      : [],
  );
  const manifest = release
    ? await readReleaseManifest(db, release.manifestId)
    : [];
  const entries: AppSessionProjection["projection"]["outputs"] = {};
  const inputChoices: AppSessionProjection["inputChoices"] = {};
  if (release) {
    for (const entry of manifest) {
      if (entry.state !== "ready")
        entries[entry.cellId] = unavailableOutput(entry.state);
    }
    const pointers = await readSessionPointers(db, session);
    if (pointers.length > MAX_NOTEBOOK_CELLS) sessionUnreadable();
    const hasLiveResults = pointers.some(
      (pointer) => pointer.resultId !== null,
    );
    const hasActiveOrFailedRun =
      runPending || Boolean(activeDefault) || Boolean(run && failedRun(run));
    if (
      isLegacySynthesizedRelease(release) &&
      !hasLiveResults &&
      !hasActiveOrFailedRun
    ) {
      Object.assign(
        entries,
        await readLegacySessionOutputs(
          actor,
          access,
          document,
          session.releaseId,
        ),
      );
    } else {
      Object.assign(entries, await projectPublishedResults(actor, pointers));
    }
    for (const { id, contents } of releaseCells(document)) {
      if (visibleIds && !visibleIds.has(id)) continue;
      if (contents.kind !== "input" || !contents.dynamicOptions) continue;
      const { producerCellId, valueFieldId, displayFieldId } =
        contents.dynamicOptions;
      const resultId = pointers.find(
        ({ cellId }) => cellId === producerCellId,
      )?.resultId;
      inputChoices[id] = resultId
        ? await readNotebookResultChoices(
            actor,
            resultId,
            valueFieldId,
            displayFieldId,
            { sessionId: appSessionIdSchema.parse(session.id) },
          )
        : { status: "missing" };
    }
    if (!runPending && run && failedRun(run)) {
      for (const { attempt, state } of run.attempts)
        if (state.status !== "complete")
          entries[attempt.cellId] = unavailableOutput("failed");
      for (const { cellId } of run.plan.rejectedCells)
        entries[cellId] = unavailableOutput("failed");
    }
  } else {
    Object.assign(
      entries,
      await readLegacySessionOutputs(
        actor,
        access,
        document,
        session.releaseId,
      ),
    );
  }
  const refreshedAt =
    run &&
    !runPending &&
    run.attempts.some(({ state }) => state.status === "complete")
      ? run.finishedAt
      : session.refreshedAt;
  const visibleEntries = <T>(values: Record<string, T>) =>
    visibleIds
      ? Object.fromEntries(
          Object.entries(values).filter(([id]) => visibleIds.has(id)),
        )
      : values;
  const overrides = visibleEntries(session.overrides);
  const visibleDocument = visibleIds
    ? appViewerDocument(document, visibleIds)
    : access.canViewSource
      ? document
      : {
          ...document,
          cells: document.cells.map((cell) => {
            const contents = withoutPendingCellEdit(cell.contents);
            if (contents.kind === "sql" || contents.kind === "code")
              return { ...cell, contents: { ...contents, source: "" } };
            if (contents.kind === "chart") {
              const { drilldownSql: _drilldownSql, ...chart } = contents;
              return { ...cell, contents: chart };
            }
            return { ...cell, contents };
          }),
        };
  const visibleTabs = visibleDocument.appLayout?.tabs ?? [];
  const slugs =
    document.appLayout && visibleTabs.length > 1
      ? appTabSlugs(document.appLayout)
      : null;
  const tabSlugs = visibleTabs.flatMap(({ tabId }) => {
    const slug = slugs?.get(tabId);
    return slug === undefined ? [] : [[tabId, slug] as const];
  });
  const metricSourceResultIds = Object.fromEntries(
    visibleDocument.cells.flatMap(({ id, contents }) => {
      const binding =
        contents.kind === "metric" ? contents.metricConfig?.source : null;
      const result = binding && entries[binding.cellId];
      return result && result.resultStatus === "ready" && result.resultId
        ? [[id, result.resultId]]
        : [];
    }),
  );
  return appSessionProjectionSchema.parse({
    sessionId: session.id,
    releaseId: session.releaseId,
    inputRevision: String(session.inputRevision),
    tabId: visibleTabs[0]?.tabId ?? null,
    appDocument: visibleDocument.appLayout ?? null,
    projection: {
      project: visibleDocument,
      outputs: visibleEntries(entries),
      metricSourceResultIds,
      runningCellIds,
      tabSlugs,
      canViewSource: access.canViewSource,
    },
    inputChoices: visibleEntries(inputChoices),
    effectiveValues: visibleEntries(effectiveValues(document, overrides)),
    overrides,
    baselineManifestId: release?.manifestId ?? null,
    defaultCacheGeneration: String(session.baselineGeneration),
    ageStatus: ageStatus(refreshedAt, document.appLayout?.settings),
    ...(release && publishedRefreshNeedsKernel(document)
      ? { refreshUnavailable: "hosted-kernel-required" }
      : {}),
    refreshedAt,
    sessionHref: sessionHref(session.projectId, session.releaseId, session.id),
    caps: {
      refreshDefault: !!release && access.canRefreshDefault,
      saveView: !!release,
    },
    cursor: String(session.inputRevision),
    state:
      runPending || activeDefault
        ? "running"
        : (run && failedRun(run)) ||
            (!run &&
              manifest.some(
                ({ state, cellId }) =>
                  state !== "ready" &&
                  entries[cellId]?.resultStatus !== "ready",
              ))
          ? "error"
          : "ready",
    runId: session.runId ?? cache?.runId ?? null,
    staleAfter: document.appLayout?.settings.staleAfter ?? {
      kind: "workspace-default",
    },
  });
}

export async function getPublishedAppSession(
  actor: ExecutionActor,
  input: SessionRef,
) {
  const projection = await readSessionProjection(
    actor,
    await scopedSession(actor, input),
  );
  if (projection.state === "running" && projection.runId) {
    const claimableActor = await findClaimableNotebookRunActor(
      actor.orgId,
      projection.runId,
    );
    if (claimableActor) wakeNotebookRun(claimableActor, projection.runId);
  }
  return projection;
}

export async function openPublishedAppSession(
  actor: ExecutionActor,
  input: z.infer<typeof openAppSessionInput>,
) {
  const db = getDb();
  let session = input.sessionId
    ? await findSession(actor, input.sessionId, db)
    : undefined;
  const intent = digest([input.projectId, input.version, input.savedViewId]);
  if (input.sessionId && !session) notFound();
  if (!session) {
    [session] = await db
      .select()
      .from(sessions)
      .where(and(actorSessions(actor), eq(sessions.openId, input.openId)))
      .limit(1);
    if (session && session.openIntent !== intent)
      sessionConflict(
        "session_request_reused",
        "This app session request was already used.",
      );
  }
  if (session) {
    if (
      session.projectId !== input.projectId ||
      (input.version !== "latest" && input.version !== session.releaseId)
    )
      sessionConflict(
        "session_release_mismatch",
        "This app session belongs to a different published version.",
      );
    return getPublishedAppSession(actor, appSessionRef(session));
  }

  const access = await appAccess(actor, input.projectId, db);
  if (!access)
    fail("This project is unavailable.", {
      statusCode: 404,
      errorCode: "project_not_found",
    });
  const saved = input.savedViewId
    ? await readSavedView(actor, input.projectId, input.savedViewId)
    : null;
  if (
    saved &&
    input.version !== "latest" &&
    saved.session.releaseId !== input.version
  )
    sessionConflict(
      "session_release_mismatch",
      "This saved view belongs to a different published version.",
    );
  const releaseId =
    saved?.session.releaseId ??
    (input.version === "latest"
      ? access.project.publishedVersionId
      : input.version);
  if (!releaseId) notFound();
  await requireCapability(
    ANALYTICS_CONTROL_IDS.openPublishedApp,
    capabilityScopeRefSchema.parse({
      kind: "release",
      workspaceId: actor.orgId,
      projectId: input.projectId,
      releaseId,
    }),
  );
  const release = await readProjectRelease(db, {
    orgId: actor.orgId,
    projectId: input.projectId,
    releaseId,
  });
  if (access.appOnly && !release) notFound();
  const cache = release ? (await settledDefaultCache(release)).cache : null;
  const scratch =
    !!release &&
    !publishedRefreshNeedsKernel(release.project) &&
    (release.project.appLayout?.settings.scratchOnLoad === true ||
      saved !== null);
  const savedOverrides = saved?.view.overrides ?? {};
  const initial = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(sessions)
      .values({
        id: randomUUID(),
        orgId: actor.orgId,
        ownerEmail: actor.ownerEmail,
        projectId: input.projectId,
        releaseId,
        openId: input.openId,
        openIntent: intent,
        overrides: savedOverrides,
        baselineGeneration: cache?.generation ?? 0n,
        baseline: cache?.results ?? [],
        baselineRefreshedAt: cache?.refreshedAt ?? null,
        refreshedAt: scratch ? null : (cache?.refreshedAt ?? null),
        pendingInputIds: [],
      })
      .onConflictDoNothing()
      .returning();
    if (!inserted) {
      const [prior] = await tx
        .select()
        .from(sessions)
        .where(and(actorSessions(actor), eq(sessions.openId, input.openId)))
        .limit(1);
      if (!prior || prior.openIntent !== intent)
        sessionConflict(
          "session_request_reused",
          "This app session request was already used.",
        );
      return { row: prior, runId: null };
    }
    if (!release) return { row: inserted, runId: null };
    if (!scratch) {
      await seedSessionBaseline(
        tx,
        inserted,
        release.project,
        inserted.baseline,
      );
      return { row: inserted, runId: null };
    }
    const run = await fullSessionRun(
      tx,
      actor,
      inserted,
      release,
      input.openId,
      "reuse",
    );
    await tx
      .update(sessions)
      .set({ runId: run.runId })
      .where(eq(sessions.id, inserted.id));
    return { row: inserted, runId: run.runId };
  });
  if (initial.runId) wakeNotebookRun(actor, initial.runId);
  if (
    !scratch &&
    release?.project.appLayout?.settings.autoRefresh !== false &&
    release &&
    !publishedRefreshNeedsKernel(release.project) &&
    cache?.refreshedAt &&
    ageStatus(cache.refreshedAt, release.project.appLayout?.settings) ===
      "stale"
  )
    await startDefaultRun(actor, access, release);
  await recordProjectView(
    actor,
    input.projectId,
    actor.ownerEmail,
    "app",
    initial.row.id,
  ).catch((error: unknown) => {
    console.error("Could not record project view", error);
  });
  return getPublishedAppSession(actor, appSessionRef(initial.row));
}

function appSessionRef(session: Session): SessionRef {
  return {
    sessionId: appSessionIdSchema.parse(session.id),
    releaseId: releaseIdSchema.parse(session.releaseId),
  };
}

function zodInputValue(
  cell: Extract<ExecutionCell["contents"], { kind: "input" }>,
  serialized: string,
) {
  try {
    return inputValueFromControl(cell, serialized);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return null;
    throw error;
  }
}

function validateValue(
  cell: Extract<ExecutionCell["contents"], { kind: "input" }>,
  value: InputValue,
) {
  const canonical =
    value.kind === "list"
      ? { ...value, items: [...new Set(value.items)] }
      : value;
  const serialized = serializeInputValue(canonical);
  const parsed = zodInputValue(cell, serialized);
  if (!parsed || digest(parsed) !== digest(canonical))
    fail("This input value is invalid.", {
      statusCode: 422,
      errorCode: "input_value_invalid",
    });
  if (
    canonical.kind === "number" &&
    cell.inputType === "SLIDER" &&
    cell.sliderOptions &&
    (canonical.value < cell.sliderOptions.min ||
      canonical.value > cell.sliderOptions.max)
  )
    fail("This input value is outside the slider range.", {
      statusCode: 422,
      errorCode: "input_value_invalid",
    });
  try {
    inputBinding({ ...cell, defaultValueString: serialized });
  } catch (error) {
    if (!(error instanceof SqlBindingError)) throw error;
    fail("This option is not allowed.", {
      statusCode: 422,
      errorCode: "input_option_not_allowed",
    });
  }
  return canonical;
}

function affectedCells(cells: ExecutionCell[], inputs: readonly CellId[]) {
  const affected = new Set(inputs);
  for (const { cell, dependencies } of notebookGraph(cells))
    if (dependencies.some(({ cellId }) => affected.has(cellId)))
      affected.add(cell.id);
  for (const id of inputs) affected.delete(id);
  return [...affected];
}

async function readReceipt(
  tx: Queryable,
  sessionId: string,
  requestId: string,
  intent: string,
) {
  const [row] = await tx
    .select()
    .from(receipts)
    .where(
      and(eq(receipts.sessionId, sessionId), eq(receipts.requestId, requestId)),
    )
    .limit(1);
  if (row && row.intent !== intent)
    sessionConflict(
      "session_request_reused",
      "This app session request was already used.",
    );
  return row?.receipt;
}

type SetInputs = z.infer<typeof setAppInputsInput>;
type Reset = z.infer<typeof resetAppSessionInput>;

export async function mutatePublishedAppInputs(
  actor: ExecutionActor,
  input: SetInputs | Reset,
): Promise<AppSessionOperation> {
  const db = getDb();
  const initial = await scopedSession(actor, input);
  const { release, document } = initial;
  const visibleIds = initial.access.appOnly ? appViewerCellIds(document) : null;
  const visibleReceipt = (receipt: AppSessionOperation) =>
    visibleIds
      ? {
          ...receipt,
          effectiveValues: Object.fromEntries(
            Object.entries(receipt.effectiveValues).filter(([id]) =>
              visibleIds.has(id),
            ),
          ),
          changedInputIds: receipt.changedInputIds.filter((id) =>
            visibleIds.has(id),
          ),
          affectedCellIds: receipt.affectedCellIds.filter((id) =>
            visibleIds.has(id),
          ),
        }
      : receipt;
  if (!release) notFound();
  const intent = digest(["inputs", input]);
  const previous = await readReceipt(
    db,
    input.sessionId,
    input.requestId,
    intent,
  );
  if (previous)
    return visibleReceipt(appSessionOperationOutput.parse(previous));
  const cells = releaseCells(document);
  const dynamic = new Map<CellId, ResultId>();
  const values: AppInputValues = {};
  for (const update of "updates" in input ? input.updates : []) {
    if (visibleIds && !visibleIds.has(update.inputCellId)) notFound();
    const contents = cells.find(
      ({ id }) => id === update.inputCellId,
    )?.contents;
    if (contents?.kind !== "input") notFound();
    const value = validateValue(contents, update.value);
    const options = contents.dynamicOptions;
    if (options) {
      if (!update.optionsResultId)
        sessionConflict(
          "input_options_changed",
          "The available input options changed. Try again.",
        );
      const choices = await readNotebookResultChoices(
        actor,
        update.optionsResultId,
        options.valueFieldId,
        options.displayFieldId,
        { sessionId: input.sessionId },
      );
      if (choices.status !== "ready")
        sessionConflict(
          "input_options_changed",
          "The available input options changed. Try again.",
        );
      const selected =
        value.kind === "list"
          ? value.items
          : value.kind === "null"
            ? []
            : [serializeInputValue(value)];
      if (
        selected.some(
          (item) => !choices.values.some((choice) => choice.value === item),
        )
      )
        fail("This option is not allowed.", {
          statusCode: 422,
          errorCode: "input_option_not_allowed",
        });
      dynamic.set(
        notebookCellIdSchema.parse(options.producerCellId),
        update.optionsResultId,
      );
    }
    values[update.inputCellId] = value;
  }
  const result = await db.transaction(
    async (tx): Promise<AppSessionOperation> => {
      const pointers = await lockNotebookRunOutputs(
        tx,
        sessionNamespace(initial.session).namespaceId,
        cells.map(({ id }) => id),
        true,
      );
      const { session } = await scopedSession(actor, input, tx, true);
      const replay = await readReceipt(tx, session.id, input.requestId, intent);
      if (replay) return appSessionOperationOutput.parse(replay);
      if (session.inputRevision !== BigInt(input.expectedInputRevision))
        sessionConflict(
          "session_input_revision_changed",
          "The app inputs changed. Try again.",
        );
      if (
        [...dynamic].some(
          ([cellId, id]) =>
            pointers.find((row) => row.cellId === cellId)?.resultId !== id,
        )
      )
        sessionConflict(
          "input_options_changed",
          "The available input options changed. Try again.",
        );

      const reset = !("updates" in input);
      const nextOverrides = reset ? {} : { ...session.overrides, ...values };
      const effective = effectiveValues(document, nextOverrides);
      const prior = effectiveValues(document, session.overrides);
      const changedInputIds = Object.keys(effective).flatMap((id) =>
        digest(effective[id]) !== digest(prior[id])
          ? [notebookCellIdSchema.parse(id)]
          : [],
      );
      const receipt = {
        ...appSessionRef(session),
        inputRevision: revisionSchema.parse(String(session.inputRevision)),
        effectiveValues: effective,
        changedInputIds,
        affectedCellIds: affectedCells(cells, changedInputIds),
        state: "unchanged" as AppSessionOperation["state"],
        cursor: revisionSchema.parse(String(session.inputRevision)),
      };
      const changed = digest(nextOverrides) !== digest(session.overrides);
      if (
        changed &&
        !reset &&
        publishedRefreshNeedsKernel(document, new Set(receipt.affectedCellIds))
      )
        publishedKernelUnavailable();
      if (changed || (reset && session.runId)) {
        const next = session.inputRevision + 1n;
        const accepted = {
          ...session,
          inputRevision: next,
          overrides: nextOverrides,
          ...(reset
            ? {
                runId: null,
                pendingInputIds: [],
                refreshedAt: session.baselineRefreshedAt,
              }
            : {}),
        };
        if (reset)
          await seedSessionBaseline(tx, accepted, document, session.baseline);
        await tx
          .update(sessions)
          .set({
            inputRevision: next,
            overrides: accepted.overrides,
            runId: accepted.runId,
            pendingInputIds: accepted.pendingInputIds,
            refreshedAt: accepted.refreshedAt,
          })
          .where(eq(sessions.id, session.id));
        receipt.inputRevision = revisionSchema.parse(String(next));
        receipt.cursor = receipt.inputRevision;
        receipt.state = reset ? "reset" : "stale";
        if (!reset && document.appLayout?.settings.autoRerun !== false) {
          const last = session.runId
            ? await runFor(
                tx,
                session.runId,
                sessionNamespace(session).namespaceId,
              )
            : null;
          const pending =
            last && !terminal(last) ? session.pendingInputIds : [];
          const targets = [...new Set([...changedInputIds, ...pending])];
          const [first] = targets;
          const affected = affectedCells(cells, targets);
          if (first && affected.length) {
            const executable = releaseCells(document, nextOverrides);
            const snapshot = executionSnapshot(
              release,
              sessionNamespace(session),
              next,
              executable,
            );
            const run = admitted(
              await notebookRunStore.admit(
                actor,
                runRequestSchema.parse({
                  snapshot,
                  requestId: input.requestId,
                  mode: "downstream",
                  targetCellId: first,
                  cache: "reuse",
                  staleValues: "reject",
                }),
                { inputCellIds: targets },
                tx,
              ),
            );
            await tx
              .update(sessions)
              .set({
                runId: run.runId,
                pendingInputIds: targets,
              })
              .where(eq(sessions.id, session.id));
            receipt.state = "queued";
            receipt.affectedCellIds = affected;
            const completed: AppSessionOperation = {
              ...receipt,
              runId: run.runId,
            };
            await tx.insert(receipts).values({
              sessionId: session.id,
              requestId: input.requestId,
              intent,
              receipt: completed,
            });
            return completed;
          }
        }
      }
      await tx.insert(receipts).values({
        sessionId: session.id,
        requestId: input.requestId,
        intent,
        receipt,
      });
      return receipt;
    },
  );
  if (result.runId) wakeNotebookRun(actor, result.runId);
  return visibleReceipt(result);
}

export async function refreshPublishedAppResults(
  actor: ExecutionActor,
  input: RefreshRequest,
): Promise<AppSessionRefresh> {
  const db = getDb();
  const initial = await scopedSession(actor, input);
  const { release } = initial;
  if (!release) notFound();
  const intent = digest(["refresh", input]);
  const previous = await readReceipt(
    db,
    input.sessionId,
    input.requestId,
    intent,
  );
  if (previous) return refreshAppResultsOutput.parse(previous);
  if (publishedRefreshNeedsKernel(release.project))
    publishedKernelUnavailable();
  if (input.scope === "default") {
    if (!initial.access.canRefreshDefault)
      fail("You don’t have permission to refresh this app for all viewers.", {
        statusCode: 403,
        errorCode: "capability_denied",
      });
    const refreshed = await startDefaultRun(
      actor,
      initial.access,
      release,
      input,
    );
    if (!refreshed)
      sessionConflict("app_cache_changed", "The app cache changed. Try again.");
    return refreshed;
  }
  const receipt = await db.transaction(async (tx) => {
    await lockNotebookRunOutputs(
      tx,
      sessionNamespace(initial.session).namespaceId,
      releaseCells(release.project).map(({ id }) => id),
      true,
    );
    const { session } = await scopedSession(actor, input, tx, true);
    const replay = await readReceipt(tx, session.id, input.requestId, intent);
    if (replay) return refreshAppResultsOutput.parse(replay);
    const run = await fullSessionRun(
      tx,
      actor,
      session,
      release,
      input.requestId,
      input.cachePolicy,
    );
    const value = {
      runId: run.runId,
      cursor: revisionSchema.parse(String(session.inputRevision)),
    };
    await tx
      .update(sessions)
      .set({ runId: run.runId, pendingInputIds: [] })
      .where(eq(sessions.id, session.id));
    await tx.insert(receipts).values({
      sessionId: session.id,
      requestId: input.requestId,
      intent,
      receipt: value,
    });
    return value;
  });
  wakeNotebookRun(actor, receipt.runId);
  return receipt;
}

async function readSavedView(
  actor: ExecutionActor,
  projectId: string,
  savedViewId: string,
) {
  const [row] = await getDb()
    .select({ view: views, session: sessions })
    .from(views)
    .innerJoin(sessions, eq(sessions.id, views.sessionId))
    .where(
      and(
        eq(views.id, savedViewId),
        eq(sessions.projectId, projectId),
        actorSessions(actor),
      ),
    )
    .limit(1);
  if (!row) notFound();
  return row;
}

export async function savePublishedAppView(
  actor: ExecutionActor,
  input: z.infer<typeof saveAppViewInput>,
) {
  return getDb().transaction(async (tx) => {
    const { session, release } = await scopedSession(actor, input, tx, true);
    if (!release) notFound();
    const intent = digest(input);
    const [previous] = await tx
      .select()
      .from(views)
      .where(
        and(
          eq(views.sessionId, session.id),
          eq(views.requestId, input.requestId),
        ),
      )
      .limit(1);
    if (previous) {
      if (previous.intent !== intent)
        sessionConflict(
          "session_request_reused",
          "This app session request was already used.",
        );
      return previous.receipt;
    }
    if (session.inputRevision !== BigInt(input.expectedInputRevision))
      sessionConflict(
        "session_input_revision_changed",
        "The app inputs changed. Try again.",
      );
    const savedViewId = randomUUID();
    const receipt = {
      savedViewId,
      releaseId: input.releaseId,
      name: input.name,
      href: `/app/${encodeURIComponent(session.projectId)}/${encodeURIComponent(session.releaseId)}?savedViewId=${savedViewId}`,
    };
    await tx.insert(views).values({
      id: savedViewId,
      sessionId: session.id,
      requestId: input.requestId,
      intent,
      overrides: session.overrides,
      receipt,
    });
    return receipt;
  });
}
