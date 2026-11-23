import { randomUUID } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { and, eq, inArray, sql } from "@agent-native/core/db/schema";
import type { z } from "zod";

import {
  withoutPendingCellEdit,
  type Cell,
  type ProjectDocument,
} from "../../app/lib/model/contracts.js";
import {
  capabilityScopeRefSchema,
  type ControlId,
} from "../../shared/capabilities.js";
import {
  executionSnapshotSchema,
  runIdSchema,
  runReceiptSchema,
  runRequestSchema,
} from "../../shared/notebook-execution.js";
import { completeResultManifestSchema } from "../../shared/notebook-result-contract.js";
import {
  draftHeadSchema,
  notebookCellIdSchema,
  revisionSchema,
} from "../../shared/notebook-snapshot-contract.js";
import {
  cancelPublishPreviewInput,
  createPublishPreviewInput,
  getPublishPreviewInput,
  releaseOutputSchema,
  type CancelPublishPreviewReceipt,
  type PublishPreviewDetail,
  type PublishPreviewReceipt,
  type ReleaseOutput,
} from "../../shared/project-publish.js";
import { getDb, schema } from "../db/index.js";
import { usesBrowserNotebookKernel } from "../execution/kernel-client.js";
import { requireCapability } from "../lib/analytics-capabilities.js";
import { requireCurrentWorkspace } from "../lib/workspace-access.js";
import { nowIso } from "./clock.js";
import { ensureAnalyticsDatabase } from "./database.js";
import {
  digest,
  executionContents,
  notebookGraph,
  type CellId,
  type ExecutionCell,
  type StoredPlan,
} from "./notebook-execution/planner.js";
import {
  notebookOutputs,
  notebookResultManifests,
  notebookRunAttempts,
  notebookRuns,
  type SourceAuthority,
} from "./notebook-execution/schema.js";
import {
  findClaimableNotebookRunActor,
  notebookRunStore,
  wakeNotebookRun,
} from "./notebook-execution/service.js";
import {
  draftNamespace,
  MAX_NOTEBOOK_CELLS,
  type ExecutionActor,
  type SnapshotReader,
} from "./notebook-execution/snapshot.js";
import { lockNotebookProject } from "./notebook-operations/store.js";
import type { ProjectRow } from "./project-access.js";
import { getReadableProjectRow } from "./project-access.js";
import {
  canEditProject,
  canManageProject,
  projectAccessLevel,
} from "./project-grant-access.js";
import {
  getReadableProjectDocument,
  readLockedDraftDocument,
} from "./projects-store.js";
import type { Queryable } from "./scope.js";

const { publishPreviews, publishPreviewCancels } = schema;
const zero = revisionSchema.parse("0");
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;
type Preview = typeof publishPreviews.$inferSelect;
export type ManifestEntry = ReleaseOutput & {
  attemptId: string | null;
  executionSignature: string | null;
  dependencyDigest: string | null;
  authorityDigest: string | null;
};
type Compared = PublishPreviewDetail["compared"];

export async function publishActor(
  projectId: string,
  controlId: ControlId,
  caller: string,
) {
  await ensureAnalyticsDatabase();
  const { orgId, ownerEmail } = await requireCurrentWorkspace();
  await requireCapability(
    controlId,
    capabilityScopeRefSchema.parse({
      kind: "project",
      workspaceId: orgId,
      projectId,
    }),
  );
  return { orgId, ownerEmail, caller };
}

export async function lockPublisherProject(
  actor: ExecutionActor,
  projectId: string,
  tx: Queryable,
  force = false,
) {
  const project = await lockNotebookProject(actor, projectId, tx, "update");
  if (
    force &&
    !canManageProject(await projectAccessLevel(actor, project, [], tx))
  )
    fail("You don’t have permission to publish this app.", {
      statusCode: 403,
      errorCode: "capability_denied",
    });
  return project;
}

