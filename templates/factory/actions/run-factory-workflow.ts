import { defineAction, fail } from "@agent-native/core/action";
import type { JobFrontmatter } from "@agent-native/core/jobs/frontmatter";
import {
  SelfDispatchHttpError,
  SelfDispatchNetworkError,
} from "@agent-native/core/server";
import {
  listAutomationRuns,
  queueAutomationRunNow,
} from "@agent-native/core/triggers";
import { z } from "zod";

import { findFactoryAutomationDefinition } from "../server/lib/factory-automation-resources.js";
import {
  factoryAutomationRunHistoryKey,
  factoryIdSchema,
} from "../server/lib/factory-scope.js";
import {
  requireWorkflow,
  resolveWorkflowScope,
  withWorkflowFailures,
} from "../server/lib/factory-workflow-context.js";
import {
  runIsClean,
  waitForWorkflowRun,
  type SchedulerOutcome,
} from "../server/lib/factory-workflow-run-wait.js";
import { watchAgentCall } from "../server/lib/factory-workflow-tripwires.js";
import { recordTripwire } from "../server/tripwire/index.js";
import { getWorkflowReadModels } from "../server/workflow-host/factory-read-models.js";
import type { RunDetail } from "../server/workflow-host/read-models/runs.js";
import { WORKFLOW_STORE_LIMITS } from "../server/workflow/adapter.js";
import { OPERATION_CATALOG } from "../server/workflow/catalog/index.js";
import type { WorkflowGraph } from "../server/workflow/contract.js";
import { providerUsesOfGraph } from "../server/workflow/graph-providers.js";

const MAX_WAIT_SECONDS = 25;

interface QueuedWorkflowRun {
  requestId: string;
  runId: string;
  status: "queued";
}

/** Test-only arguments on a run that is not a test: refused before anything is queued. */
function misplacedTestArguments(input: {
  mode: string;
  testNodeId?: string;
  sampleItemIds?: readonly string[];
}): boolean {
  return (
    input.mode !== "test" &&
    (input.testNodeId !== undefined || (input.sampleItemIds ?? []).length > 0)
  );
}

/**
 * Where a dispatch that failed went and why: an origin plus a status or socket
 * code, so a hosted failure can be read from the error alone. Never a path,
 * query, or credential.
 */
function describeDispatchFailure(error: unknown): {
  summary: string;
  details: Record<string, unknown>;
} {
  if (error instanceof SelfDispatchNetworkError) {
    return {
      summary: error.message,
      details: {
        errorClass: error.name,
        target: error.target,
        ...(error.causeCode === undefined
          ? {}
          : { causeCode: error.causeCode }),
      },
    };
  }
  if (error instanceof SelfDispatchHttpError) {
    return {
      summary: `${error.message}${error.target === undefined ? "" : ` (at ${error.target})`}`,
      details: {
        errorClass: error.name,
        httpStatus: error.httpStatus,
        ...(error.target === undefined ? {} : { target: error.target }),
      },
    };
  }
  return {
    summary: error instanceof Error ? error.message : String(error),
    details: { errorClass: error instanceof Error ? error.name : typeof error },
  };
}

/**
 * The scheduler's id of the run of this job that is going now, read from the
 * marker core's scheduler checks before it refuses a manual run. Only a marker
 * that names its run counts, which is the case core refuses without looking at
 * the clock, so this never reports a run core would have started anyway.
 */
function activeRunOf(
  meta: Pick<JobFrontmatter, "lastStatus" | "lastHistoryId">,
  ownRunId?: string,
): string | undefined {
  const { lastStatus, lastHistoryId } = meta;
  return lastStatus === "running" && lastHistoryId && lastHistoryId !== ownRunId
    ? lastHistoryId
    : undefined;
}

// The workflow never started, so this is not an error of the workflow: it is
// a typed answer, and the caller decides when to run again.
function skippedRun(skipped: {
  requestId?: string;
  runId?: string;
  activeRunId?: string | undefined;
}) {
  return {
    ...(skipped.requestId === undefined
      ? {}
      : { requestId: skipped.requestId }),
    ...(skipped.runId === undefined ? {} : { runId: skipped.runId }),
    status: "skipped" as const,
    reason: "already_running" as const,
    ...(skipped.activeRunId === undefined
      ? {}
      : { activeRunId: skipped.activeRunId }),
    message:
      "Another run of this workflow was already running, so this one did not start and nothing ran. Wait for that run to end (get-factory-workflow-run reads it), then run again.",
  };
}

