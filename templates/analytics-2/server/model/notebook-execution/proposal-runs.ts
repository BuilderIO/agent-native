import { randomUUID } from "node:crypto";

import { isActionContractError } from "@agent-native/core/action";
import {
  platformWaitUntil,
  runWithRequestContext,
} from "@agent-native/core/server";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { runRequestSchema } from "../../../shared/notebook-execution.js";
import { getDb } from "../../db/index.js";
import { requireCurrentWorkspace } from "../../lib/workspace-access.js";
import type { Queryable } from "../scope.js";
import { requireNotebookThreadBinding } from "../thread-projects.js";
import {
  notebookOutputs,
  notebookProposalRunIntents as intents,
  notebookRunAttempts,
  notebookRuns,
} from "./schema.js";
import { drainNotebookRun, notebookExecution } from "./service.js";
import { readCurrentDraftSnapshot } from "./snapshot.js";
import { currentThreadSnapshot, threadNamespace } from "./thread-snapshot.js";

type Intent = typeof intents.$inferSelect;
type NewIntent = Pick<
  Intent,
  | "appId"
  | "bindingId"
  | "threadId"
  | "projectId"
  | "versionId"
  | "orgId"
  | "ownerEmail"
  | "kind"
  | "overlayRevision"
  | "cellIds"
> & { allowCandidateReuse?: boolean };

export async function queueProposalRun(tx: Queryable, input: NewIntent) {
  if (!input.cellIds.length) return null;
  const scope = { orgId: input.orgId, ownerEmail: input.ownerEmail };
  const loaded =
    input.kind === "thread"
      ? await currentThreadSnapshot(scope, input, tx)
      : await readCurrentDraftSnapshot(scope, input.projectId, tx);
  if (loaded.status !== "accepted")
    throw new Error("Review run snapshot is unavailable");
  const { cells, snapshot } = loaded.value;
  const cellIds = cells
    .filter(({ id }) => input.cellIds.includes(id))
    .map(({ id }) => id);
  if (!cellIds.length) return null;
  const id = randomUUID();
  await tx.insert(intents).values({
    ...input,
    id,
    cellIds,
    snapshot,
    allowCandidateReuse: input.allowCandidateReuse ?? false,
  });
  return id;
}

export async function readProposalRuns(tx: Queryable, runIntentIds: string[]) {
  type Result = { cellId: string; resultId: string };
  const reads = new Map<string, { runId: string; results: Result[] }>();
  if (!runIntentIds.length) return reads;
  const rows = await tx
    .select({
      id: intents.id,
      runId: notebookRuns.id,
      receipt: notebookRunAttempts.receipt,
      current: notebookOutputs.resultId,
    })
    .from(intents)
    .innerJoin(notebookRuns, eq(notebookRuns.id, intents.runId))
    .leftJoin(
      notebookRunAttempts,
      eq(notebookRunAttempts.runId, notebookRuns.id),
    )
    .leftJoin(
      notebookOutputs,
      and(
        eq(notebookOutputs.namespaceId, notebookRuns.namespaceId),
        eq(notebookOutputs.attemptId, notebookRunAttempts.id),
      ),
    )
    .where(inArray(intents.id, runIntentIds))
    .limit(runIntentIds.length * 500);
  for (const { id, runId, receipt, current } of rows) {
    const read = reads.get(id) ?? { runId, results: [] };
    if (
      receipt?.state.status === "complete" &&
      current &&
      receipt.state.resultIds.includes(current)
    )
      read.results.push({ cellId: receipt.attempt.cellId, resultId: current });
    reads.set(id, read);
  }
  return reads;
}

async function dispatchProposalRun(
  id: string,
  deadlineAt: number,
  signal?: AbortSignal,
) {
  const db = getDb();
  const [intent] = await db
    .select()
    .from(intents)
    .where(eq(intents.id, id))
    .limit(1);
  if (!intent?.snapshot || intent.outcome) return;
  const { orgId, ownerEmail, snapshot } = intent;
  const actor = { orgId, ownerEmail, caller: "frontend" };
  const [targetCellId] = intent.cellIds;
  await runWithRequestContext({ orgId, userEmail: ownerEmail }, async () => {
    try {
      await requireCurrentWorkspace();
      const binding = await requireNotebookThreadBinding(
        { ...actor, appId: intent.appId },
        intent,
      );
      if (binding.id !== intent.bindingId) {
        await db
          .update(intents)
          .set({ outcome: "stale_binding" })
          .where(and(eq(intents.id, id), isNull(intents.outcome)));
        return;
      }
      const execution = await notebookExecution(actor.caller);
      const request = runRequestSchema.parse({
        snapshot,
        targetCellId,
        requestId: `review:${id}`,
        mode: "auto",
        cache:
          intent.kind === "draft" && !intent.allowCandidateReuse
            ? "bypass"
            : "reuse",
        staleValues: "reject",
      });
      const receipt = await execution.start(request, {
        reviewTargets: intent.cellIds,
        ...(intent.allowCandidateReuse
          ? {
              cacheDonor: threadNamespace(
                actor,
                intent.bindingId,
                intent.threadId,
              ).namespaceId,
            }
          : {}),
      });
      if (receipt.status === "unreadable" || receipt.status === "pending")
        return;
      await db
        .update(intents)
        .set(
          receipt.status === "admitted"
            ? { runId: receipt.runId, outcome: receipt.status }
            : { outcome: receipt.reason },
        )
        .where(and(eq(intents.id, id), isNull(intents.outcome)));
      if (receipt.status === "admitted")
        await drainNotebookRun(actor, receipt.runId, { deadlineAt, signal });
    } catch (error) {
      if (!isActionContractError(error) || error.statusCode >= 500) throw error;
      await db
        .update(intents)
        .set({ outcome: error.errorCode })
        .where(and(eq(intents.id, id), isNull(intents.outcome)));
    }
  });
}

export function wakeProposalRun(id: string | null) {
  if (!id) return;
  const task = dispatchProposalRun(id, Date.now() + 90_000).catch(
    (error: unknown) => {
      console.error("Notebook review run dispatch failed", { id, error });
    },
  );
  platformWaitUntil()?.(task);
}

export async function sweepProposalRuns(
  deadlineAt: number,
  signal?: AbortSignal,
) {
  const due = await getDb()
    .select({ id: intents.id })
    .from(intents)
    .where(isNull(intents.outcome))
    .orderBy(asc(intents.id))
    .limit(16);
  for (const { id } of due) {
    if (signal?.aborted || Date.now() >= deadlineAt) return;
    await dispatchProposalRun(id, deadlineAt, signal);
  }
}