export function checkedPublishHead(
  project: ProjectRow,
  {
    expectedHead,
    expectedReleaseId,
  }: Pick<
    z.infer<typeof createPublishPreviewInput>,
    "expectedHead" | "expectedReleaseId"
  >,
) {
  const head = draftHeadSchema.parse({
    versionId: project.workingVersionId,
    revision: project.notebookRevision.toString(),
  });
  if (digest(head) !== digest(expectedHead))
    fail("The notebook changed. Prepare a new preview.", {
      statusCode: 409,
      errorCode: "publish_head_changed",
      details: { head },
    });
  if (project.publishedVersionId !== expectedReleaseId)
    fail("The published version changed. Compare with the latest release.", {
      statusCode: 409,
      errorCode: "publish_release_changed",
      details: { releaseId: project.publishedVersionId },
    });
  return head;
}

export function requireMatchingPublishIntent(stored: string, current: string) {
  if (stored !== current)
    fail("This request ID already belongs to another operation.", {
      statusCode: 409,
      errorCode: "request_id_reused",
    });
}

function assertNotCancelled() {
  return fail("This publish preview was cancelled.", {
    statusCode: 409,
    errorCode: "preview_cancelled",
  });
}

export function unreadablePreview(): never {
  return fail("The publish preview could not be read.", {
    statusCode: 503,
    errorCode: "preview_unreadable",
  });
}

function previewScope(actor: ExecutionActor, projectId: string) {
  return and(
    eq(publishPreviews.orgId, actor.orgId),
    eq(publishPreviews.projectId, projectId),
    eq(publishPreviews.actorId, actor.ownerEmail),
  );
}

function cancelScope(actor: ExecutionActor, projectId: string) {
  return and(
    eq(publishPreviewCancels.orgId, actor.orgId),
    eq(publishPreviewCancels.projectId, projectId),
    eq(publishPreviewCancels.actorId, actor.ownerEmail),
  );
}

export async function readPublishPreview(
  db: Queryable,
  actor: ExecutionActor,
  projectId: string,
  previewId: string,
  lock?: "share" | "update",
) {
  const query = db
    .select()
    .from(publishPreviews)
    .where(
      and(previewScope(actor, projectId), eq(publishPreviews.id, previewId)),
    )
    .limit(1);
  const [preview] = await (lock ? query.for(lock) : query);
  if (!preview)
    fail("That publish preview is not available.", {
      statusCode: 404,
      errorCode: "preview_not_found",
    });
  return preview;
}

export function executableCells(project: ProjectDocument): ExecutionCell[] {
  return project.cells.flatMap(({ id, contents }) =>
    contents.kind === "input" ||
    contents.kind === "sql" ||
    contents.kind === "code"
      ? [{ id: notebookCellIdSchema.parse(id), contents }]
      : [],
  );
}

export const readPublishPreviewSnapshot: SnapshotReader = async (
  actor,
  requested,
  tx,
) => {
  if (requested.ref.workspaceId !== actor.orgId) return { status: "denied" };
  const { namespace, ref } = requested;
  if (namespace.kind !== "preview") return { status: "absent" };
  const db = tx ?? getDb();
  const query = db
    .select()
    .from(publishPreviews)
    .where(
      and(
        previewScope(actor, ref.projectId),
        eq(publishPreviews.id, namespace.previewId),
      ),
    )
    .limit(1);
  const [preview] = await (tx ? query.for("share") : query);
  if (!preview) return { status: "absent" };
  if (
    preview.cancelledAt ||
    preview.publishedReleaseId ||
    preview.expiresAt <= nowIso()
  )
    return { status: "denied" };
  const project = await getReadableProjectRow(actor, ref.projectId, db);
  if (
    !project ||
    project.trashedAt !== null ||
    !canEditProject(await projectAccessLevel(actor, project, [], db))
  )
    return { status: "denied" };
  const { snapshot } = preview;
  if (snapshot.namespace.namespaceId !== namespace.namespaceId)
    return { status: "denied" };
  return {
    status: "accepted",
    value: { snapshot, cells: executableCells(preview.project) },
  };
};

