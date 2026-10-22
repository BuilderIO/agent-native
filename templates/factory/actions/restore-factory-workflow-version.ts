import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  prepareWorkflowGraph,
  requireWorkflow,
  resolveWorkflowScope,
  syncJobAfterGraphChange,
  withWorkflowFailures,
} from "../server/lib/factory-workflow-context.js";
import {
  WorkflowJobError,
  disableWorkflowJob,
} from "../server/lib/factory-workflow-job.js";

export default defineAction({
  description:
    "Bring back an older graph by saving it as a new version; history is never rewritten. Needs the expectedVersion you read, like a save. The old graph is checked against today's operation catalog first, and every problem comes back as graph_invalid with nothing saved. Restoring into an enabled workflow switches it off (disabledBySave: true): the restored version needs its own clean dry run before set-factory-workflow-enabled.",
  schema: z.object({
    factoryId: factoryIdSchema,
    workflowId: z.string().trim().min(1).max(64),
    version: z.number().int().min(1).describe("The version to bring back."),
    expectedVersion: z
      .number()
      .int()
      .min(1)
      .describe("The current version you read."),
  }),
  http: { method: "POST" },
  // The store applies expectedVersion in the statement that bumps the version,
  // so a repeat after a lost result is a version conflict, never a second restore.
  retrySafe: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  audit: {
    recordInputs: false,
    target: (args: { workflowId: string }) => ({
      type: "factory-workflow",
      id: args.workflowId,
      visibility: "org",
    }),
    summary: (
      args: { workflowId: string; version: number },
      result: unknown,
    ) => {
      const restored = result as { version: number } | undefined;
      return restored
        ? `Restored workflow ${args.workflowId} version ${args.version} as version ${restored.version}`
        : `Workflow ${args.workflowId} restore refused`;
    },
  },
  run: async ({ factoryId, workflowId, version, expectedVersion }, context) =>
    withWorkflowFailures(async () => {
      const scoped = await resolveWorkflowScope(factoryId, context);
      const current = await requireWorkflow(scoped, workflowId);
      if (version === current.version) {
        fail(`Version ${version} is already the current version.`, {
          errorCode: "version_already_current",
          statusCode: 409,
        });
      }
      const older = await scoped.store.getWorkflowVersion(
        scoped.scope,
        workflowId,
        version,
      );
      if (!older) {
        fail(`Workflow "${workflowId}" has no version ${version}.`, {
          errorCode: "workflow_version_not_found",
          statusCode: 404,
        });
      }
      const { graph, plan } = prepareWorkflowGraph(older.graph);
      // The store checks expectedVersion in the same statement that bumps the
      // version, so a stale restore fails there with the current version.
      const saved = await scoped.store.saveWorkflowGraph(scoped.scope, {
        workflowId,
        expectedVersion,
        graph,
        source: "restore",
        summary: `Restored version ${version}`,
        createdBy: scoped.userEmail,
      });
      // A restored version must earn its own clean dry run, so an enabled
      // workflow is switched off with the restore: the rows first, then the
      // job. The host store already switched the flag off in the statement that
      // saved the version; what was on before is what the caller is told. A
      // failed job write never switches the rows back on.
      const disabledBySave = current.enabled || saved.enabled;
      let record = saved;
      if (disabledBySave) {
        record = {
          ...saved,
          ...(await scoped.store.setWorkflowEnabled(
            scoped.scope,
            workflowId,
            false,
          )),
        };
        if (record.automationId) {
          try {
            await disableWorkflowJob({
              orgId: scoped.orgId,
              factoryId,
              automationId: record.automationId,
            });
          } catch (error) {
            if (!(error instanceof WorkflowJobError)) throw error;
            fail(
              `Version ${saved.version} was saved and the workflow switched off, but its job file could not be switched off: ${error.message} Restore again to retry.`,
              {
                errorCode: "job_sync_failed",
                statusCode: 500,
                details: {
                  workflowId,
                  savedVersion: saved.version,
                  jobError: error.code,
                  disabledBySave: true,
                },
              },
            );
          }
        }
      }
      const job = await syncJobAfterGraphChange(scoped, record, plan);
      return {
        workflowId,
        version: saved.version,
        restoredFrom: version,
        enabled: record.enabled,
        lastCleanDryRunVersion: saved.lastCleanDryRunVersion,
        disabledBySave,
        job: job && {
          automationId: job.id,
          path: job.path,
          changed: job.changed,
        },
      };
    }),
});
