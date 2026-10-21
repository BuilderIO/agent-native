import { defineAction } from "@agent-native/core/action";
import { getAutomationSchedulerHealth } from "@agent-native/core/jobs";
import {
  getAppConfig,
  isServerlessRuntime,
  resolveDeployEnvironment,
  resolveDeployPlatform,
  scheduledTriggerAvailability,
} from "@agent-native/core/server";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { findFactoryAutomationDefinition } from "../server/lib/factory-automation-resources.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import { readProviderConnections } from "../server/lib/factory-workflow-connections.js";
import {
  planWorkflowJob,
  summarizeWorkflowJob,
} from "../server/lib/factory-workflow-job.js";
import {
  resolveWorkflowReadScope,
  withReadFailures,
  workflowIdSchema,
} from "../server/lib/workflow-read-actions.js";
import {
  DIAGNOSTICS_DEFAULT_HOURS,
  DIAGNOSTICS_MAX_HOURS,
  buildWorkflowDiagnostics,
} from "../server/tripwire/diagnostics.js";
import { createDrizzleTripwireStore } from "../server/tripwire/store.js";
import { getWorkflowStore } from "../server/workflow-host/factory-store.js";

// The heartbeat is stale after the same three minutes `get-factory-automation-health` uses.
const SCHEDULER_STALE_AFTER_MS = 3 * 60_000;

export default defineAction({
  description:
    "One JSON diagnostics bundle for a factory, or one of its workflows or runs, to send back when something fails: build and deploy facts, whether the scheduler is on and its heartbeat age, connection status per provider, the workflow's shape and job health, the last 10 runs with their failed steps, waiting items and how many are overdue, writes that began and never confirmed, and the recent tripwires (unexpected events the system recorded) newest first with counts by code. Tokens, emails, URL query strings and raw provider data never appear: only ids, codes, counts, durations and the structure of data. Capped at 30 KB; `truncated` lists anything cut and `unavailable` lists anything that could not be read.",
  schema: z.object({
    factoryId: factoryIdSchema,
    workflowId: workflowIdSchema.optional(),
    runId: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe("A run to include in full, by its id or the scheduler's id."),
    sinceHours: z.coerce
      .number()
      .int()
      .min(1)
      .max(DIAGNOSTICS_MAX_HOURS)
      .default(DIAGNOSTICS_DEFAULT_HOURS)
      .describe("How far back tripwires and counts look, in hours."),
  }),
  http: { method: "GET" },
  readOnly: true,
  // What it reports moves while a run is in flight, so a second call is not a repeat.
  dedupe: false,
  run: async ({ factoryId, workflowId, runId, sinceHours }, context) =>
    withReadFailures(async () => {
      const caller = await resolveWorkflowReadScope(factoryId, context);
      const { orgId, userEmail } = caller;
      return buildWorkflowDiagnostics(
        {
          now: () => new Date(),
          caller: { userEmail },
          build: () => {
            const { release, buildId } = getAppConfig().observability;
            return {
              app: "factory" as const,
              release: release ?? "unknown",
              buildId: buildId ?? "unknown",
            };
          },
          environment: () => {
            const jobs = scheduledTriggerAvailability();
            return {
              deployEnvironment: resolveDeployEnvironment(),
              deployPlatform: resolveDeployPlatform(),
              serverless: isServerlessRuntime(),
              recurringJobs: jobs.available
                ? { available: true, driver: jobs.driver }
                : {
                    available: false,
                    reason: jobs.reason,
                    ...("secret" in jobs ? { missingSecret: jobs.secret } : {}),
                  },
            };
          },
          scheduler: async () => {
            const [organization, global] = await Promise.all([
              getAutomationSchedulerHealth({ appId: "factory", orgId }),
              getAutomationSchedulerHealth({ appId: "factory", orgId: null }),
            ]);
            const health =
              [organization, global]
                .filter(
                  (candidate): candidate is NonNullable<typeof candidate> =>
                    candidate !== null && candidate.lastCheckedAt !== null,
                )
                .sort(
                  (left, right) =>
                    (right.lastCheckedAt ?? 0) - (left.lastCheckedAt ?? 0),
                )[0] ??
              organization ??
              global;
            return health
              ? {
                  lastCheckedAt: health.lastCheckedAt,
                  lastDispatchedAt: health.lastDispatchedAt,
                  lastError: health.lastError,
                  runtime: health.runtime,
                  staleAfterMs: SCHEDULER_STALE_AFTER_MS,
                }
              : null;
          },
          connections: (providers) =>
            readProviderConnections(providers, { userEmail, orgId }),
          jobHealth: async (workflow) =>
            summarizeWorkflowJob(
              workflow.automationId
                ? await findFactoryAutomationDefinition(
                    orgId,
                    factoryId,
                    workflow.automationId,
                  )
                : null,
              {
                enabled: workflow.enabled,
                schedule: planWorkflowJob(workflow.graph).plan?.schedule,
              },
            ),
          store: getWorkflowStore(),
          models: caller.models,
          tripwires: createDrizzleTripwireStore({ getDatabase: () => getDb() }),
          getDatabase: () => getDb(),
        },
        {
          scope: caller.scope,
          ...(workflowId === undefined ? {} : { workflowId }),
          ...(runId === undefined ? {} : { runId }),
          sinceHours,
        },
      );
    }),
});
