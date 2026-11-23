import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import {
  cellRunReceiptSchema,
  runEventSchema,
  runReceiptSchema,
} from "../../../shared/notebook-execution.js";
import { completeResultManifestSchema } from "../../../shared/notebook-result-contract.js";
import { notebookCellIdSchema } from "../../../shared/notebook-snapshot-contract.js";
import { sqlSource } from "../../execution/source-resolver.js";
import type { Queryable, WorkspaceScope } from "../scope.js";
import { digest, notebookGraph } from "./planner.js";
import { lockNotebookRunOutputs } from "./run-store.js";
import {
  notebookOutputs,
  notebookResultManifests,
  notebookRunAttempts,
  notebookRunEvents,
  notebookRuns,
} from "./schema.js";
import { readCurrentDraftSnapshot } from "./snapshot.js";
import { threadNamespace } from "./thread-snapshot.js";

type ReviewScope = { bindingId: string; threadId: string; cellIds: string[] };

export function lockReviewRunOutputs(
  scope: WorkspaceScope,
  input: ReviewScope,
  tx: Queryable,
) {
  const { namespaceId } = threadNamespace(
    scope,
    input.bindingId,
    input.threadId,
  );
  return lockNotebookRunOutputs(
    tx,
    namespaceId,
    input.cellIds.map((id) => notebookCellIdSchema.parse(id)),
  );
}

export async function promoteReviewedSqlResults(
  scope: WorkspaceScope,
  input: ReviewScope & { projectId: string },
  tx: Queryable,
) {
  if (!input.cellIds.length) return [];
  const loaded = await readCurrentDraftSnapshot(scope, input.projectId, tx);
  if (loaded.status !== "accepted") return [];
  const { snapshot, cells } = loaded.value;
  const namespace = threadNamespace(scope, input.bindingId, input.threadId);
  const outputs = await tx
    .select({ pointer: notebookOutputs, row: notebookResultManifests })
    .from(notebookOutputs)
    .innerJoin(
      notebookResultManifests,
      eq(notebookOutputs.resultId, notebookResultManifests.id),
    )
    .where(
      and(
        eq(notebookOutputs.namespaceId, namespace.namespaceId),
        inArray(
          notebookOutputs.cellId,
          input.cellIds.map((id) => notebookCellIdSchema.parse(id)),
        ),
      ),
    )
    .limit(input.cellIds.length);
  const graph = new Map(
    notebookGraph(cells).map((node) => [node.cell.id, node]),
  );
  const promoted = [];
  for (const { pointer, row } of outputs) {
    const node = graph.get(pointer.cellId);
    if (
      !node ||
      node.signature !== pointer.signature ||
      node.dependencies.length ||
      node.cell.contents.kind !== "sql" ||
      sqlSource(node.cell.contents).kind !== "sample"
    )
      continue;
    const parsed = completeResultManifestSchema.safeParse(row.manifest);
    if (!parsed.success || !row.artifactId || row.authorities?.length !== 0)
      continue;
    const prior = parsed.data.result;
    if (
      prior.producer.namespaceId !== namespace.namespaceId ||
      prior.producer.cellId !== pointer.cellId ||
      prior.producer.attemptId !== pointer.attemptId ||
      prior.producer.outputGeneration !== pointer.generation ||
      prior.snapshot.workspaceId !== scope.orgId ||
      prior.snapshot.projectId !== input.projectId ||
      prior.snapshot.head.versionId !== snapshot.ref.head.versionId ||
      prior.inputRevision !== snapshot.inputRevision ||
      prior.sourceGeneration !== null ||
      prior.kernelGeneration !== null ||
      prior.dependencyFingerprint !== digest([])
    )
      continue;

    const runId = randomUUID();
    const resultId = randomUUID();
    const attempt = cellRunReceiptSchema.parse({
      attempt: {
        cellId: pointer.cellId,
        runId,
        attemptId: randomUUID(),
        namespaceId: snapshot.namespace.namespaceId,
        outputGeneration: randomUUID(),
      },
      state: { status: "complete", resultIds: [resultId] },
    });
    const plan = {
      admittedCellIds: [pointer.cellId],
      dependencyResultIds: [],
      rejectedCells: [],
    };
    const at = new Date().toISOString();
    const requestId = `review-result:${runId}`;
    const receipt = runReceiptSchema.parse({
      status: "admitted",
      runId,
      request: {
        snapshot,
        requestId,
        mode: "cell-only",
        targetCellId: pointer.cellId,
        cache: "reuse",
        staleValues: "reject",
      },
      startedAt: at,
      plan,
      attempts: [attempt],
      cursor: "1",
    });
    await tx.insert(notebookRuns).values({
      id: receipt.runId,
      namespaceId: snapshot.namespace.namespaceId,
      ...scope,
      caller: "frontend",
      requestId,
      intent: digest(receipt.request),
      receipt,
      plan: { projection: receipt.plan, cells: [node], external: [] },
      sequence: 1n,
    });
    await tx.insert(notebookRunAttempts).values({
      id: attempt.attempt.attemptId,
      runId: receipt.runId,
      receipt: attempt,
      terminal: true,
      startedAt: at,
      finishedAt: at,
    });
    const event = runEventSchema.parse({
      runId,
      sequence: "1",
      event: { type: "attempt", receipt: attempt },
    });
    await tx.insert(notebookRunEvents).values({ runId, sequence: 1n, event });
    const manifest = completeResultManifestSchema.parse({
      ...parsed.data,
      result: {
        ...prior,
        resultId,
        snapshot: snapshot.ref,
        producer: { ...attempt.attempt, exportId: prior.producer.exportId },
      },
    });
    await tx.insert(notebookResultManifests).values({
      ...row,
      id: manifest.result.resultId,
      manifest,
      cacheKey: null,
    });
    const [installed] = await tx
      .update(notebookOutputs)
      .set({
        generation: attempt.attempt.outputGeneration,
        attemptId: attempt.attempt.attemptId,
        resultId: manifest.result.resultId,
        signature: node.signature,
      })
      .where(
        and(
          eq(notebookOutputs.namespaceId, snapshot.namespace.namespaceId),
          eq(notebookOutputs.cellId, pointer.cellId),
        ),
      )
      .returning({ cellId: notebookOutputs.cellId });
    if (!installed) throw new Error("The reviewed output was not reserved");
    promoted.push({
      cellId: pointer.cellId,
      resultId: manifest.result.resultId,
    });
  }
  return promoted;
}