// The scheduler's own row for a queued run: how it ended, which is known
// before the workflow's run exists and is all there is when that never starts.
async function readSchedulerOutcome(
  resource: { owner: string; path: string },
  runId: string,
): Promise<SchedulerOutcome | null> {
  try {
    const rows = await listAutomationRuns({
      owners: [resource.owner],
      automation: factoryAutomationRunHistoryKey(resource.path),
      appId: "factory",
      limit: 10,
    });
    const row = rows.find((candidate) => candidate.id === runId);
    return row
      ? { status: row.status, error: row.error, errorCode: row.errorCode }
      : null;
  } catch (error) {
    // The wait is an extra over a run that is already queued. Say why it
    // cannot see the scheduler's row, and wait the way it always did.
    console.error(
      `[run-factory-workflow] could not read the scheduler's history for run ${runId}:`,
      error,
    );
    return null;
  }
}

// What an agent needs to judge a run it waited for: how it ended, whether a
// dry run counts toward turning the workflow on, and the steps that failed.
function finishedRun(
  queued: QueuedWorkflowRun,
  detail: RunDetail,
  graph: WorkflowGraph,
) {
  const failedSteps = detail.steps
    .filter((step) => step.status === "failed" || step.status === "needs_check")
    .map((step) => ({
      nodeId: step.nodeId,
      nodeName: step.nodeName,
      nodeKind: step.nodeKind,
      status: step.status,
      error: step.error,
    }));
  const missingConnection = new Set(
    failedSteps
      .filter((step) => step.error?.code === "credential_missing")
      .map((step) => step.nodeId),
  );
  const needsConnection = [
    ...new Set(
      providerUsesOfGraph(graph, OPERATION_CATALOG)
        .filter((use) => missingConnection.has(use.nodeId))
        .map((use) => use.provider),
    ),
  ];
  return {
    requestId: queued.requestId,
    runId: queued.runId,
    status: "finished" as const,
    workflowRunId: detail.run.id,
    runStatus: detail.run.status,
    mode: detail.run.mode,
    clean: runIsClean(detail),
    counts: detail.run.counts,
    error: detail.run.error,
    failedSteps,
    ...(needsConnection.length > 0 ? { needsConnection } : {}),
  };
}