async function seedBrowserPreviewOutputs(
  tx: Queryable,
  actor: ExecutionActor,
  snapshot: Preview["snapshot"],
  cells: ExecutionCell[],
): Promise<NonNullable<StoredPlan["previewPins"]>> {
  const graph = notebookGraph(cells);
  const draft = draftNamespace(actor, snapshot.ref.projectId);
  const rows = await tx
    .select({
      cellId: notebookOutputs.cellId,
      signature: notebookOutputs.signature,
      manifest: notebookResultManifests.manifest,
    })
    .from(notebookOutputs)
    .innerJoin(
      notebookResultManifests,
      eq(notebookResultManifests.id, notebookOutputs.resultId),
    )
    .innerJoin(
      notebookRuns,
      and(
        eq(
          notebookRuns.id,
          sql`${notebookResultManifests.manifest}->'result'->'producer'->>'runId'`,
        ),
        eq(notebookRuns.orgId, actor.orgId),
        eq(notebookRuns.ownerEmail, actor.ownerEmail),
        eq(notebookRuns.namespaceId, draft.namespaceId),
      ),
    )
    .where(
      and(
        eq(notebookOutputs.namespaceId, draft.namespaceId),
        inArray(
          notebookOutputs.cellId,
          cells.map(({ id }) => id),
        ),
      ),
    )
    .limit(cells.length);
  const byId = new Map(rows.map((row) => [row.cellId, row]));
  const complete = new Map<
    CellId,
    {
      result: z.infer<typeof completeResultManifestSchema>["result"];
      signature: string;
      dependencies: CellId[];
    }
  >();
  const needed = new Set<CellId>();
  for (const { cell, signature, dependencies } of graph) {
    const row = byId.get(cell.id);
    if (row?.signature !== signature) continue;
    const parsed = completeResultManifestSchema.safeParse(row.manifest);
    if (!parsed.success) continue;
    const { result } = parsed.data;
    const prerequisites = dependencies
      .filter(({ kind }) => kind !== "input")
      .map(({ cellId }) => cellId);
    if (
      result.snapshot.workspaceId !== snapshot.ref.workspaceId ||
      result.snapshot.projectId !== snapshot.ref.projectId ||
      result.snapshot.head.versionId !== snapshot.ref.head.versionId ||
      result.producer.cellId !== cell.id ||
      result.producer.namespaceId !== draft.namespaceId ||
      prerequisites.some((id) => !complete.has(id)) ||
      result.dependencyFingerprint !==
        digest(prerequisites.map((id) => complete.get(id)?.result.resultId))
    )
      continue;
    complete.set(cell.id, { result, signature, dependencies: prerequisites });
    if (result.provenance === "browser") needed.add(cell.id);
  }
  const pins = [];
  for (const cellId of needed) {
    const pinned = complete.get(cellId);
    if (!pinned) continue;
    const { result, signature, dependencies } = pinned;
    pins.push({
      cellId,
      resultId: result.resultId,
      signature,
      generation: result.producer.outputGeneration,
    });
    for (const dependency of dependencies) needed.add(dependency);
  }
  if (pins.length)
    await tx.insert(notebookOutputs).values(
      pins.map((pin) => ({
        ...pin,
        namespaceId: snapshot.namespace.namespaceId,
      })),
    );
  return pins.map(({ cellId, resultId }) => ({ cellId, resultId }));
}

