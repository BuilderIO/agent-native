import { randomUUID } from "node:crypto";

import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm";

import {
  cellRunReceiptSchema,
  runEventSchema,
  runReceiptSchema,
  type AttemptIdentity,
  type CellRunReceipt,
  type RunAdmission,
  type RunCancellation,
  type RunEvent,
  type RunInvalidation,
  type RunRequest,
} from "../../../shared/notebook-execution.js";
import {
  completeResultManifestSchema,
  resultManifestSchema,
  type AuthorizedResultRef,
  type CompleteResultManifest,
} from "../../../shared/notebook-result-contract.js";
import {
  workspaceIdSchema,
  type NotebookCommandImpact,
} from "../../../shared/notebook-snapshot-contract.js";
import { getDb, schema } from "../../db/index.js";
import {
  MAX_RESULT_SEGMENTS,
  type StagedSegment,
} from "../../execution/notebook-arrow.js";
import { readKernelNamespace } from "../kernel-namespaces.js";
import type { Queryable } from "../scope.js";
import {
  digest,
  executionContents,
  executionSource,
  matchesExecutionSignature,
  notebookGraph,
  planRun,
  selectionGraph,
  type AvailableResult,
  type CellId,
  type ExecutionCell,
  type StoredPlan,
} from "./planner.js";
import { consumeReactiveInputs, pendingReactiveInputs } from "./reactive.js";
import {
  notebookOutputs as outputs,
  notebookResultManifests as manifests,
  notebookResultSegments as segments,
  notebookRunAttempts as attempts,
  notebookRunEvents as events,
  notebookRuns as runs,
  notebookRunWork as work,
  type RunDiagnostic,
  type KernelPresentation,
  type KernelVariableState,
} from "./schema.js";
import {
  MAX_NOTEBOOK_CELLS,
  type ExecutionActor,
  type SnapshotLoad,
  type SnapshotReader,
} from "./snapshot.js";

type Run = typeof runs.$inferSelect;
type Work = typeof work.$inferSelect;
type Output = typeof outputs.$inferSelect;
type State = CellRunReceipt["state"];
export type RunEntry = {
  executor?: "browser";
  reactive?: true;
  selection?: { from: number; to: number };
  inputCellIds?: CellId[];
  reviewTargets?: string[];
  cacheDonor?: string;
  newTableCell?: true;
  previewPins?: NonNullable<StoredPlan["previewPins"]>;
};
type RunAccessRefusal = Exclude<
  RunAdmission,
  { status: "admitted" | "rejected" }
>;
type AuthorizeTarget = (
  snapshot: RunRequest["snapshot"],
  cellId: CellId,
  contents: Extract<ExecutionCell["contents"], { kind: "sql" }>,
) => Promise<RunAccessRefusal | null>;
export type ResultArtifact = Omit<typeof manifests.$inferInsert, "id">;
export type KernelPromotion = {
  presentation: KernelPresentation;
  artifacts: ResultArtifact[];
  variables?: KernelVariableState;
};
export type Claim = {
  run: Run;
  work: Work;
  attempt: AttemptIdentity;
  dependencies: CompleteResultManifest[];
};
const LEASE_MS = 90_000;
const BROWSER_RUN_LEASE_MS = 15 * 60_000;
const absent = { status: "absent", reason: "not_found" } as const;
const failed: State = { status: "failed", reason: "execution_failed" };

function outputKey(namespaceId: string, cellId: CellId) {
  return and(eq(outputs.namespaceId, namespaceId), eq(outputs.cellId, cellId));
}

export async function lockNotebookRunOutputs(
  tx: Queryable,
  namespaceId: string,
  ids: CellId[],
  create = false,
) {
  const cells = [...new Set(ids)].sort();
  if (!cells.length) return [];
  if (create)
    await tx
      .insert(outputs)
      .values(
        cells.map((cellId) => ({
          namespaceId,
          cellId,
          generation:
            cellRunReceiptSchema.shape.attempt.shape.outputGeneration.parse(
              randomUUID(),
            ),
        })),
      )
      .onConflictDoNothing();
  return tx
    .select()
    .from(outputs)
    .where(
      and(eq(outputs.namespaceId, namespaceId), inArray(outputs.cellId, cells)),
    )
    .orderBy(asc(outputs.cellId))
    .limit(cells.length)
    .for("update");
}

async function readRun(
  db: Queryable,
  actor: ExecutionActor,
  id: string,
  lock = false,
) {
  const query = db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.id, runReceiptSchema.shape.runId.parse(id)),
        eq(runs.orgId, actor.orgId),
        eq(runs.ownerEmail, actor.ownerEmail),
      ),
    )
    .limit(1);
  const [run] = await (lock ? query.for("update") : query);
  return run;
}

function runActor(run: Run): ExecutionActor {
  return { orgId: run.orgId, ownerEmail: run.ownerEmail, caller: run.caller };
}

function identity(run: Run, item: Work): AttemptIdentity {
  return cellRunReceiptSchema.shape.attempt.parse({
    namespaceId: run.namespaceId,
    runId: run.id,
    cellId: item.cellId,
    attemptId: item.attemptId,
    outputGeneration: item.generation,
  });
}

async function append(tx: Queryable, run: Run, event: RunEvent["event"]) {
  const sequence = run.sequence + 1n;
  const value = runEventSchema.parse({
    runId: run.id,
    sequence: sequence.toString(),
    event,
  });
  await tx.insert(events).values({ runId: run.id, sequence, event: value });
  await tx.update(runs).set({ sequence }).where(eq(runs.id, run.id));
  run.sequence = sequence;
}

async function setAttempt(
  tx: Queryable,
  run: Run,
  attempt: AttemptIdentity,
  state: State,
  terminal: boolean,
  startedAt?: string,
) {
  const receipt = { attempt, state };
  await tx
    .update(attempts)
    .set({
      receipt,
      terminal,
      finishedAt: terminal ? new Date().toISOString() : null,
      ...(startedAt ? { startedAt } : {}),
    })
    .where(eq(attempts.id, attempt.attemptId));
  await append(tx, run, { type: "attempt", receipt });
}

