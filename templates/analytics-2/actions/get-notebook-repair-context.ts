import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { notebookProposalErrors as copy } from "../app/i18n/messages/notebook-proposal-errors.js";
import { getDb } from "../server/db/index.js";
import { APPLICATION_ID } from "../server/lib/workspace-access.js";
import { notebookGraph } from "../server/model/notebook-execution/planner.js";
import {
  notebookRunAttempts,
  notebookRuns,
} from "../server/model/notebook-execution/schema.js";
import { readExecutionSnapshot } from "../server/model/notebook-execution/thread-snapshot.js";
import {
  currentResultActor,
  getNotebookRunDiagnostics,
  getNotebookRunDiagnosticsOutput,
} from "../server/model/notebook-results.js";
import { requireNotebookThreadBinding } from "../server/model/thread-projects.js";
import { attemptIdSchema } from "../shared/notebook-execution.js";
import { revisionSchema } from "../shared/notebook-snapshot-contract.js";

const id = z.string().min(1).max(128);

function repairUnavailable(): never {
  return fail(copy.repairUnavailable, {
    errorCode: "repair_context_unavailable",
    statusCode: 404,
  });
}

export default defineAction({
  description:
    "Prepare a composer draft for an authorized notebook execution error without sending a message.",
  schema: z.strictObject({
    projectId: id,
    threadId: id,
    cellId: id,
    attemptId: attemptIdSchema,
  }),
  outputSchema: z.strictObject({
    cellId: id,
    cellLabel: z.string(),
    attemptId: attemptIdSchema,
    sourceRevision: revisionSchema,
    diagnostic:
      getNotebookRunDiagnosticsOutput.options[0].shape.diagnostic.unwrap(),
    prompt: z.string().max(8000),
  }),
  readOnly: true,
  persistInBrowser: false,
  http: { method: "GET" },
  async run({ projectId, threadId, cellId, attemptId }, context) {
    const actor = await currentResultActor(context?.caller ?? "unknown");
    await requireNotebookThreadBinding(
      { ...actor, appId: APPLICATION_ID },
      { projectId, threadId },
    );
    const rows = await getDb()
      .select({ run: notebookRuns, attempt: notebookRunAttempts.receipt })
      .from(notebookRunAttempts)
      .innerJoin(notebookRuns, eq(notebookRuns.id, notebookRunAttempts.runId))
      .where(
        and(
          eq(notebookRunAttempts.id, attemptId),
          eq(notebookRuns.orgId, actor.orgId),
          eq(notebookRuns.ownerEmail, actor.ownerEmail),
        ),
      )
      .limit(1);
    const failed = rows.at(0);
    if (
      !failed ||
      failed.attempt.attempt.cellId !== cellId ||
      failed.attempt.state.status !== "failed"
    )
      return repairUnavailable();
    const { snapshot } = failed.run.receipt.request;
    if (
      snapshot.ref.projectId !== projectId ||
      (snapshot.namespace.kind === "thread" &&
        snapshot.namespace.threadId !== threadId)
    )
      return repairUnavailable();
    const current = await readExecutionSnapshot(actor, snapshot);
    const prior = failed.run.plan.cells.find(({ cell }) => cell.id === cellId);
    if (
      current.status !== "accepted" ||
      current.value.snapshot.ref.head.versionId !==
        snapshot.ref.head.versionId ||
      !prior
    )
      return repairUnavailable();
    const node = notebookGraph(current.value.cells).find(
      ({ cell }) => cell.id === cellId,
    );
    if (!node || node.signature !== prior.signature) return repairUnavailable();
    const details = await getNotebookRunDiagnostics(actor, {
      runId: failed.run.id,
      attemptId,
      threadId,
    });
    if (details.status !== "found" || !details.diagnostic)
      return repairUnavailable();
    const { contents } = node.cell;
    const cellLabel =
      contents.label ||
      (contents.kind === "sql" ? contents.resultVariable : null) ||
      "SQL";
    const reason =
      details.diagnostic.provider?.message ??
      details.diagnostic.provider?.reason ??
      details.diagnostic.code;
    return {
      cellId,
      cellLabel,
      attemptId,
      sourceRevision: current.value.snapshot.ref.head.revision,
      diagnostic: details.diagnostic,
      prompt: copy.repairPrompt
        .replace("{cell}", () => cellLabel.slice(0, 256))
        .replace("{reason}", () => reason.slice(0, 1500)),
    };
  },
});
