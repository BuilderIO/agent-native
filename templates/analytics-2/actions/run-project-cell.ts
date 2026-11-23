import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { notebookProposalErrors as copy } from "../app/i18n/messages/notebook-proposal-errors.js";
import {
  isNotebookToolWrite,
  isThreadlessNotebookCaller,
  requireNotebookToolIdentity,
} from "../server/lib/notebook-tool-context.js";
import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";
import { readAnalyticsThreadBinding } from "../server/model/analytics-thread-bootstrap.js";
import {
  previewCellOutput,
  resultPreviewSchema,
} from "../server/model/cell-result-preview.js";
import { sweepDataframeBlobsAfterWrite } from "../server/model/dataframe-lifecycle.js";
import { digest } from "../server/model/notebook-execution/planner.js";
import {
  currentExecutionActor,
  notebookExecution,
} from "../server/model/notebook-execution/service.js";
import { currentThreadSnapshot } from "../server/model/notebook-execution/thread-snapshot.js";
import {
  queryResultSchema,
  runProjectQuery,
} from "../server/model/project-query.js";
import { runIdSchema, runRequestSchema } from "../shared/notebook-execution.js";

export default defineAction({
  description:
    "Run a SQL cell (in a thread returns running + runId/threadId; poll get-notebook-run and read get-notebook-result-page, not operation poll) or poll/page threadless cells. Read-only SELECTs: do not ask permission. First-N pages are not representative: use COUNT, MIN/MAX or GROUP BY.",
  schema: z
    .object({
      projectId: z.string().min(1),
      cellId: z.string().min(1),
      threadId: z.string().min(1).max(128).optional(),
      operation: z.enum(["run", "poll", "next-page", "page"]).optional(),
      requestId: z
        .string()
        .uuid()
        .optional()
        .describe(
          "Current request ID from get-project. Required for page reads.",
        ),
      rowOffset: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
          "Zero-based row offset for operation page, in increments of 50.",
        ),
    })
    .strict(),
  // A run or poll sets the cell's saved result to an end state, and a second
  // run while one is still going is refused as a conflict, so repeating either
  // after an error cannot double anything. Paging advances a stored cursor, so
  // a repeated next-page could skip rows and stays an unknown outcome.
  retrySafe: ({ operation }) => operation !== "next-page",
  outputSchema: queryResultSchema.extend({
    preview: resultPreviewSchema.nullable().optional(),
    runId: runIdSchema.optional(),
    threadId: z.string().optional(),
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  run: async (input, context) => {
    // A caller with no notebook thread (the desktop shell over WebMCP) runs the
    // person's saved cell directly; only a thread run reads proposal state.
    if (
      (isNotebookToolWrite(context) && !isThreadlessNotebookCaller(context)) ||
      input.threadId
    ) {
      const actor = await currentExecutionActor(context?.caller ?? "unknown");
      const identity = isNotebookToolWrite(context)
        ? await requireNotebookToolIdentity(actor, context, input.threadId)
        : null;
      const threadId = identity?.threadId ?? input.threadId;
      if (!threadId)
        return fail(copy.reviewContextRequired, {
          errorCode: "review_context_required",
          statusCode: 403,
        });
      if (input.operation !== undefined && input.operation !== "run")
        return fail(
          "Notebook thread runs return runId and threadId; call get-notebook-run to poll status and get-notebook-result-page to read rows instead of run-project-cell polling or paging.",
          {
            errorCode: "thread_run_poll_unsupported",
            statusCode: 400,
          },
        );
      const current = await currentThreadSnapshot(actor, {
        projectId: input.projectId,
        threadId,
      });
      if (current.status !== "accepted") {
        const { orgId, ownerEmail } = await requireCurrentWorkspace();
        const bound = await readAnalyticsThreadBinding(
          { orgId, ownerEmail, appId: "analytics-2" },
          threadId,
        ).catch(() => undefined);
        if (bound && bound.project.id !== input.projectId)
          return fail(copy.threadBoundElsewhere, {
            errorCode: "thread_project_mismatch",
            statusCode: 409,
          });
        return fail(copy.threadNotFound, {
          errorCode: "thread_not_found",
          statusCode: 404,
        });
      }
      const execution = await notebookExecution(actor.caller);
      const request = runRequestSchema.parse({
        snapshot: current.value.snapshot,
        requestId: identity
          ? digest([identity.runId, identity.turnId, identity.toolCallId])
          : (input.requestId ?? crypto.randomUUID()),
        mode: "auto",
        targetCellId: input.cellId,
        cache: "reuse",
        staleValues: "reject",
      });
      const receipt = await execution.start(request);
      if (receipt.status !== "admitted")
        return fail(copy.invalidProposal, {
          errorCode: `review_run_${receipt.reason}`,
          statusCode: receipt.status === "denied" ? 403 : 409,
        });
      execution.wake(receipt.runId);
      return {
        status: "running" as const,
        output: null,
        hasNextPage: false,
        totalRows: null,
        runId: receipt.runId,
        threadId,
      };
    }
    const result = await runProjectQuery(input, context?.caller ?? "unknown");
    const { ownerEmail, orgId } = await requireCurrentWorkspace();
    await sweepDataframeBlobsAfterWrite({ ownerEmail, orgId }, input.projectId);
    if (context?.caller === "frontend") return result;
    return {
      ...result,
      ...previewCellOutput(result.output, 0, 50, {
        ...(input.operation === "page"
          ? { baseOffset: input.rowOffset ?? 0 }
          : {}),
        totalRows: result.totalRows,
      }),
    };
  },
});
