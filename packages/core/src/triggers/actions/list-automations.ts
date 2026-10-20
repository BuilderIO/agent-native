import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  listAccessibleAutomationDefinitions,
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

function nextRun(
  meta: Awaited<
    ReturnType<typeof listAccessibleAutomationDefinitions>
  >[number]["meta"],
): string | null {
  if (!meta.enabled) return null;
  const scheduled = Boolean(
    meta.triggerType === "schedule" &&
    meta.schedule &&
    isValidCron(meta.schedule),
  );
  // A stored `nextRun` in the past means the dispatcher kept declining to run
  // this automation, not that it is overdue. Report the real next occurrence
  // and let `lastError` carry the reason it keeps being passed over.
  if (!scheduled) return null;
  if (meta.nextRun) {
    const stored = new Date(meta.nextRun).getTime();
    if (!Number.isFinite(stored) || stored > Date.now()) {
      return meta.nextRun;
    }
  }
  return nextOccurrence(meta.schedule!, undefined, meta.timezone).toISOString();
}

export interface AutomationActionItem {
  id: string;
  resourceId: string;
  name: string;
  path: string;
  scope: AutomationScope;
  classification: "automation" | "recurring-job";
  triggerType: "event" | "schedule" | "manual" | "webhook";
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
  effectiveRole: "owner" | "collaborate" | "view";
  capabilities: {
    canEdit: boolean;
    canOperate: boolean;
    canDelete: boolean;
    canManageSharing: boolean;
  };
  sharing: {
    source: "explicit" | "legacy";
    visibility: "private" | "organization" | "shared";
    organizationId: string | null;
    grantCount: number;
    grants?: Array<{
      email: string;
      role: "view" | "collaborate";
      name: string | null;
      avatar: string | null;
    }>;
  };
  creator: { email: string | null; label: string | null };
}

export default defineAction({
  description:
    "List every accessible automation and legacy recurring job in one access-aware result.",
  agentTool: false,
  schema: z.object({
    scope: z.enum(["personal", "organization"]).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async ({ scope }, ctx): Promise<AutomationActionItem[]> => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) throw new Error("Not authenticated.");
    const definitions = await listAccessibleAutomationDefinitions({
      userEmail,
      orgId: ctx?.orgId,
    });
    const visible = definitions.filter(
      (definition) => !scope || definition.scope === scope,
    );
    const latestRuns = await listLatestAutomationRuns({
      owners: visible.map(({ resource }) => resource.owner),
      appId: ctx?.appId,
    });
    const runsByResource = new Map(
      latestRuns.map((run) => [`${run.owner}\0${run.path}`, run]),
    );

    return visible.map(
      ({
        resource,
        name,
        classification,
        meta,
        body,
        scope: automationScope,
        canUpdate,
        effectiveRole,
        capabilities,
        sharing,
        creator,
        webhookPath,
      }) => {
        const run = runsByResource.get(`${resource.owner}\0${resource.path}`);
        const metadataRunAt = meta.lastRun ? Date.parse(meta.lastRun) : NaN;
        const paused = isPausedByFramework(meta);
        const latestRun =
          !paused &&
          run &&
          (!Number.isFinite(metadataRunAt) || run.startedAt > metadataRunAt)
            ? run
            : null;

        return {
          id: resource.id,
          resourceId: resource.id,
          name,
          path: resource.path,
          scope: automationScope,
          classification:
            classification.kind === "automation"
              ? "automation"
              : "recurring-job",
          triggerType:
            classification.kind === "automation"
              ? classification.triggerType
              : "schedule",
          event: meta.triggerType === "event" ? (meta.event ?? null) : null,
          webhookPath: canUpdate ? (webhookPath ?? null) : null,
          schedule:
            meta.triggerType === "schedule" ? meta.schedule || null : null,
          timezone:
            meta.triggerType === "schedule" && meta.schedule
              ? effectiveTimezone(meta.timezone)
              : null,
          scheduleDescription:
            meta.triggerType === "schedule" && meta.schedule
              ? describeCron(meta.schedule, effectiveTimezone(meta.timezone))
              : null,
          condition:
            meta.triggerType === "event" ? (meta.condition ?? null) : null,
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
          effectiveRole,
          capabilities,
          sharing,
          creator,
        };
      },
    );
  },
});