function matchesPointer(pointer: Output | undefined, item: Work) {
  return (
    pointer?.generation === item.generation &&
    pointer.attemptId === item.attemptId
  );
}

function outputResult(pointer: Output | undefined) {
  return pointer?.resultId ?? pointer?.dependencyResultId;
}

function sameClaim(
  current: Work | undefined,
  claimed: Work,
  now: number,
): current is Work {
  return (
    current !== undefined &&
    !current.done &&
    current.attemptId === claimed.attemptId &&
    current.generation === claimed.generation &&
    current.leaseUntil !== null &&
    current.leaseUntil > now
  );
}

function workId(item: Work) {
  return eq(work.submissionId, item.submissionId);
}

async function verifiedCoverage(
  tx: Queryable,
  artifactId: string | null | undefined,
  coverage: string,
  submissionId?: string,
) {
  if (!artifactId) return coverage === "0";
  const rows = await tx
    .select({
      startRow: segments.startRow,
      rowCount: segments.rowCount,
      verified: segments.verified,
      submissionId: segments.submissionId,
    })
    .from(segments)
    .where(eq(segments.artifactId, artifactId))
    .orderBy(asc(segments.startRow))
    .limit(MAX_RESULT_SEGMENTS + 1);
  let next = 0;
  return (
    rows.length <= MAX_RESULT_SEGMENTS &&
    rows.every((row) => {
      if (
        !row.verified ||
        row.startRow !== next ||
        (submissionId && row.submissionId !== submissionId)
      )
        return false;
      next += row.rowCount;
      return true;
    }) &&
    String(next) === coverage
  );
}

async function readManifest(
  tx: Queryable,
  id: CompleteResultManifest["result"]["resultId"],
) {
  const [row] = await tx
    .select()
    .from(manifests)
    .where(eq(manifests.id, id))
    .limit(1);
  if (!row) throw new Error("Notebook result pointer is unreadable");
  const parsed = completeResultManifestSchema.safeParse(row.manifest);
  return parsed.success ? parsed.data : undefined;
}

function liveRunGraph(loaded: SnapshotLoad, run: Run) {
  if (loaded.status !== "accepted") return null;
  const { cells, snapshot } = loaded.value;
  const { request } = run.receipt;
  if (
    snapshot.ref.head.versionId !== request.snapshot.ref.head.versionId ||
    (snapshot.namespace.kind !== "draft" &&
      snapshot.inputRevision !== request.snapshot.inputRevision)
  )
    return null;
  if (run.plan.selection && request.mode !== "run-all")
    return selectionGraph(cells, request.targetCellId, run.plan.selection);
  return notebookGraph(cells);
}

export async function readProducingPlans(
  tx: Queryable,
  actor: ExecutionActor,
  ids: Run["id"][],
  scope: boolean | { namespaceId: string } = false,
) {
  if (ids.length === 0) return new Map<Run["id"], StoredPlan>();
  const rows = await tx
    .select({ id: runs.id, plan: runs.plan })
    .from(runs)
    .where(
      and(
        eq(runs.orgId, actor.orgId),
        typeof scope === "object"
          ? eq(runs.namespaceId, scope.namespaceId)
          : scope
            ? undefined
            : eq(runs.ownerEmail, actor.ownerEmail),
        inArray(runs.id, ids),
      ),
    )
    .limit(ids.length);
  return new Map(rows.map(({ id, plan }) => [id, plan]));
}