export async function createPublishPreview(
  actor: ExecutionActor,
  input: z.infer<typeof createPublishPreviewInput>,
) {
  const { projectId, requestId } = input;
  const intent = digest(input);
  const receipt = await getDb().transaction(async (tx) => {
    const current = await lockPublisherProject(actor, projectId, tx);
    const [prior] = await tx
      .select()
      .from(publishPreviews)
      .where(
        and(
          previewScope(actor, projectId),
          eq(publishPreviews.createRequestId, requestId),
        ),
      )
      .limit(1);
    if (prior) {
      requireMatchingPublishIntent(prior.intent, intent);
      return prior.createReceipt ?? unreadablePreview();
    }
    const [cancelled] = await tx
      .select({ receipt: publishPreviewCancels.receipt })
      .from(publishPreviewCancels)
      .where(
        and(
          cancelScope(actor, projectId),
          eq(publishPreviewCancels.createRequestId, requestId),
        ),
      )
      .limit(1);
    if (cancelled) assertNotCancelled();

    const head = checkedPublishHead(current, input);
    const draft = await readLockedDraftDocument(
      current,
      { ...actor, ownerEmail: current.ownerEmail },
      tx,
    );
    if (draft.cells.length > MAX_NOTEBOOK_CELLS) unreadablePreview();
    const project = {
      ...draft,
      cells: draft.cells.map((cell) => ({
        ...cell,
        contents: withoutPendingCellEdit(cell.contents),
      })),
    };
    const previewId = randomUUID();
    const cells = executableCells(project);
    const snapshot = executionSnapshotSchema.parse({
      ref: {
        workspaceId: actor.orgId,
        projectId,
        head,
        eventSeq: current.notebookEventSeq.toString(),
      },
      namespace: {
        kind: "preview",
        previewId,
        namespaceId: digest(["preview", actor.orgId, previewId]),
      },
      inputRevision: current.notebookInputRevision.toString(),
      executionFingerprint: digest(
        cells.map(({ id, contents }) => [id, executionContents(contents)]),
      ),
    });

    const createdAt = nowIso();
    await tx.insert(publishPreviews).values({
      id: previewId,
      orgId: actor.orgId,
      projectId,
      actorId: actor.ownerEmail,
      createRequestId: requestId,
      intent,
      snapshot,
      project,
      comparedReleaseId: input.expectedReleaseId,
      createdAt,
      expiresAt: new Date(Date.parse(createdAt) + PREVIEW_TTL_MS).toISOString(),
    });
    const previewPins =
      usesBrowserNotebookKernel() &&
      cells.some(({ contents }) => contents.kind === "code")
        ? await seedBrowserPreviewOutputs(tx, actor, snapshot, cells)
        : [];
    const run = await notebookRunStore.admit(
      actor,
      runRequestSchema.parse({
        snapshot,
        requestId,
        cache: "reuse",
        mode: "run-all",
        restart: false,
      }),
      previewPins.length ? { previewPins } : undefined,
      tx,
    );
    if (run.status !== "admitted") unreadablePreview();
    const receipt: PublishPreviewReceipt = {
      projectId,
      previewId,
      head,
      compareReleaseId: input.expectedReleaseId,
      runId: run.runId,
      state:
        run.attempts.length > 0
          ? "queued"
          : run.plan.rejectedCells.length
            ? "failed"
            : "ready",
      cursor: revisionSchema.parse(run.cursor),
    };
    await tx
      .update(publishPreviews)
      .set({ runId: run.runId, createReceipt: receipt })
      .where(eq(publishPreviews.id, previewId));
    return receipt;
  });
  if (receipt.runId && receipt.state === "queued")
    wakeNotebookRun(actor, receipt.runId);
  return receipt;
}

function inactiveOutput(
  cellId: string,
  state: "failed" | "missing",
  attemptId: string | null = null,
): ManifestEntry {
  return {
    cellId,
    state,
    resultId: null,
    diagnosticId: state === "failed" ? attemptId : null,
    attemptId,
    executionSignature: null,
    dependencyDigest: null,
    authorityDigest: null,
  };
}

