import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  listAutomationDefinitions,
  type AutomationScope,
} from "../../automations/service.js";
import {
  hasStalePause,
  isPausedByFramework,
} from "../../jobs/automation-outcome.js";
import {
  describeCron,
  effectiveTimezone,
  isValidCron,
  nextOccurrence,
} from "../../jobs/cron.js";
import { listLatestAutomationRuns } from "../../jobs/run-history.js";

const scopeSchema = z.enum(["personal", "organization"]);

function nextRun(
  meta: Awaited<ReturnType<typeof listAutomationDefinitions>>[number]["meta"],
): string | null {
  if (!meta.enabled) return null;
  const scheduled = Boolean(
    meta.triggerType === "schedule" &&
    meta.schedule &&
    isValidCron(meta.schedule),
  );
  if (meta.nextRun) {
    const stored = new Date(meta.nextRun).getTime();
    if (!Number.isFinite(stored) || stored > Date.now() || !scheduled) {
      return meta.nextRun;
    }
  }
  return scheduled
    ? nextOccurrence(meta.schedule!, undefined, meta.timezone).toISOString()
    : null;
}

export interface AutomationActionItem {
  id: string;
  name: string;
  path: string;
  scope: "personal" | "organization";
  triggerType: "event" | "schedule" | "webhook";
  event: string | null;
  webhookPath: string | null;
  schedule: string | null;
  timezone: string | null;
  scheduleDescription: string | null;
  condition: string | null;
  body: string;
  enabled: boolean;
  lastRun: string | null;
  lastCheck: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
  /** Set when the framework paused the automation after repeated failures. */
  pausedReason: string | null;
  pausedAt: string | null;
  nextRun: string | null;
  createdBy: string | null;
  model: string | null;
  reasoningEffort: string | null;
  executionHostId: string | null;
  executionEngine: string | null;
  executionCwd: string | null;
  mcpTools: string[];
  originScopeId: string | null;
  deliveryPlatform: string | null;
  deliveryDestination: string | null;
  deliveryThreadRef: string | null;
  deliveryTenantId: string | null;
  canUpdate: boolean;
}

export default defineAction({
  description:
    "List scheduled, event-triggered, and webhook-triggered automations in the selected personal or organization scope.",
  agentTool: false,
  schema: z.object({
    scope: scopeSchema.default("personal"),
  }),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async ({ scope }, ctx): Promise<AutomationActionItem[]> => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) throw new Error("Not authenticated.");
    const definitions = await listAutomationDefinitions(
      { userEmail, orgId: ctx?.orgId, appId: ctx?.appId },
      scope as AutomationScope,
    );
    const latestRuns = await listLatestAutomationRuns({
      owners: definitions.map(({ resource }) => resource.owner),
      appId: ctx?.appId,
    });
    const runsByResource = new Map(
      latestRuns.map((run) => [`${run.owner}\0${run.path}`, run]),
    );
    return definitions.map(
      ({ resource, name, meta, body, canUpdate, webhookPath }) => {
        const run = runsByResource.get(`${resource.owner}\0${resource.path}`);
        const metadataRunAt = meta.lastRun ? Date.parse(meta.lastRun) : NaN;
        // The run history would otherwise report the last failed run and hide
        // that the framework has since paused the automation.
        const paused = isPausedByFramework(meta);
        const latestRun =
          !paused &&
          run &&
          (!Number.isFinite(metadataRunAt) || run.startedAt > metadataRunAt)
            ? run
            : null;
        return {
          id: resource.id,
          name,
          path: resource.path,
          scope: scope as AutomationScope,
          triggerType: meta.triggerType,
          event: meta.event ?? null,
          webhookPath: canUpdate ? (webhookPath ?? null) : null,
          schedule: meta.schedule || null,
          timezone: meta.schedule ? effectiveTimezone(meta.timezone) : null,
          scheduleDescription: meta.schedule
            ? describeCron(meta.schedule, effectiveTimezone(meta.timezone))
            : null,
          condition: meta.condition ?? null,
          body,
          enabled: meta.enabled,
          lastRun: latestRun
            ? new Date(latestRun.startedAt).toISOString()
            : (meta.lastRun ?? null),
          lastCheck: meta.lastCheck ?? null,
          lastStatus: paused
            ? "paused"
            : latestRun
              ? latestRun.status
              : hasStalePause(meta) && meta.lastStatus === "paused"
                ? null
                : (meta.lastStatus ?? null),
          lastError: latestRun ? latestRun.error : (meta.lastError ?? null),
          lastErrorCode: latestRun
            ? latestRun.errorCode
            : (meta.lastErrorCode ?? null),
          pausedReason: paused ? (meta.pausedReason ?? null) : null,
          pausedAt: paused ? (meta.pausedAt ?? null) : null,
          nextRun: nextRun(meta),
          createdBy: meta.createdBy ?? null,
          model: meta.model ?? null,
          reasoningEffort: meta.reasoningEffort ?? null,
          executionHostId: meta.executionHostId ?? null,
          executionEngine: meta.executionEngine ?? null,
          executionCwd: meta.executionCwd ?? null,
          mcpTools: meta.mcpTools ?? [],
          originScopeId: meta.originScopeId ?? null,
          deliveryPlatform: meta.deliveryPlatform ?? null,
          deliveryDestination: meta.deliveryDestination ?? null,
          deliveryThreadRef: meta.deliveryThreadRef ?? null,
          deliveryTenantId: meta.deliveryTenantId ?? null,
          canUpdate,
        };
      },
    );
  },
});
