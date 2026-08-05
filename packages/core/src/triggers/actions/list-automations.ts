import { z } from "zod";

import { defineAction } from "../../action.js";
import { listAccessibleAutomationDefinitions } from "../../automations/service.js";
import {
  describeCron,
  effectiveTimezone,
  isValidCron,
  nextOccurrence,
} from "../../jobs/cron.js";

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
  return scheduled
    ? nextOccurrence(meta.schedule!, undefined, meta.timezone).toISOString()
    : null;
}

export interface AutomationActionItem {
  id: string;
  resourceId: string;
  name: string;
  path: string;
  scope: "personal" | "organization";
  classification: "automation" | "recurring-job";
  triggerType: "event" | "schedule" | "manual";
  event: string | null;
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
  nextRun: string | null;
  createdBy: string | null;
  model: string | null;
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
    return definitions
      .filter((definition) => !scope || definition.scope === scope)
      .map(
        ({
          resource,
          name,
          classification,
          meta,
          body,
          scope,
          canUpdate,
          effectiveRole,
          capabilities,
          sharing,
          creator,
        }) => ({
          id: resource.id,
          resourceId: resource.id,
          name,
          path: resource.path,
          scope,
          classification:
            classification.kind === "automation"
              ? "automation"
              : "recurring-job",
          triggerType:
            classification.kind === "automation"
              ? classification.triggerType
              : "schedule",
          event: meta.triggerType === "event" ? (meta.event ?? null) : null,
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
            meta.triggerType === "manual" ? null : (meta.condition ?? null),
          body,
          enabled: meta.enabled,
          lastRun: meta.lastRun ?? null,
          lastCheck: meta.lastCheck ?? null,
          lastStatus: meta.lastStatus ?? null,
          lastError: meta.lastError ?? null,
          nextRun: nextRun(meta),
          createdBy: meta.createdBy ?? null,
          model: meta.model ?? null,
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
        }),
      );
  },
});