export async function readPreviewManifest(db: Queryable, preview: Preview) {
  if (!preview.runId) unreadablePreview();
  const query = db
    .select()
    .from(notebookRuns)
    .where(
      and(
        eq(notebookRuns.id, runIdSchema.parse(preview.runId)),
        eq(notebookRuns.orgId, preview.orgId),
        eq(notebookRuns.ownerEmail, preview.actorId),
        eq(notebookRuns.namespaceId, preview.snapshot.namespace.namespaceId),
      ),
    )
    .limit(1);
  const [row] = await query.for("share");
  if (!row || digest(row.receipt.request.snapshot) !== digest(preview.snapshot))
    unreadablePreview();
  const pointed = await db
    .select()
    .from(notebookOutputs)
    .where(
      eq(notebookOutputs.namespaceId, preview.snapshot.namespace.namespaceId),
    )
    .limit(MAX_NOTEBOOK_CELLS);
  const currentAttemptIds = pointed.flatMap(({ attemptId }) =>
    attemptId ? [attemptId] : [],
  );
  const attempts =
    currentAttemptIds.length > 0
      ? await db
          .select({ receipt: notebookRunAttempts.receipt })
          .from(notebookRunAttempts)
          .where(
            and(
              eq(notebookRunAttempts.runId, row.id),
              inArray(notebookRunAttempts.id, currentAttemptIds),
            ),
          )
          .limit(currentAttemptIds.length)
      : [];
  const run = runReceiptSchema.parse({
    ...row.receipt,
    cursor: row.sequence.toString(),
    attempts: attempts.map(({ receipt }) => receipt),
  });
  const cursor = revisionSchema.parse(run.cursor);
  const previewPins = new Map(
    row.plan.previewPins?.map(({ cellId, resultId }) => [cellId, resultId]),
  );
  const resultIds = [
    ...previewPins.values(),
    ...run.attempts.flatMap(({ state }) =>
      state.status === "complete" ? state.resultIds.slice(0, 1) : [],
    ),
  ];
  const results =
    resultIds.length > 0
      ? await db
          .select()
          .from(notebookResultManifests)
          .where(inArray(notebookResultManifests.id, resultIds))
          .limit(resultIds.length)
      : [];
  const pointerByCell = new Map(
    pointed.map((pointer) => [pointer.cellId, pointer]),
  );
  const attemptByCell = new Map(
    run.attempts.map((entry) => [entry.attempt.cellId, entry]),
  );
  const resultById = new Map(results.map((result) => [result.id, result]));
  const planByCell = new Map(
    row.plan.cells.map((entry) => [entry.cell.id, entry]),
  );
  const rejected = new Set(run.plan.rejectedCells.map(({ cellId }) => cellId));
  const authorities: SourceAuthority[] = [];
  const outputs = executableCells(preview.project).flatMap(
    ({ id, contents }): ManifestEntry[] => {
      if (contents.kind === "input") return [];
      const pin = previewPins.get(id);
      if (pin) {
        const pointer = pointerByCell.get(id);
        const row = resultById.get(pin);
        const pinned = completeResultManifestSchema.safeParse(row?.manifest);
        if (
          !pinned.success ||
          !row?.authorities ||
          pointer?.resultId !== pin ||
          pinned.data.result.producer.cellId !== id ||
          pinned.data.result.resultId !== pin ||
          pointer.generation !== pinned.data.result.producer.outputGeneration
        )
          return [inactiveOutput(id, "failed")];
        authorities.push(...row.authorities);
        return [
          {
            cellId: id,
            state: "ready",
            resultId: pin,
            diagnosticId: null,
            attemptId: pinned.data.result.producer.attemptId,
            executionSignature: pointer.signature,
            dependencyDigest: pinned.data.result.dependencyFingerprint,
            authorityDigest: digest(row.authorities),
          },
        ];
      }
      const entry = attemptByCell.get(id);
      if (!entry)
        return [inactiveOutput(id, rejected.has(id) ? "failed" : "missing")];
      const { attempt, state } = entry;
      if (state.status !== "complete")
        return [
          inactiveOutput(
            id,
            state.status === "queued" || state.status === "running"
              ? "missing"
              : "failed",
            attempt.attemptId,
          ),
        ];
      const resultId = state.resultIds[0];
      const saved = resultId && resultById.get(resultId);
      const pointer = pointerByCell.get(id);
      const node = planByCell.get(id);
      const dependencyResultIds = node?.dependencies
        .filter(({ kind }) => kind !== "input")
        .map(({ cellId }) => pointerByCell.get(cellId)?.resultId);
      const parsed = completeResultManifestSchema.safeParse(
        saved ? saved.manifest : undefined,
      );
      if (
        !saved ||
        !pointer ||
        !node ||
        !parsed.success ||
        pointer.resultId !== resultId ||
        pointer.attemptId !== attempt.attemptId ||
        pointer.generation !== attempt.outputGeneration ||
        pointer.signature !== node.signature ||
        digest(executionContents(node.cell.contents)) !==
          digest(executionContents(contents)) ||
        digest(parsed.data.result.snapshot) !== digest(preview.snapshot.ref) ||
        parsed.data.result.inputRevision !== preview.snapshot.inputRevision ||
        !dependencyResultIds ||
        dependencyResultIds.some((id) => !id) ||
        parsed.data.result.dependencyFingerprint !==
          digest(dependencyResultIds) ||
        parsed.data.result.resultId !== resultId ||
        digest(parsed.data.result.producer) !==
          digest({
            ...attempt,
            exportId: parsed.data.result.producer.exportId,
          }) ||
        (parsed.data.result.sourceGeneration !== null &&
          !saved.authorities?.some(
            ({ generation }) =>
              generation === parsed.data.result.sourceGeneration,
          ))
      )
        return [inactiveOutput(id, "failed", attempt.attemptId)];
      const { result } = parsed.data;
      authorities.push(...(saved.authorities ?? []));
      return [
        {
          cellId: id,
          state: "ready",
          resultId,
          diagnosticId: null,
          attemptId: attempt.attemptId,
          executionSignature: node.signature,
          dependencyDigest: result.dependencyFingerprint,
          authorityDigest: digest(saved.authorities ?? []),
        },
      ];
    },
  );

  const state: PublishPreviewReceipt["state"] = preview.publishedReleaseId
    ? "published"
    : preview.cancelledAt
      ? "cancelled"
      : run.attempts.some(({ state }) => state.status === "running")
        ? "running"
        : run.attempts.some(({ state }) => state.status === "queued")
          ? "queued"
          : outputs.some(({ state }) => state !== "ready")
            ? "failed"
            : "ready";
  return {
    run,
    cursor,
    authorities,
    state,
    outputs,
    manifestId: `man_${digest([preview.id, cursor, outputs])}`,
  };
}

