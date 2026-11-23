import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import {
  attemptIdSchema,
  cellRunReceiptSchema,
  executionSnapshotSchema,
  resultIdSchema,
  runIdSchema,
} from "../../../shared/notebook-execution.js";
import {
  kernelOutputSchema,
  kernelVariableSchema,
} from "../../../shared/notebook-kernel-output.js";
import {
  absentSchema,
  deniedSchema,
  notebookCellIdSchema,
  notebookProjectIdSchema,
  pendingSchema,
  unreadableSchema,
} from "../../../shared/notebook-snapshot-contract.js";
import { getDb } from "../../db/index.js";
import { readKernelOutputs } from "../../execution/notebook-kernel-result.js";
import {
  kernelActor,
  KERNEL_IDLE_MS,
} from "../../execution/notebook-kernel.js";
import { readKernelNamespace } from "../kernel-namespaces.js";
import { checkNotebookAuthorities } from "../notebook-results.js";
import { notebookGraph } from "./planner.js";
import {
  notebookOutputs,
  notebookResultManifests,
  notebookRunAttempts,
  notebookRunWork,
  notebookRuns,
} from "./schema.js";
import {
  readCurrentDraftSnapshot,
  MAX_NOTEBOOK_CELLS,
  type ExecutionActor,
  type SnapshotLoad,
} from "./snapshot.js";

const failures = [
  absentSchema,
  deniedSchema,
  unreadableSchema,
  pendingSchema,
] as const;
const absent = { status: "absent", reason: "not_found" } as const;
const unreadable = { status: "unreadable", reason: "read_failed" } as const;

export const snapshotInput = z.strictObject({
  projectId: notebookProjectIdSchema,
});
export const snapshotOutput = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("found"),
    snapshot: executionSnapshotSchema,
    activeRunId: runIdSchema.nullable(),
    executedCellIds: z.array(notebookCellIdSchema).max(MAX_NOTEBOOK_CELLS),
  }),
  ...failures,
]);
export const cellExecutionInput = snapshotInput.extend({
  cellId: notebookCellIdSchema,
});
export const cellExecutionOutput = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("found"),
    runId: runIdSchema,
    attemptId: attemptIdSchema,
    state: cellRunReceiptSchema.shape.state,
    resultId: resultIdSchema.nullable(),
    outputs: z.array(kernelOutputSchema).max(512),
    exports: z
      .array(
        kernelVariableSchema.extend({
          referenceCount: z.number().int().nonnegative(),
          resultId: resultIdSchema.optional(),
        }),
      )
      .max(200),
    kernelGeneration: z.string().nullable(),
    diagnosticCode: z.string().nullable(),
  }),
  ...failures,
]);
export const kernelSessionInput = z.strictObject({
  scope: snapshotInput.extend({ kind: z.literal("draft") }),
});
export const kernelSessionOutput = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("found"),
    generation: z.string(),
    state: z.enum([
      "absent",
      "queued",
      "starting",
      "idle",
      "busy",
      "stopped",
      "expired",
    ]),
    variables: z.array(kernelVariableSchema).max(200),
  }),
  ...failures,
]);

function failure(load: Exclude<SnapshotLoad, { status: "accepted" }>) {
  switch (load.status) {
    case "absent":
      return absent;
    case "denied":
      return { status: "denied", reason: "access_denied" } as const;
    case "unreadable":
      return unreadable;
    case "pending":
      return { status: "pending", reason: "not_ready" } as const;
  }
}

export async function getExecutionSnapshot(
  actor: ExecutionActor,
  projectId: string,
): Promise<z.infer<typeof snapshotOutput>> {
  const load = await readCurrentDraftSnapshot(actor, projectId);
  if (load.status !== "accepted") return failure(load);
  const { snapshot, cells } = load.value;
  const { namespaceId } = snapshot.namespace;
  if (!cells.length)
    return {
      status: "found",
      snapshot,
      activeRunId: null,
      executedCellIds: [],
    } as const;
  const [active] = await getDb()
    .select({ id: notebookRuns.id })
    .from(notebookRuns)
    .innerJoin(notebookRunWork, eq(notebookRuns.id, notebookRunWork.runId))
    .where(
      and(
        eq(notebookRuns.namespaceId, namespaceId),
        eq(notebookRuns.orgId, actor.orgId),
        eq(notebookRuns.ownerEmail, actor.ownerEmail),
        eq(notebookRunWork.done, false),
      ),
    )
    .orderBy(desc(sql`${notebookRuns.receipt}->>'startedAt'`))
    .limit(1);
  const pointers = await getDb()
    .select({
      cellId: notebookOutputs.cellId,
      attemptId: notebookOutputs.attemptId,
    })
    .from(notebookOutputs)
    .where(
      and(
        eq(notebookOutputs.namespaceId, namespaceId),
        inArray(
          notebookOutputs.cellId,
          cells.map(({ id }) => id),
        ),
      ),
    )
    .limit(MAX_NOTEBOOK_CELLS);
  return {
    status: "found",
    snapshot,
    activeRunId: active?.id ?? null,
    executedCellIds: pointers
      .filter(({ attemptId }) => attemptId !== null)
      .map(({ cellId }) => cellId),
  } as const;
}

