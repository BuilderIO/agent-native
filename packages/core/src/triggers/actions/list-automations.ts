import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  listAutomationDefinitions,
  type AutomationScope,
} from "../../automations/service.js";
import { describeCron, isValidCron, nextOccurrence } from "../../jobs/cron.js";

const scopeSchema = z.enum(["personal", "organization"]);

function nextRun(
  meta: Awaited<ReturnType<typeof listAutomationDefinitions>>[number]["meta"],
): string | null {
  if (!meta.enabled) return null;
  if (meta.nextRun) return meta.nextRun;
  if (
    meta.triggerType === "schedule" &&
    meta.schedule &&
    isValidCron(meta.schedule)
  ) {
    return nextOccurrence(meta.schedule).toISOString();
  }
  return null;
}

export interface AutomationActionItem {
  id: string;
  name: string;
  path: string;
  scope: "personal" | "organization";
  triggerType: "event" | "schedule";
  event: string | null;
  schedule: string | null;
  scheduleDescription: string | null;
  condition: string | null;
  body: string;
  enabled: boolean;
  lastRun: string | null;
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
}

export default defineAction({
  description:
    "List event-triggered and schedule-triggered automations in the selected personal or organization scope.",
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
      { userEmail, orgId: ctx?.orgId },
      scope as AutomationScope,
    );
    return definitions.map(({ resource, name, meta, body, canUpdate }) => ({
      id: resource.id,
      name,
      path: resource.path,
      scope: scope as AutomationScope,
      triggerType: meta.triggerType,
      event: meta.event ?? null,
      schedule: meta.schedule || null,
      scheduleDescription: meta.schedule ? describeCron(meta.schedule) : null,
      condition: meta.condition ?? null,
      body,
      enabled: meta.enabled,
      lastRun: meta.lastRun ?? null,
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
    }));
  },
});