async function comparedProject(
  actor: ExecutionActor,
  preview: Preview,
): Promise<Compared> {
  if (!preview.comparedReleaseId) return null;
  const { comparedReleaseId } = preview;
  const db = getDb();
  const [version] = await db
    .select({
      description: schema.projectVersions.name,
      publishedAt: schema.projectVersions.createdAt,
    })
    .from(schema.projectVersions)
    .where(
      and(
        eq(schema.projectVersions.id, comparedReleaseId),
        eq(schema.projectVersions.projectId, preview.projectId),
        eq(schema.projectVersions.kind, "published"),
      ),
    )
    .limit(1);
  const project = await getReadableProjectDocument(
    actor,
    preview.projectId,
    comparedReleaseId,
    "published",
  );
  if (!version || !project) unreadablePreview();
  return { ...version, project };
}

function semanticConfig({ contents }: Cell) {
  const {
    id: _id,
    order: _order,
    gridX: _x,
    gridY: _y,
    gridWidth: _width,
    gridHeight: _height,
    ...config
  } = withoutPendingCellEdit(contents);
  return config;
}

function diffCells(current: Cell[], previous: Cell[], after?: string) {
  const currentById = new Map(current.map((cell) => [cell.id, cell]));
  const previousById = new Map(previous.map((cell) => [cell.id, cell]));
  const currentOrder = new Map(
    current
      .filter(({ id }) => previousById.has(id))
      .map(({ id }, index) => [id, index]),
  );
  const previousOrder = new Map(
    previous
      .filter(({ id }) => currentById.has(id))
      .map(({ id }, index) => [id, index]),
  );
  const ordered = [
    ...current.map(({ id }) => id),
    ...previous.filter(({ id }) => !currentById.has(id)).map(({ id }) => id),
  ];
  const offset = after === undefined ? 0 : ordered.indexOf(after) + 1;
  const pageSize = MAX_NOTEBOOK_CELLS;
  const page = ordered.slice(offset, offset + pageSize);
  return {
    diff: page.map((cellId): PublishPreviewDetail["diff"][number] => {
      const next = currentById.get(cellId);
      const prior = previousById.get(cellId);
      const changes: PublishPreviewDetail["diff"][number]["changes"] = [];
      if (!prior) changes.push("added");
      else if (!next) changes.push("removed");
      else {
        if (currentOrder.get(cellId) !== previousOrder.get(cellId))
          changes.push("reordered");
        if (digest(semanticConfig(next)) !== digest(semanticConfig(prior)))
          changes.push("config-changed");
      }
      return {
        cellId,
        changes,
        current: next?.contents ?? null,
        previous: prior ? withoutPendingCellEdit(prior.contents) : null,
      };
    }),
    nextDiffCursor:
      offset + pageSize < ordered.length ? (page.at(-1) ?? null) : null,
  };
}