export async function getCellExecution(
  actor: ExecutionActor,
  { projectId, cellId }: z.infer<typeof cellExecutionInput>,
) {
  const load = await readCurrentDraftSnapshot(actor, projectId);
  if (load.status !== "accepted") return failure(load);
  const { snapshot, cells } = load.value;
  if (!cells.some(({ id }) => id === cellId)) return absent;
  const [row] = await getDb()
    .select({ pointer: notebookOutputs, attempt: notebookRunAttempts })
    .from(notebookOutputs)
    .leftJoin(
      notebookResultManifests,
      eq(notebookResultManifests.id, notebookOutputs.resultId),
    )
    .innerJoin(
      notebookRunAttempts,
      eq(
        notebookRunAttempts.id,
        sql`coalesce(${notebookOutputs.attemptId}, ${notebookResultManifests.manifest}->'result'->'producer'->>'attemptId')`,
      ),
    )
    .where(
      and(
        eq(notebookOutputs.namespaceId, snapshot.namespace.namespaceId),
        eq(notebookOutputs.cellId, cellId),
      ),
    )
    .limit(1);
  if (!row) return absent;
  const { attempt, pointer } = row;
  const presentation = attempt.kernelPresentation;
  let outputs: Awaited<ReturnType<typeof readKernelOutputs>> = [];
  if (presentation) {
    const denied = await checkNotebookAuthorities(
      actor,
      presentation.authorities,
    );
    if (denied) return denied;
    try {
      outputs = await readKernelOutputs(presentation.output);
    } catch {
      return unreadable;
    }
  }
  const graph = presentation?.exports.length ? notebookGraph(cells) : [];
  return {
    status: "found",
    runId: attempt.receipt.attempt.runId,
    attemptId: attempt.id,
    state: attempt.receipt.state,
    resultId: pointer.resultId,
    outputs,
    kernelGeneration: presentation?.generation ?? null,
    diagnosticCode: attempt.diagnostic?.code ?? null,
    exports:
      presentation?.exports.map((variable) => ({
        ...variable,
        referenceCount: graph.filter(({ dependencies }) =>
          dependencies.some(
            (dep) => dep.cellId === cellId && dep.name === variable.name,
          ),
        ).length,
      })) ?? [],
  } as const;
}

export async function getKernelSession(
  actor: ExecutionActor,
  projectId: string,
): Promise<z.infer<typeof kernelSessionOutput>> {
  const load = await readCurrentDraftSnapshot(actor, projectId);
  if (load.status !== "accepted") return failure(load);
  const { namespace, ref } = load.value.snapshot;
  const found = await readKernelNamespace(
    kernelActor(actor),
    namespace.namespaceId,
  );
  if (!found)
    return {
      status: "found",
      generation: "0",
      state: "absent",
      variables: [],
    } as const;
  const expired =
    found.status === "expired" ||
    found.lineageId !== ref.head.versionId ||
    (found.status !== "stopped" &&
      Date.now() - found.heartbeatAt.getTime() >= KERNEL_IDLE_MS);
  const state = expired
    ? "expired"
    : found.status === "reserved"
      ? "starting"
      : found.status === "ready"
        ? "idle"
        : found.status;
  if (state === "expired" || state === "stopped")
    return {
      status: "found",
      generation: String(found.generation),
      state,
      variables: [],
    } as const;
  if (found.variableState) {
    const denied = await checkNotebookAuthorities(
      actor,
      found.variableState.authorities,
    );
    if (denied) return denied;
  }
  return {
    status: "found",
    generation: String(found.generation),
    state,
    variables:
      found.variableState?.variables.filter(({ kind }) => kind !== "module") ??
      [],
  } as const;
}