export default defineAction({
  description:
    "Run a workflow now instead of waiting for its schedule. mode dry runs the whole graph on real items: reads and AI run, every write only says what it would do, and a clean dry run of the current version is what lets the workflow be switched on. mode test runs one node (testNodeId) on inbox items you pin (sampleItemIds), without side effects. mode live runs it for real, and the workflow must already be on: it sends messages, writes records, and can merge pull requests, so it pauses for the user's approval in chat before it runs (say what it will send first). Without waitSeconds the call returns as soon as the run is queued, with the scheduler's runId; the workflow run itself appears in list-factory-workflow-runs once the scheduler starts it, usually within seconds. With waitSeconds (up to 25) it waits for the run to end and returns workflowRunId (the id get-factory-workflow-run takes), runStatus, clean (a dry run with every step succeeded, which is what lets the workflow be turned on), counts, the failedSteps with their error codes and messages, and needsConnection when a step failed for a missing connection (connect it with request-workflow-connection). If the run has not ended in time it returns status still_running with the ids; read it with get-factory-workflow-run. When another run of this workflow is already going, the new one never starts: the call returns at once with status skipped, reason already_running and activeRunId (the run that was going), and nothing ran; wait for that run, then call again. A run the scheduler ended before the workflow started returns status not_started with the scheduler's errorCode and message. A request the scheduler does not start within ten minutes is dropped, never run late.",
  schema: z.object({
    factoryId: factoryIdSchema,
    workflowId: z.string().trim().min(1).max(64),
    mode: z.enum(["dry", "test", "live"]),
    testNodeId: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .optional()
      .describe(
        "Required for mode test: the node to run, as it is in the graph.",
      ),
    sampleItemIds: z
      .array(z.string().trim().min(1).max(200))
      .max(WORKFLOW_STORE_LIMITS.runRequestSampleItemsMax)
      .optional()
      .describe("Mode test only: the inbox items to run the node on."),
    waitSeconds: z
      .number()
      .int()
      .min(1)
      .max(MAX_WAIT_SECONDS)
      .optional()
      .describe(
        "Wait up to this many seconds for the run to end and return its result. Omit to return as soon as the run is queued.",
      ),
  }),
  http: { method: "POST" },
  // A dry or test run has no outside effect, so a repeat only adds a run
  // record. A live run sends and merges: it is retry-safe only when its
  // arguments are refused before anything is queued.
  retrySafe: (input) => input.mode !== "live" || misplacedTestArguments(input),
  // A live run is the one mode with an outside effect, so only it asks a
  // person (the agent's, MCP and WebMCP calls; the canvas button is the person).
  // Always-allow would turn that gate off for every later live run.
  needsApproval: (args) => args.mode === "live",
  allowPersistentApproval: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  audit: {
    target: (args: { workflowId: string }) => ({
      type: "factory-workflow",
      id: args.workflowId,
      visibility: "org",
    }),
    summary: (
      args: { workflowId: string; mode: string; testNodeId?: string },
      result: unknown,
    ) =>
      (result as { status?: string } | undefined)?.status === "skipped"
        ? `Skipped a ${args.mode} run of workflow ${args.workflowId}: another run was already going`
        : result
          ? `Queued a ${args.mode} run of workflow ${args.workflowId}${args.testNodeId ? ` at node ${args.testNodeId}` : ""}`
          : `Refused a ${args.mode} run of workflow ${args.workflowId}`,
  },
  run: async (input, context) =>
    watchAgentCall(
      {
        action: "run-factory-workflow",
        input,
        context,
        factoryId: input.factoryId,
        workflowId: input.workflowId,
      },
      (watch) =>
        withWorkflowFailures(async () => {
          const {
            factoryId,
            workflowId,
            mode,
            testNodeId,
            sampleItemIds,
            waitSeconds,
          } = input;
          const scoped = await resolveWorkflowScope(factoryId, context);
          watch.inOrg(scoped.orgId);
          const workflow = await requireWorkflow(scoped, workflowId);

          if (mode === "test") {
            if (testNodeId === undefined) {
              fail("A test run names the node to run (testNodeId).", {
                errorCode: "test_node_required",
                statusCode: 400,
              });
            }
            if (!workflow.graph.nodes.some((node) => node.id === testNodeId)) {
              fail(
                `Node "${testNodeId}" is not in version ${workflow.version} of this workflow.`,
                {
                  errorCode: "workflow_node_not_found",
                  statusCode: 404,
                  details: { workflowId, nodeId: testNodeId },
                },
              );
            }
          } else if (
            misplacedTestArguments({ mode, testNodeId, sampleItemIds })
          ) {
            fail("testNodeId and sampleItemIds are for mode test only.", {
              errorCode: "invalid_request",
              statusCode: 400,
            });
          }
          if (mode === "live" && !workflow.enabled) {
            fail(
              "This workflow is switched off, so it will not run for real. Run a dry run, then switch it on.",
              {
                errorCode: "workflow_disabled",
                statusCode: 409,
                details: { workflowId },
              },
            );
          }

          const job = workflow.automationId
            ? await findFactoryAutomationDefinition(
                scoped.orgId,
                factoryId,
                workflow.automationId,
              )
            : null;
          if (!job) {
            fail(
              "This workflow's job file is gone, so nothing can run it. Save the workflow again to recreate it.",
              {
                errorCode: "workflow_job_missing",
                statusCode: 409,
                details: { workflowId },
              },
            );
          }

          // Core skips a manual run while another run of the job is going, after
          // it has queued it and mailed the owner a failure. Asking first leaves
          // nothing behind. The app's own buttons expect a run id back, so they
          // still go through and find out from the scheduler's history.
          const activeRunId = activeRunOf(job.meta);
          if (activeRunId !== undefined && context?.caller !== "frontend") {
            recordTripwire({
              scope: scoped.scope,
              area: "scheduler",
              code: "run_skipped_already_running",
              severity: "warn",
              workflowId,
              runId: activeRunId,
              details: { phase: "before_queue", mode },
            });
            return skippedRun({ activeRunId });
          }

          // The click's details wait in the request until the job's manual tick
          // claims it: core's run-now carries no payload.
          const request = await scoped.store.createRunRequest(scoped.scope, {
            workflowId,
            mode,
            ...(testNodeId === undefined ? {} : { testNodeId }),
            ...(sampleItemIds === undefined ? {} : { sampleItemIds }),
            requestedBy: scoped.userEmail,
          });
          let queued: QueuedWorkflowRun;
          try {
            // A switched-off job still runs on request, which is how a workflow
            // gets its first dry run.
            const started = await queueAutomationRunNow({
              userEmail: scoped.userEmail,
              orgId: scoped.orgId,
              appId: "factory",
              scope: "organization",
              path: job.resource.path,
              requestHeaders: context?.requestHeaders,
            });
            queued = {
              requestId: request.id,
              runId: started.runId,
              status: "queued",
            };
          } catch (error) {
            const statusCode = (error as { statusCode?: unknown }).statusCode;
            const message =
              error instanceof Error ? error.message : String(error);
            if (
              typeof statusCode === "number" &&
              statusCode >= 400 &&
              statusCode < 500
            ) {
              // Core refused before it queued anything, so no tick will claim the
              // request, and the next unrelated manual run would claim it instead.
              await scoped.store
                .cancelRunRequest(scoped.scope, request.id)
                .catch((cancelError: unknown) => {
                  console.error(
                    `[run-factory-workflow] request ${request.id} could not be cancelled after the run was refused:`,
                    cancelError,
                  );
                });
              return fail(`The run was not queued: ${message}`, {
                errorCode: "run_not_queued",
                statusCode,
                details: { workflowId },
              });
            }
            // Core may already hold a queued run that it redelivers. Its tick has
            // to find this request, or it would run as a plain live "Run now".
            const failure = describeDispatchFailure(error);
            recordTripwire({
              scope: scoped.scope,
              area: "scheduler",
              code: "run_dispatch_failed",
              severity: "error",
              workflowId,
              details: { mode, ...failure.details },
            });
            return fail(
              `The run was saved but the scheduler could not be reached to start it (${failure.summary}). It starts on its own if the scheduler picks it up within ten minutes; after that, ask again.`,
              {
                errorCode: "run_dispatch_failed",
                statusCode: 502,
                details: {
                  workflowId,
                  requestId: request.id,
                  ...failure.details,
                },
              },
            );
          }
          if (waitSeconds === undefined) return queued;

          const models = getWorkflowReadModels();
          const waited = await waitForWorkflowRun({
            waitMs: waitSeconds * 1000,
            readRun: () => models.getRun(scoped.scope, queued.runId),
            readCleanVersion: async () =>
              (await scoped.store.getWorkflow(scoped.scope, workflowId))
                ?.lastCleanDryRunVersion ?? null,
            readScheduler: () =>
              readSchedulerOutcome(job.resource, queued.runId),
          });
          if (waited.state === "finished") {
            return finishedRun(queued, waited.detail, workflow.graph);
          }
          if (waited.state === "skipped") {
            // The tick that was skipped never claimed this request; left in place,
            // the next manual run would claim it and run this one's mode instead.
            const requestCancelled = await scoped.store
              .cancelRunRequest(scoped.scope, queued.requestId)
              .catch((cancelError: unknown) => {
                console.error(
                  `[run-factory-workflow] request ${queued.requestId} could not be cancelled after the run was skipped:`,
                  cancelError,
                );
                return false;
              });
            const current = await findFactoryAutomationDefinition(
              scoped.orgId,
              factoryId,
              job.resource.id,
            );
            recordTripwire({
              scope: scoped.scope,
              area: "scheduler",
              code: "run_skipped_already_running",
              severity: "warn",
              workflowId,
              runId: queued.runId,
              details: { phase: "after_queue", mode, requestCancelled },
            });
            return skippedRun({
              requestId: queued.requestId,
              runId: queued.runId,
              ...(current === null
                ? {}
                : { activeRunId: activeRunOf(current.meta, queued.runId) }),
            });
          }
          if (waited.state === "not_started") {
            return {
              requestId: queued.requestId,
              runId: queued.runId,
              status: "not_started" as const,
              schedulerStatus: waited.outcome.status,
              errorCode: waited.outcome.errorCode,
              message: waited.outcome.error,
            };
          }
          return {
            requestId: queued.requestId,
            runId: queued.runId,
            status: "still_running" as const,
            workflowRunId: waited.detail?.run.id ?? null,
            waitedSeconds: waitSeconds,
          };
        }),
    ),
});
