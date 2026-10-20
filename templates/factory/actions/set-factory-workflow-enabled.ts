import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  prepareWorkflowGraph,
  requireWorkflow,
  resolveWorkflowScope,
  withWorkflowFailures,
} from "../server/lib/factory-workflow-context.js";
import { readGraphConnections } from "../server/lib/factory-workflow-graph-connections.js";
import {
  WorkflowJobError,
  disableWorkflowJob,
  syncWorkflowJob,
} from "../server/lib/factory-workflow-job.js";
import { watchAgentCall } from "../server/lib/factory-workflow-tripwires.js";

export default defineAction({
  description:
    "Turn a workflow on or off. Turning it on pauses for the user's approval in chat before it runs, because from then on the workflow sends messages, writes records and can merge pull requests on its schedule: say what it will do before calling, and do not report it as on until the call returns. It needs every provider the graph uses to be connected, otherwise it fails with connection_required listing the providers (connect them with request-workflow-connection); a provider whose status could not be checked only adds a warning. It also needs a clean dry run recorded for its current version, otherwise it fails with dry_run_required, and the graph is checked again against today's operation catalog. Turning it off needs no approval and always works. Both switch the scheduled job to match.",
  schema: z.object({
    factoryId: factoryIdSchema,
    workflowId: z.string().trim().min(1).max(64),
    enabled: z.boolean(),
  }),
  http: { method: "POST" },
  // Sets an end state, so a repeat lands in the same place. The model has to
  // be able to call again after connection_required or dry_run_required.
  retrySafe: true,
  // The agent's, MCP and WebMCP calls ask a person; the canvas toggle is the
  // person. Always-allow would turn the gate off for every later call, and the
  // gate exists for the call a message the agent read talked it into.
  needsApproval: (args) => args.enabled,
  allowPersistentApproval: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  audit: {
    target: (args: { workflowId: string }) => ({
      type: "factory-workflow",
      id: args.workflowId,
      visibility: "org",
    }),
    summary: (args: { workflowId: string; enabled: boolean }) =>
      `${args.enabled ? "Enabled" : "Disabled"} workflow ${args.workflowId}`,
  },
  run: async (input, context) =>
    watchAgentCall(
      {
        action: "set-factory-workflow-enabled",
        input,
        context,
        factoryId: input.factoryId,
        workflowId: input.workflowId,
      },
      (watch) =>
        withWorkflowFailures(async () => {
          const { factoryId, workflowId, enabled } = input;
          const scoped = await resolveWorkflowScope(factoryId, context);
          watch.inOrg(scoped.orgId);
          const workflow = await requireWorkflow(scoped, workflowId);
          const jobScope = {
            orgId: scoped.orgId,
            factoryId,
            automationId: workflow.automationId,
          };

          if (!enabled) {
            // The job goes first: if the rows were switched off and the job write
            // then failed, the job would keep firing for a workflow shown as off.
            // A job file that is already gone is not running, which is the goal.
            let job: { path: string; changed: boolean } | null = null;
            if (jobScope.automationId) {
              try {
                job = await disableWorkflowJob({
                  ...jobScope,
                  automationId: jobScope.automationId,
                });
              } catch (error) {
                if (
                  !(
                    error instanceof WorkflowJobError &&
                    error.code === "job_missing"
                  )
                ) {
                  throw error;
                }
              }
            }
            const summary = await scoped.store.setWorkflowEnabled(
              scoped.scope,
              workflowId,
              false,
            );
            return {
              workflowId,
              enabled: summary.enabled,
              version: summary.version,
              job,
            };
          }

          // The graph passed the catalog when it was saved; the catalog is code
          // and can move, so it must pass again before it starts running.
          const { plan } = prepareWorkflowGraph(workflow.graph);
          // A connection that is missing now fails the first live run, so it is
          // refused here; one that could not be checked is reported, not blocking.
          const connections = await readGraphConnections(
            workflow.graph,
            scoped,
          );
          const missing = connections.filter(
            (connection) => connection.status === "not connected",
          );
          if (missing.length > 0) {
            fail(
              `Connect ${missing.map((connection) => connection.provider).join(", ")} before turning this workflow on: ${missing.map((connection) => `${connection.provider} is used by ${connection.nodes.join(", ")}`).join("; ")}. Call request-workflow-connection for each provider.`,
              {
                errorCode: "connection_required",
                statusCode: 412,
                details: {
                  workflowId,
                  providers: missing.map((connection) => connection.provider),
                  connections,
                },
              },
            );
          }
          const warnings = connections
            .filter((connection) => connection.status === "unknown")
            .map(
              (connection) =>
                `${connection.provider} could not be checked${connection.detail ? ` (${connection.detail})` : ""}, so the workflow was turned on without knowing it is connected.`,
            );
          // The store enables only when the current version has a clean dry run,
          // and decides that in the same statement that flips the flag.
          const summary = await scoped.store.setWorkflowEnabled(
            scoped.scope,
            workflowId,
            true,
          );
          try {
            const job = workflow.automationId
              ? await syncWorkflowJob({
                  ...jobScope,
                  automationId: workflow.automationId,
                  name: workflow.name,
                  plan,
                  enabled: true,
                })
              : null;
            return {
              workflowId,
              enabled: summary.enabled,
              version: summary.version,
              job,
              connections,
              ...(warnings.length > 0 ? { warnings } : {}),
            };
          } catch (error) {
            // Left on, a workflow whose job could not be switched on would read as
            // running while nothing fires it.
            await scoped.store
              .setWorkflowEnabled(scoped.scope, workflowId, false)
              .catch((rollbackError) => {
                console.error(
                  `[set-factory-workflow-enabled] ${workflowId} could not be switched back off after its job failed to follow:`,
                  rollbackError,
                );
              });
            throw error;
          }
        }),
    ),
});
