import { z } from "zod";

import { defineAction } from "../../action.js";
import { listAccessibleAutomationDefinitions } from "../../automations/service.js";
import { isPausedByFramework, hasStalePause } from "../automation-outcome.js";
import {
  describeCron,
  effectiveTimezone,
  isValidCron,
  nextOccurrence,
} from "../cron.js";
import { jobBelongsToApp, type JobFrontmatter } from "../frontmatter.js";

const scopeSchema = z.enum(["personal", "organization"]);

function nextRun(meta: JobFrontmatter): string | null {
  if (!meta.enabled) return null;
  const scheduled = Boolean(meta.schedule && isValidCron(meta.schedule));
  if (meta.nextRun) {
    const stored = new Date(meta.nextRun).getTime();
    if (!Number.isFinite(stored) || stored > Date.now() || !scheduled) {
      return meta.nextRun;
    }
  }
  return scheduled
    ? nextOccurrence(meta.schedule, undefined, meta.timezone).toISOString()
    : null;
}

export interface RecurringJobActionItem {
  id: string;
  resourceId: string;
  name: string;
  path: string;
  scope: "personal" | "organization";
  classification: "recurring-job";
  schedule: string;
  timezone: string;
  scheduleDescription: string;
  instructions: string;
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
  executionHostId: string | null;
  executionEngine: string | null;
  executionCwd: string | null;
  mcpTools: string[];
  canUpdate: boolean;
  effectiveRole: "owner" | "collaborate" | "view";
  capabilities: {
    canEdit: boolean;
    canOperate: boolean;
    canDelete: boolean;
    canManageSharing: boolean;
  };
}

export default defineAction({
  description:
    "List accessible legacy recurring cron jobs. The optional scope remains a compatibility filter; access is resolved by stable resource id.",
  agentTool: false,
  schema: z.object({
    scope: scopeSchema.optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async ({ scope }, ctx): Promise<RecurringJobActionItem[]> => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) throw new Error("Not authenticated.");

    const definitions = await listAccessibleAutomationDefinitions({
      userEmail,
      orgId: ctx?.orgId,
      appId: ctx?.appId,
    });
    return definitions
      .filter(({ classification }) => classification.kind === "job")
      .filter((definition) => !scope || definition.scope === scope)
      .filter((definition) => jobBelongsToApp(definition.meta, ctx?.appId))
      .map((definition) => {
        const {
          resource,
          name,
          scope: definitionScope,
          meta,
          body,
          canUpdate,
          effectiveRole,
          capabilities,
        } = definition;
        const pausedByFramework = isPausedByFramework(meta);
        return {
          id: resource.id,
          resourceId: resource.id,
          name,
          path: resource.path,
          scope: definitionScope,
          classification: "recurring-job",
          schedule: meta.schedule,
          timezone: effectiveTimezone(meta.timezone),
          scheduleDescription: meta.schedule
            ? describeCron(meta.schedule, effectiveTimezone(meta.timezone))
            : "",
          instructions: body,
          enabled: meta.enabled,
          lastRun: meta.lastRun ?? null,
          lastCheck: meta.lastCheck ?? null,
          lastStatus: pausedByFramework
            ? "paused"
            : hasStalePause(meta) && meta.lastStatus === "paused"
              ? null
              : (meta.lastStatus ?? null),
          lastError: meta.lastError ?? null,
          lastErrorCode: meta.lastErrorCode ?? null,
          pausedReason: pausedByFramework ? (meta.pausedReason ?? null) : null,
          pausedAt: pausedByFramework ? (meta.pausedAt ?? null) : null,
          nextRun: nextRun(meta),
          createdBy: meta.createdBy ?? null,
          executionHostId: meta.executionHostId ?? null,
          executionEngine: meta.executionEngine ?? null,
          executionCwd: meta.executionCwd ?? null,
          mcpTools: meta.mcpTools ?? [],
          canUpdate,
          effectiveRole,
          capabilities,
        };
      });
  },
});