export function createRunStore(
  load: SnapshotReader,
  authorizeTarget?: AuthorizeTarget,
) {
  async function admit(
    actor: ExecutionActor,
    request: RunRequest,
    entry?: RunEntry,
    transaction?: Queryable,
  ): Promise<RunAdmission> {
    const { snapshot, requestId } = request;
    const { namespaceId } = snapshot.namespace;
    const releaseSession = snapshot.namespace.kind === "release-session";
    if (
      entry?.inputCellIds &&
      (!releaseSession || request.mode !== "downstream")
    )
      return { status: "rejected", reason: "unsupported_request" };
    const accepted = await load(actor, snapshot, transaction);
    switch (accepted.status) {
      case "absent":
        return absent;
      case "denied":
        return { status: "denied", reason: "access_denied" };
      case "pending":
        return { status: "pending", reason: "not_ready" };
      case "unreadable":
        return { status: "unreadable", reason: "read_failed" };
      case "accepted":
        break;
    }
    const acceptedSnapshot = accepted.value;
    const intent = digest(entry ? [request, entry] : request);
    const target =
      request.mode === "run-all"
        ? undefined
        : acceptedSnapshot.cells.find(({ id }) => id === request.targetCellId);
    if (
      entry?.newTableCell &&
      (!transaction ||
        request.mode !== "cell-only" ||
        target?.contents.kind !== "sql" ||
        !target.contents.warehouseTable)
    )
      return { status: "rejected", reason: "unsupported_request" };
    const browser = entry?.executor === "browser";
    if (
      browser &&
      (snapshot.namespace.kind !== "draft" ||
        request.mode !== "cell-only" ||
        (!(
          target?.contents.kind === "code" &&
          target.contents.language === "python"
        ) &&
          !(
            target?.contents.kind === "sql" &&
            target.contents.connectionMode === "dataframes"
          )))
    )
      return { status: "rejected", reason: "unsupported_request" };
    const refusal =
      authorizeTarget &&
      target?.contents.kind === "sql" &&
      digest(acceptedSnapshot.snapshot) === digest(snapshot)
        ? await authorizeTarget(snapshot, target.id, target.contents)
        : null;
    const reserve = async (tx: Queryable): Promise<RunAdmission> => {
      if (refusal) return (await replay()) ?? refusal;
      const locked = await lockNotebookRunOutputs(
        tx,
        namespaceId,
        entry?.newTableCell && target
          ? [target.id]
          : acceptedSnapshot.cells.map(({ id }) => id),
        true,
      );
      const latest = await load(actor, snapshot, tx);
      if (latest.status !== "accepted")
        return { status: "rejected", reason: "stale_snapshot" };
      const existing = await replay();
      if (existing) return existing;
      if (digest(latest.value.snapshot) !== digest(snapshot))
        return { status: "rejected", reason: "stale_snapshot" };
      const graph = notebookGraph(latest.value.cells);
      const restart = request.mode === "run-all" && request.restart;
      if (
        restart &&
        latest.value.cells.some(
          ({ contents }) =>
            contents.kind === "code" ||
            (contents.kind === "sql" &&
              contents.connectionMode === "dataframes"),
        )
      )
        return { status: "rejected", reason: "unsupported_request" };
      let selection: StoredPlan["selection"];
      let executionGraph = graph;
      if (entry?.selection && request.mode !== "run-all") {
        const target = graph.find(
          ({ cell }) => cell.id === request.targetCellId,
        );
        if (!target)
          return { status: "rejected", reason: "unsupported_request" };
        selection = {
          ...entry.selection,
          sourceSignature: digest(executionContents(target.cell.contents)),
        };
        const selected = selectionGraph(
          latest.value.cells,
          request.targetCellId,
          selection,
        );
        if (!selected)
          return { status: "rejected", reason: "unsupported_request" };
        executionGraph = selected;
      }
      let reactiveInputCellIds = entry?.inputCellIds;
      if (entry?.reactive) {
        const { projectId, head } = snapshot.ref;
        const pending = await pendingReactiveInputs(
          tx,
          projectId,
          head.versionId,
        );
        if (!pending || !latest.settings?.autoRerun)
          return { status: "rejected", reason: "unsupported_request" };
        reactiveInputCellIds = graph.flatMap(({ cell }) =>
          cell.contents.kind === "input" &&
          pending.inputCellIds.includes(cell.id)
            ? [cell.id]
            : [],
        );
      }
      const available = new Map<CellId, AvailableResult>();
      const currentResults = new Map(
        locked.map((row) => [row.cellId, outputResult(row)]),
      );
      const signatures = new Map(graph.map((node) => [node.cell.id, node]));
      const resultIds = restart
        ? []
        : [
            ...new Set(
              locked.flatMap((row) => {
                const resultId = outputResult(row);
                return resultId ? [resultId] : [];
              }),
            ),
          ];
      const stored = resultIds.length
        ? await tx
            .select({ id: manifests.id, manifest: manifests.manifest })
            .from(manifests)
            .where(inArray(manifests.id, resultIds))
            .limit(resultIds.length)
        : [];
      if (stored.length !== resultIds.length)
        return { status: "unreadable", reason: "read_failed" };
      const byId = new Map<string, ResultArtifact["manifest"]>();
      for (const { id, manifest } of stored) {
        const parsed = resultManifestSchema.safeParse(manifest);
        if (!parsed.success)
          return { status: "unreadable", reason: "read_failed" };
        byId.set(id, parsed.data);
      }
      const producingPlans = await readProducingPlans(
        tx,
        actor,
        [
          ...new Set(
            [...byId.values()].map(({ result }) => result.producer.runId),
          ),
        ],
        releaseSession,
      );
      const kernel = graph.some(({ cell }) => cell.contents.kind === "code")
        ? await readKernelNamespace(
            {
              workspaceId: snapshot.ref.workspaceId,
              principalId: actor.ownerEmail,
              email: actor.ownerEmail,
            },
            namespaceId,
            tx,
          )
        : undefined;
      const previewPins = new Map(
        entry?.previewPins?.map(({ cellId, resultId }) => [cellId, resultId]),
      );

      for (const row of locked) {
        const resultId = outputResult(row);
        if (!resultId || restart) continue;
        const result = completeResultManifestSchema.safeParse(
          byId.get(resultId),
        );
        const node = signatures.get(row.cellId);
        if (result.success && node) {
          const { data: manifest } = result;
          const signature = row.resultId
            ? row.signature
            : row.dependencySignature;
          const prior = producingPlans
            .get(manifest.result.producer.runId)
            ?.cells.find(({ cell }) => cell.id === node.cell.id);
          const currentContents = node.cell.contents;
          available.set(row.cellId, {
            manifest,
            compatible:
              previewPins.get(row.cellId) === resultId ||
              (manifest.result.snapshot.head.versionId ===
                snapshot.ref.head.versionId &&
                (snapshot.namespace.kind === "draft" ||
                  (releaseSession && signature === node.signature) ||
                  manifest.result.inputRevision === snapshot.inputRevision) &&
                !!prior &&
                digest(executionSource(prior.cell.contents)) ===
                  digest(executionSource(currentContents)) &&
                (node.cell.contents.kind !== "code" ||
                  manifest.result.provenance === "browser" ||
                  (!!kernel &&
                    kernel.status !== "stopped" &&
                    kernel.status !== "expired" &&
                    manifest.result.producer.namespaceId === namespaceId &&
                    manifest.result.kernelGeneration ===
                      String(kernel.generation)))),
            fresh:
              matchesExecutionSignature(
                node,
                signature,
                snapshot.namespace.kind === "draft" ? prior : undefined,
                (cellId) => signatures.get(cellId)?.signature,
              ) &&
              manifest.result.dependencyFingerprint ===
                digest(
                  node.dependencies
                    .filter(({ kind }) => kind !== "input")
                    .map(({ cellId }) => currentResults.get(cellId)),
                ),
          });
        }
      }
      const plan = planRun(executionGraph, request, available, {
        reactiveInputs:
          entry?.reviewTargets?.map((id) =>
            cellRunReceiptSchema.shape.attempt.shape.cellId.parse(id),
          ) ?? reactiveInputCellIds,
        sectionCells: latest.value.sectionCells,
        pinned:
          entry?.previewPins &&
          new Set(entry.previewPins.map(({ cellId }) => cellId)),
      });
      if (entry?.previewPins?.length) plan.previewPins = entry.previewPins;
      if (browser) plan.executor = "browser";
      if (selection) plan.selection = selection;
      if (entry?.cacheDonor) plan.cacheDonor = entry.cacheDonor;
      const runId = runReceiptSchema.shape.runId.parse(randomUUID());
      const reserved = plan.projection.admittedCellIds.map((cellId) =>
        cellRunReceiptSchema.parse({
          attempt: {
            namespaceId,
            runId,
            cellId,
            attemptId: randomUUID(),
            outputGeneration: randomUUID(),
          },
          state: { status: browser ? "running" : "queued" },
        }),
      );
      const receipt = runReceiptSchema.parse({
        status: "admitted",
        runId,
        request,
        startedAt: new Date().toISOString(),
        plan: plan.projection,
        attempts: reserved,
        cursor: String(reserved.length),
      });
      const [run] = await tx
        .insert(runs)
        .values({
          id: runId,
          namespaceId,
          orgId: actor.orgId,
          ownerEmail: actor.ownerEmail,
          caller: actor.caller,
          requestId,
          intent,
          receipt,
          plan,
        })
        .onConflictDoNothing()
        .returning();
      if (!run)
        return (
          (await replay()) ?? {
            status: "rejected",
            reason: "request_id_reused",
          }
        );
      if (
        entry?.reactive ||
        (request.mode === "run-all" && snapshot.namespace.kind === "draft")
      )
        await consumeReactiveInputs(
          tx,
          snapshot.ref.projectId,
          snapshot.ref.head.versionId,
        );
      if (restart)
        await invalidateNotebookRunOutputs(tx, {
          snapshot: snapshot.ref,
          namespace: snapshot.namespace,
          inputRevision: snapshot.inputRevision,
          cause: "kernel-reset",
          outputs: locked.map(({ cellId }) =>
            cellRunReceiptSchema.shape.attempt
              .pick({
                cellId: true,
                outputGeneration: true,
              })
              .parse({ cellId, outputGeneration: randomUUID() }),
          ),
        });
      for (const [ordinal, cell] of reserved.entries()) {
        const { attempt } = cell;
        await tx.insert(attempts).values({
          id: attempt.attemptId,
          runId,
          receipt: cell,
          ...(browser ? { startedAt: receipt.startedAt } : {}),
        });
        await tx.insert(work).values({
          submissionId: randomUUID(),
          runId,
          ordinal,
          cellId: attempt.cellId,
          attemptId: attempt.attemptId,
          generation: attempt.outputGeneration,
          ...(browser ? { leaseUntil: Date.now() + BROWSER_RUN_LEASE_MS } : {}),
        });
        if (!selection)
          await tx
            .update(outputs)
            .set({
              generation: attempt.outputGeneration,
              attemptId: attempt.attemptId,
            })
            .where(outputKey(namespaceId, attempt.cellId));
        await append(tx, run, { type: "attempt", receipt: cell });
      }
      return receipt;

      async function replay() {
        const [prior] = await tx
          .select()
          .from(runs)
          .where(
            and(
              eq(runs.namespaceId, namespaceId),
              eq(runs.requestId, requestId),
            ),
          )
          .limit(1);
        if (!prior) return undefined;
        if (
          prior.ownerEmail === actor.ownerEmail &&
          prior.orgId === actor.orgId &&
          prior.intent === intent
        )
          return prior.receipt;
        return { status: "rejected", reason: "request_id_reused" } as const;
      }
    };
    return transaction ? reserve(transaction) : getDb().transaction(reserve);
  }

  async function read(
    actor: ExecutionActor,
    runId: string,
    after: bigint,
    first: number,
  ) {
    const db = getDb();
    const run = await readRun(db, actor, runId);
    if (!run) return absent;
    const rows = await db
      .select({ event: events.event })
      .from(events)
      .where(
        and(
          eq(events.runId, run.id),
          gt(events.sequence, after),
          lte(events.sequence, run.sequence),
        ),
      )
      .orderBy(asc(events.sequence))
      .limit(first);
    const pending = await db
      .select({ attemptId: work.attemptId, build: work.resultBuild })
      .from(work)
      .where(and(eq(work.runId, run.id), eq(work.done, false)))
      .limit(MAX_NOTEBOOK_CELLS);
    const current =
      run.receipt.request.snapshot.namespace.kind === "thread"
        ? await db
            .select({ receipt: attempts.receipt })
            .from(work)
            .innerJoin(attempts, eq(attempts.id, work.attemptId))
            .where(eq(work.runId, run.id))
            .orderBy(asc(work.ordinal))
            .limit(MAX_NOTEBOOK_CELLS)
        : null;
    return {
      status: "found" as const,
      run: current
        ? { ...run.receipt, attempts: current.map(({ receipt }) => receipt) }
        : run.receipt,
      events: rows.map(({ event }) => event),
      building: pending.flatMap(({ attemptId, build }) =>
        build?.result.producer.attemptId === attemptId
          ? [{ attemptId, resultId: build.result.resultId }]
          : [],
      ),
      nextCursor: rows.at(-1)?.event.sequence ?? after.toString(),
    };
  }

  async function beginBrowserCompletion(
    actor: ExecutionActor,
    runId: string,
    attemptId: AttemptIdentity["attemptId"],
    fingerprint: string,
  ): Promise<Claim | "saved" | null> {
    const run = await readRun(getDb(), actor, runId);
    if (run?.plan.executor !== "browser") return null;
    const [cellId] = run.receipt.plan.admittedCellIds;
    if (!cellId) return null;
    return getDb().transaction(async (tx) => {
      const dependencies = run.plan.external;
      const locked = await lockNotebookRunOutputs(tx, run.namespaceId, [
        cellId,
        ...dependencies.map(({ result }) => result.producer.cellId),
      ]);
      const accepted = await load(actor, run.receipt.request.snapshot, tx);
      const live = liveRunGraph(accepted, run);
      const node = run.plan.cells.find(({ cell }) => cell.id === cellId);
      if (
        !node ||
        !matchesExecutionSignature(
          live?.find(({ cell }) => cell.id === cellId),
          node.signature,
          node,
          (id) => live?.find(({ cell }) => cell.id === id)?.signature,
        ) ||
        dependencies.some(
          ({ result }) =>
            outputResult(
              locked.find((row) => row.cellId === result.producer.cellId),
            ) !== result.resultId,
        )
      )
        return null;
      const currentRun = await readRun(tx, actor, runId, true);
      if (!currentRun) return null;
      const [item] = await tx
        .select()
        .from(work)
        .where(and(eq(work.runId, run.id), eq(work.attemptId, attemptId)))
        .limit(1)
        .for("update");
      if (
        !item ||
        !matchesPointer(
          locked.find((row) => row.cellId === cellId),
          item,
        )
      )
        return null;
      if (item.operationFingerprint !== null) {
        const [terminal] =
          item.done && item.operationFingerprint === fingerprint
            ? await tx
                .select({ diagnostic: attempts.diagnostic })
                .from(attempts)
                .where(eq(attempts.id, attemptId))
                .limit(1)
            : [];
        return terminal?.diagnostic?.code === "complete" ||
          terminal?.diagnostic?.code === "browser_execution_failed"
          ? "saved"
          : null;
      }
      const now = Date.now();
      if (!sameClaim(item, item, now) || item.cancelRequested) return null;
      await tx
        .update(work)
        .set({
          dispatched: true,
          operationFingerprint: fingerprint,
          leaseUntil: now + LEASE_MS,
        })
        .where(workId(item));
      return {
        run: currentRun,
        work: item,
        attempt: identity(run, item),
        dependencies,
      };
    });
  }

  async function claim(
    actor: ExecutionActor,
    runId: string,
    now?: number,
  ): Promise<Claim | null> {
    const db = getDb();
    const run = await readRun(db, actor, runId);
    if (!run) return null;
    const [next] = await db
      .select()
      .from(work)
      .where(and(eq(work.runId, run.id), eq(work.done, false)))
      .orderBy(asc(work.ordinal))
      .limit(1);
    if (
      !next ||
      (next.leaseUntil !== null && next.leaseUntil > (now ?? Date.now()))
    )
      return null;
    const nextClaim = await db.transaction(async (tx) => {
      const ids = [
        ...run.receipt.plan.admittedCellIds,
        ...run.plan.external.map(({ result }) => result.producer.cellId),
      ];
      const locked = await lockNotebookRunOutputs(tx, run.namespaceId, ids);
      const snapshot = await load(actor, run.receipt.request.snapshot, tx);
      if (snapshot.status === "unreadable" || snapshot.status === "pending")
        return null;
      const currentRun = await readRun(tx, actor, runId, true);
      if (!currentRun) return null;
      const [item] = await tx
        .select()
        .from(work)
        .where(workId(next))
        .limit(1)
        .for("update");
      const claimedAt = now ?? Date.now();
      if (
        !item ||
        item.done ||
        (item.leaseUntil !== null && item.leaseUntil > claimedAt)
      )
        return null;
      if (run.plan.executor === "browser") {
        await finishWork(
          tx,
          currentRun,
          item,
          item.cancelRequested ? { status: "cancelled" } : failed,
          item.cancelRequested ? "cancel_confirmed" : "browser_attempt_expired",
        );
        return null;
      }
      const node = run.plan.cells.find(({ cell }) => cell.id === item.cellId);
      if (!node) throw new Error("Persisted run is missing its cell");
      const pointer = locked.find(({ cellId }) => cellId === item.cellId);
      const live = liveRunGraph(snapshot, run);
      const liveNode = live?.find(({ cell }) => cell.id === item.cellId);
      if (
        (!run.plan.selection && !matchesPointer(pointer, item)) ||
        !matchesExecutionSignature(
          liveNode,
          node.signature,
          run.receipt.request.snapshot.namespace.kind === "draft"
            ? node
            : undefined,
          (id) => live?.find(({ cell }) => cell.id === id)?.signature,
        )
      ) {
        await finishWork(tx, currentRun, item, failed, "superseded");
        return "advanced" as const;
      }
      if (item.cancelRequested && !item.dispatched) {
        await finishWork(
          tx,
          currentRun,
          item,
          { status: "cancelled" },
          "cancel_confirmed",
        );
        return "advanced" as const;
      }
      const dependencies: CompleteResultManifest[] = [];
      for (const dependency of node.dependencies) {
        if (dependency.kind === "input") continue;
        const external = run.plan.external.find(
          ({ result }) => result.producer.cellId === dependency.cellId,
        );
        const source = locked.find(
          ({ cellId }) => cellId === dependency.cellId,
        );
        const [prior] = await tx
          .select()
          .from(work)
          .where(
            and(eq(work.runId, run.id), eq(work.cellId, dependency.cellId)),
          )
          .limit(1);
        const sourceResult = outputResult(source);
        const result =
          source &&
          sourceResult &&
          (prior
            ? prior.done &&
              source.attemptId === prior.attemptId &&
              source.signature ===
                run.plan.cells.find(({ cell }) => cell.id === dependency.cellId)
                  ?.signature
            : sourceResult === external?.result.resultId)
            ? await readManifest(tx, sourceResult)
            : undefined;
        if (
          !result ||
          (prior && result.result.producer.attemptId !== prior.attemptId)
        ) {
          if (!run.plan.selection)
            await tx
              .update(outputs)
              .set({
                resultId: null,
                signature: null,
                dependencyResultId: null,
                dependencySignature: null,
              })
              .where(outputKey(run.namespaceId, item.cellId));
          await finishWork(
            tx,
            currentRun,
            item,
            {
              status: "blocked",
              reason: "cancelled_upstream",
              blockedBy: dependency.cellId,
            },
            "cancelled_upstream",
          );
          return "advanced" as const;
        }
        dependencies.push(result);
      }
      if (item.leaseUntil !== null) {
        await setAttempt(tx, currentRun, identity(run, item), failed, true);
        const receipt = cellRunReceiptSchema.parse({
          attempt: {
            ...identity(run, item),
            attemptId: randomUUID(),
            outputGeneration: randomUUID(),
          },
          state: { status: "running" },
        });
        item.attemptId = receipt.attempt.attemptId;
        item.generation = receipt.attempt.outputGeneration;
        await tx.insert(attempts).values({
          id: item.attemptId,
          runId: run.id,
          receipt,
          startedAt: new Date(claimedAt).toISOString(),
        });
        if (!run.plan.selection)
          await tx
            .update(outputs)
            .set({
              generation: item.generation,
              attemptId: item.attemptId,
            })
            .where(outputKey(run.namespaceId, item.cellId));
        await append(tx, currentRun, { type: "attempt", receipt });
      } else {
        await setAttempt(
          tx,
          currentRun,
          identity(run, item),
          { status: "running" },
          false,
          new Date(claimedAt).toISOString(),
        );
      }
      item.leaseUntil = claimedAt + LEASE_MS;
      await tx
        .update(work)
        .set({
          leaseUntil: item.leaseUntil,
          generation: item.generation,
          attemptId: item.attemptId,
        })
        .where(workId(item));
      return {
        run: currentRun,
        work: item,
        attempt: identity(run, item),
        dependencies,
      };
    });
    return nextClaim === "advanced" ? claim(actor, runId, now) : nextClaim;
  }

  async function renew(
    claimed: Claim,
    now?: number,
    operation?: {
      fingerprint: string;
      build?: NonNullable<Work["resultBuild"]>;
      job?: NonNullable<Work["providerJob"]>;
      restartSpool?: boolean;
      fallbackCode?: string;
      fallbackProvider?: RunDiagnostic["fallbackProvider"];
      dispatch?: RunDiagnostic["dispatch"];
      checkpoint?: NonNullable<Work["checkpoint"]>;
    },
  ) {
    return getDb().transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(work)
        .where(workId(claimed.work))
        .limit(1)
        .for("update");
      const renewedAt = now ?? Date.now();
      if (!sameClaim(current, claimed.work, renewedAt))
        return { status: "lost" } as const;
      if (
        operation &&
        current.operationFingerprint &&
        (operation.fingerprint !== current.operationFingerprint ||
          (operation.job &&
            current.providerJob &&
            digest(operation.job) !== digest(current.providerJob)))
      )
        return { status: "authority-changed" } as const;
      if (operation?.dispatch && !current.cancelRequested) {
        await tx
          .update(attempts)
          .set({
            diagnostic: { code: "dispatched", dispatch: operation.dispatch },
          })
          .where(eq(attempts.id, claimed.attempt.attemptId));
      }
      if (operation?.fallbackCode)
        await addDiagnostic(tx, claimed.attempt.attemptId, {
          code: "dispatched",
          fallbackCode: operation.fallbackCode,
          ...(operation.fallbackProvider
            ? { fallbackProvider: operation.fallbackProvider }
            : {}),
        });
      await tx
        .update(work)
        .set({
          leaseUntil: renewedAt + LEASE_MS,
          dispatched:
            current.dispatched ||
            (operation !== undefined && !current.cancelRequested),
          operationFingerprint:
            current.operationFingerprint ?? operation?.fingerprint ?? null,
          checkpoint: operation?.restartSpool
            ? null
            : (operation?.checkpoint ?? current.checkpoint),
          resultId: operation?.build?.result.resultId ?? current.resultId,
          resultBuild: operation?.build ?? current.resultBuild,
          providerJob: operation?.job ?? current.providerJob,
        })
        .where(workId(current));
      return {
        status: current.cancelRequested ? "cancel" : "continue",
      } as const;
    });
  }

  async function recordSegment(claim: Claim, segment: StagedSegment) {
    return getDb().transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(work)
        .where(workId(claim.work))
        .limit(1)
        .for("update");
      if (
        !sameClaim(current, claim.work, Date.now()) ||
        current.resultBuild?.artifactId !== segment.artifactId ||
        current.submissionId !== segment.submissionId
      )
        return false;
      const inserted = await tx
        .insert(segments)
        .values(segment)
        .onConflictDoNothing()
        .returning({ startRow: segments.startRow });
      if (inserted.length) return true;
      const [existing] = await tx
        .select()
        .from(segments)
        .where(
          and(
            eq(segments.artifactId, segment.artifactId),
            eq(segments.startRow, segment.startRow),
          ),
        )
        .limit(1);
      if (
        !existing?.verified ||
        existing.rowCount !== segment.rowCount ||
        existing.checksum !== segment.checksum
      )
        throw new Error("Notebook result segment changed on retry");
      return false;
    });
  }

  async function finishWork(
    tx: Queryable,
    run: Run,
    item: Work,
    state: State,
    diagnostic: string | RunDiagnostic,
  ) {
    await setAttempt(tx, run, identity(run, item), state, true);
    await addDiagnostic(tx, item.attemptId, diagnostic);
    await tx.update(work).set({ done: true }).where(workId(item));
    if (item.cancelRequested)
      await append(tx, run, {
        type: "cancellation",
        outcome:
          state.status === "cancelled"
            ? { status: "cancelled", reason: "cancel_confirmed" }
            : state.status === "complete"
              ? { status: "completed", reason: "completion_won" }
              : { status: "unknown", reason: "provider_outcome_unknown" },
      });
  }

  async function addDiagnostic(
    tx: Queryable,
    id: AttemptIdentity["attemptId"],
    diagnostic: string | RunDiagnostic,
  ) {
    const value =
      typeof diagnostic === "string" ? { code: diagnostic } : diagnostic;
    await tx
      .update(attempts)
      .set({
        diagnostic: sql`coalesce(${attempts.diagnostic}, '{}'::jsonb) || ${JSON.stringify(value)}::jsonb`,
      })
      .where(eq(attempts.id, id));
  }

  async function finish(
    claimed: Claim,
    outcome:
      | {
          status: "result";
          artifact: ResultArtifact;
          expected: AuthorizedResultRef;
          fallbackCode?: string;
        }
      | ({ status: "failed" | "unknown" | "cancelled" } & Omit<
          RunDiagnostic,
          "dispatch"
        >),
    now?: number,
    kernel?: KernelPromotion,
  ) {
    const { run, attempt } = claimed;
    const actor = runActor(run);
    return getDb().transaction(async (tx) => {
      const dependencyIds = claimed.dependencies.map(
        ({ result }) => result.producer.cellId,
      );
      const locked = await lockNotebookRunOutputs(tx, run.namespaceId, [
        attempt.cellId,
        ...dependencyIds,
      ]);
      const accepted = await load(actor, run.receipt.request.snapshot, tx);
      const currentRun = await readRun(tx, actor, run.id, true);
      const [current] = await tx
        .select()
        .from(work)
        .where(workId(claimed.work))
        .limit(1)
        .for("update");
      if (!currentRun || !sameClaim(current, claimed.work, now ?? Date.now())) {
        await addDiagnostic(tx, attempt.attemptId, "late_completion");
        return false;
      }
      if (accepted.status === "unreadable" || accepted.status === "pending") {
        await addDiagnostic(tx, attempt.attemptId, "snapshot_unreadable");
        return false;
      }
      const node = run.plan.cells.find(
        ({ cell }) => cell.id === attempt.cellId,
      );
      const live = liveRunGraph(accepted, run);
      const liveNode = live?.find(({ cell }) => cell.id === attempt.cellId);
      const pointer = locked.find(({ cellId }) => cellId === attempt.cellId);
      if (
        (!run.plan.selection && !matchesPointer(pointer, current)) ||
        !node ||
        !matchesExecutionSignature(
          liveNode,
          node.signature,
          run.receipt.request.snapshot.namespace.kind === "draft"
            ? node
            : undefined,
          (id) => live?.find(({ cell }) => cell.id === id)?.signature,
        ) ||
        claimed.dependencies.some(
          ({ result }) =>
            !locked.some(
              (row) =>
                row.cellId === result.producer.cellId &&
                outputResult(row) === result.resultId,
            ),
        )
      ) {
        if (outcome.status === "cancelled") {
          const { status: _status, ...diagnostic } = outcome;
          await finishWork(
            tx,
            currentRun,
            current,
            { status: "cancelled" },
            diagnostic,
          );
          return true;
        }
        await finishWork(tx, currentRun, current, failed, "superseded");
        return false;
      }
      if (run.plan.executor === "browser" && current.cancelRequested) {
        await finishWork(
          tx,
          currentRun,
          current,
          { status: "cancelled" },
          "cancel_confirmed",
        );
        return false;
      }
      const generation =
        kernel?.presentation.generation ??
        (outcome.status === "result"
          ? outcome.expected.kernelGeneration
          : null);
      if (generation !== null) {
        const binding = await readKernelNamespace(
          {
            workspaceId: workspaceIdSchema.parse(actor.orgId),
            principalId: actor.ownerEmail,
            email: actor.ownerEmail,
          },
          attempt.namespaceId,
          tx,
          true,
        );
        if (
          !binding ||
          String(binding.generation) !== generation ||
          binding.lineageId !==
            run.receipt.request.snapshot.ref.head.versionId ||
          binding.status === "expired" ||
          binding.status === "stopped"
        ) {
          await finishWork(
            tx,
            currentRun,
            current,
            failed,
            "kernel_generation_changed",
          );
          return false;
        }
      }

      const bindings = claimed.dependencies.map(({ result }) => result);
      async function persistPresentation() {
        if (!kernel) return;
        for (const extra of kernel.artifacts) {
          const checked = completeResultManifestSchema.parse(extra.manifest);
          if (
            checked.result.kernelGeneration !== generation ||
            digest(checked.result.producer) !==
              digest({
                ...attempt,
                exportId: checked.result.producer.exportId,
              }) ||
            digest(checked.result.snapshot) !==
              digest(run.receipt.request.snapshot.ref) ||
            checked.result.inputRevision !==
              run.receipt.request.snapshot.inputRevision ||
            checked.result.dependencyFingerprint !==
              digest(bindings.map(({ resultId }) => resultId)) ||
            digest(extra.authorities) !==
              digest(kernel.presentation.authorities) ||
            !(await verifiedCoverage(
              tx,
              extra.artifactId,
              checked.rowCount,
              claimed.work.submissionId,
            ))
          )
            throw new Error("Notebook kernel display artifact is invalid");
          await tx
            .insert(manifests)
            .values({ ...extra, bindings, id: checked.result.resultId });
        }
        await tx
          .update(attempts)
          .set({ kernelPresentation: kernel.presentation })
          .where(eq(attempts.id, attempt.attemptId));
        if (kernel.variables)
          await tx
            .update(schema.kernelNamespaces)
            .set({ variableState: kernel.variables })
            .where(eq(schema.kernelNamespaces.id, attempt.namespaceId));
      }
      if (outcome.status !== "result") {
        const state: State =
          outcome.status === "cancelled"
            ? { status: "cancelled" }
            : outcome.status === "unknown"
              ? { status: "failed", reason: "provider_outcome_unknown" }
              : failed;
        if (
          !run.plan.selection &&
          (outcome.status === "failed" || node.cell.contents.kind === "code")
        )
          await tx
            .update(outputs)
            .set({
              ...(outcome.status === "failed"
                ? { resultId: null, signature: null }
                : {}),
              dependencyResultId: null,
              dependencySignature: null,
            })
            .where(outputKey(run.namespaceId, attempt.cellId));
        const { status: _status, ...diagnostic } = outcome;
        await persistPresentation();
        await finishWork(tx, currentRun, current, state, diagnostic);
        return true;
      }
      const artifact = resultManifestSchema.safeParse(
        outcome.artifact.manifest,
      );
      if (
        !artifact.success ||
        artifact.data.status === "pending" ||
        digest(artifact.data.result) !== digest(outcome.expected) ||
        digest(artifact.data.result.producer) !==
          digest({
            ...attempt,
            exportId: artifact.data.result.producer.exportId,
          }) ||
        digest(artifact.data.result.snapshot) !==
          digest(run.receipt.request.snapshot.ref) ||
        artifact.data.result.inputRevision !==
          run.receipt.request.snapshot.inputRevision ||
        artifact.data.result.dependencyFingerprint !==
          digest(claimed.dependencies.map(({ result }) => result.resultId))
      ) {
        await finishWork(tx, currentRun, current, failed, "invalid_manifest");
        return false;
      }
      const coverage =
        artifact.data.status === "incomplete"
          ? artifact.data.verifiedRowCount
          : artifact.data.rowCount;
      if (
        !(await verifiedCoverage(tx, outcome.artifact.artifactId, coverage))
      ) {
        await finishWork(
          tx,
          currentRun,
          current,
          failed,
          "invalid_artifact_coverage",
        );
        return false;
      }
      if (
        outcome.artifact.artifactId &&
        (current.resultId !== artifact.data.result.resultId ||
          !current.resultBuild ||
          digest(current.resultBuild.result) !== digest(artifact.data.result) ||
          digest(current.resultBuild.authorities) !==
            digest(outcome.artifact.authorities))
      ) {
        await finishWork(
          tx,
          currentRun,
          current,
          failed,
          "invalid_artifact_provenance",
        );
        return false;
      }
      const id = artifact.data.result.resultId;
      await tx.insert(manifests).values({ ...outcome.artifact, bindings, id });
      await persistPresentation();
      if (!run.plan.selection)
        await tx
          .update(outputs)
          .set({
            resultId: id,
            signature: node.signature,
            ...(artifact.data.status !== "incomplete"
              ? { dependencyResultId: id, dependencySignature: node.signature }
              : { dependencyResultId: null, dependencySignature: null }),
          })
          .where(outputKey(run.namespaceId, attempt.cellId));
      await finishWork(
        tx,
        currentRun,
        current,
        {
          status: "complete",
          resultIds: [
            id,
            ...(kernel?.artifacts.map(
              ({ manifest }) => manifest.result.resultId,
            ) ?? []),
          ],
        },
        {
          code:
            artifact.data.status === "incomplete"
              ? "result_incomplete"
              : "complete",
          ...(outcome.fallbackCode
            ? { fallbackCode: outcome.fallbackCode }
            : {}),
        },
      );
      return true;
    });
  }

  async function cancel(
    actor: ExecutionActor,
    runId: string,
    cellId?: CellId,
    transaction?: Queryable,
  ): Promise<RunCancellation> {
    const execute = async (tx: Queryable): Promise<RunCancellation> => {
      const run = await readRun(tx, actor, runId, true);
      if (!run) return absent;
      const target = cellId ? eq(work.cellId, cellId) : undefined;
      const pending = and(eq(work.runId, run.id), eq(work.done, false), target);
      const [active] = await tx
        .select()
        .from(work)
        .where(pending)
        .orderBy(asc(work.ordinal))
        .limit(1)
        .for("update");
      if (active) {
        await tx.update(work).set({ cancelRequested: true }).where(pending);
        if (!active.dispatched) {
          const queued = await tx
            .select()
            .from(work)
            .where(pending)
            .orderBy(asc(work.ordinal))
            .limit(MAX_NOTEBOOK_CELLS);
          for (const item of queued)
            await finishWork(
              tx,
              run,
              item,
              { status: "cancelled" },
              "cancel_confirmed",
            );
          return { status: "cancelled", reason: "cancel_confirmed" };
        }
        return { status: "pending", reason: "not_ready" };
      }
      if (cellId) {
        const [last] = await tx
          .select({ receipt: attempts.receipt })
          .from(work)
          .innerJoin(attempts, eq(work.attemptId, attempts.id))
          .where(and(eq(work.runId, run.id), target))
          .limit(1);
        if (!last) return absent;
        const { state } = last.receipt;
        if (state.status === "cancelled")
          return { status: "cancelled", reason: "cancel_confirmed" };
        if (
          state.status === "failed" &&
          state.reason === "provider_outcome_unknown"
        )
          return { status: "unknown", reason: "provider_outcome_unknown" };
        return { status: "completed", reason: "completion_won" };
      }
      const [event] = await tx
        .select()
        .from(events)
        .where(
          and(
            eq(events.runId, run.id),
            sql`${events.event}->'event'->>'type' = 'cancellation'`,
          ),
        )
        .orderBy(sql`${events.sequence} desc`)
        .limit(1);
      if (event?.event.event.type === "cancellation")
        return event.event.event.outcome;
      const [last] = await tx
        .select()
        .from(attempts)
        .where(
          and(
            eq(attempts.runId, run.id),
            eq(attempts.terminal, true),
            sql`${attempts.receipt}->'state'->>'reason' = 'provider_outcome_unknown'`,
          ),
        )
        .limit(1);
      if (last)
        return { status: "unknown", reason: "provider_outcome_unknown" };
      return { status: "completed", reason: "completion_won" };
    };
    return transaction ? execute(transaction) : getDb().transaction(execute);
  }

  return {
    admit,
    read,
    claim,
    beginBrowserCompletion,
    renew,
    recordSegment,
    finish,
    cancel,
  };
}