export async function getPublishPreview(
  actor: ExecutionActor,
  input: z.infer<typeof getPublishPreviewInput>,
): Promise<PublishPreviewDetail> {
  const { preview, manifest } = await getDb().transaction(async (tx) => {
    const preview = await readPublishPreview(
      tx,
      actor,
      input.projectId,
      input.previewId,
      "share",
    );
    return { preview, manifest: await readPreviewManifest(tx, preview) };
  });
  const { cursor, manifestId, state, run, outputs } = manifest;
  if ((state === "queued" || state === "running") && preview.runId) {
    const claimableActor = await findClaimableNotebookRunActor(
      actor.orgId,
      preview.runId,
    );
    if (claimableActor) wakeNotebookRun(claimableActor, preview.runId);
  }
  const compared = await comparedProject(actor, preview);
  return {
    projectId: preview.projectId,
    previewId: preview.id,
    head: preview.snapshot.ref.head,
    compareReleaseId: preview.comparedReleaseId,
    runId: preview.runId,
    state,
    cursor,
    manifestRevision: cursor,
    manifestId,
    project: preview.project,
    compared,
    outputs: outputs.map(({ cellId, state, resultId, diagnosticId }) =>
      releaseOutputSchema.parse({ cellId, state, resultId, diagnosticId }),
    ),
    run,
    ...diffCells(
      preview.project.cells,
      compared?.project.cells ?? [],
      input.diffAfter,
    ),
  };
}

export async function cancelPublishPreview(
  actor: ExecutionActor,
  input: z.infer<typeof cancelPublishPreviewInput>,
) {
  const { projectId, createRequestId, requestId } = input;
  const { receipt, runId } = await getDb().transaction(async (tx) => {
    await lockPublisherProject(actor, projectId, tx);
    const [previous] = await tx
      .select()
      .from(publishPreviewCancels)
      .where(
        and(
          cancelScope(actor, projectId),
          eq(publishPreviewCancels.requestId, requestId),
        ),
      )
      .limit(1);
    if (previous) {
      requireMatchingPublishIntent(previous.createRequestId, createRequestId);
      return { receipt: previous.receipt, runId: null };
    }
    const [preview] = await tx
      .select()
      .from(publishPreviews)
      .where(
        and(
          previewScope(actor, projectId),
          eq(publishPreviews.createRequestId, createRequestId),
        ),
      )
      .limit(1)
      .for("update");
    const [priorCancel] = await tx
      .select({ id: publishPreviewCancels.requestId })
      .from(publishPreviewCancels)
      .where(
        and(
          cancelScope(actor, projectId),
          eq(publishPreviewCancels.createRequestId, createRequestId),
        ),
      )
      .limit(1);
    const receipt: CancelPublishPreviewReceipt = {
      ...(preview ? { previewId: preview.id } : {}),
      state: preview?.publishedReleaseId
        ? "published"
        : priorCancel
          ? "already_cancelled"
          : "cancelled",
      cursor: preview ? (await readPreviewManifest(tx, preview)).cursor : zero,
    };
    if (preview && receipt.state === "cancelled")
      await tx
        .update(publishPreviews)
        .set({ cancelledAt: nowIso() })
        .where(eq(publishPreviews.id, preview.id));
    await tx.insert(publishPreviewCancels).values({
      orgId: actor.orgId,
      projectId,
      actorId: actor.ownerEmail,
      createRequestId,
      requestId,
      receipt,
    });
    return {
      receipt,
      runId: receipt.state === "cancelled" ? preview?.runId : null,
    };
  });
  if (runId) {
    await notebookRunStore.cancel(actor, runId);
    wakeNotebookRun(actor, runId);
  }
  return receipt;
}

export function requireActivePreview(preview: Preview) {
  if (preview.cancelledAt) assertNotCancelled();
  if (preview.expiresAt <= nowIso())
    fail("This publish preview expired. Prepare a new preview.", {
      statusCode: 409,
      errorCode: "preview_expired",
    });
  if (preview.publishedReleaseId)
    fail("This preview has already been published.", {
      statusCode: 409,
      errorCode: "publish_release_changed",
    });
}