export async function fenceNotebookOutputs(
  tx: Queryable,
  namespaceId: string,
  cells: CellId[],
) {
  await lockNotebookRunOutputs(tx, namespaceId, cells);
  for (const cellId of cells)
    await tx
      .update(outputs)
      .set({
        generation:
          cellRunReceiptSchema.shape.attempt.shape.outputGeneration.parse(
            randomUUID(),
          ),
        attemptId: null,
        resultId: null,
        signature: null,
        dependencyResultId: null,
        dependencySignature: null,
      })
      .where(outputKey(namespaceId, cellId));
}

export async function invalidateNotebookRunOutputs(
  tx: Queryable,
  change: RunInvalidation,
) {
  const namespaceId = change.namespace.namespaceId;
  await lockNotebookRunOutputs(
    tx,
    namespaceId,
    change.outputs.map(({ cellId }) => cellId),
    true,
  );
  const sourceChanged =
    change.cause === "edit" || change.cause === "input-change";
  const lastFailedAttempt = tx
    .select({ id: attempts.id })
    .from(attempts)
    .where(
      and(
        eq(attempts.id, outputs.attemptId),
        eq(attempts.terminal, true),
        eq(sql<string>`${attempts.receipt}->'state'->>'status'`, "failed"),
      ),
    );
  for (const { cellId, outputGeneration } of change.outputs)
    await tx
      .update(outputs)
      .set({
        generation: outputGeneration,
        attemptId:
          sourceChanged && change.namespace.kind === "draft"
            ? sql`(${lastFailedAttempt})`
            : null,
        ...(sourceChanged ? {} : { resultId: null, signature: null }),
        ...(change.cause === "clear"
          ? {}
          : { dependencyResultId: null, dependencySignature: null }),
      })
      .where(outputKey(namespaceId, cellId));
}

export function impactInvalidation(
  impact: NotebookCommandImpact,
  namespace: RunRequest["snapshot"]["namespace"],
  inputRevision: RunRequest["snapshot"]["inputRevision"],
  cause: RunInvalidation["cause"],
): RunInvalidation {
  return {
    snapshot: impact.snapshot,
    namespace,
    inputRevision,
    cause,
    outputs: impact.invalidatedOutputs,
  };
}
