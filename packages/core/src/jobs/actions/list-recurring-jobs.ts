import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  organizationResourceOwner,
  resourceGetByPath,
  resourceList,
} from "../../resources/store.js";
import { describeCron, isValidCron, nextOccurrence } from "../cron.js";
import { parseJobFrontmatter } from "../scheduler.js";
import { authorizeJobMutation } from "../tools.js";

const scopeSchema = z.enum(["personal", "organization"]);

function hasTriggerFrontmatter(content: string): boolean {
  const header = content.match(/^---\n([\s\S]*?)\n---/m)?.[1] ?? "";
  return /^triggerType\s*:/m.test(header);
}

function jobName(path: string): string {
  return path.replace(/^jobs\//, "").replace(/\.md$/, "");
}

function nextRun(
  meta: ReturnType<typeof parseJobFrontmatter>["meta"],
): string | null {
  if (!meta.enabled) return null;
  if (meta.nextRun) return meta.nextRun;
  if (meta.schedule && isValidCron(meta.schedule)) {
    return nextOccurrence(meta.schedule).toISOString();
  }
  return null;
}

export interface RecurringJobActionItem {
  id: string;
  name: string;
  path: string;
  scope: "personal" | "organization";
  schedule: string;
  scheduleDescription: string;
  instructions: string;
  enabled: boolean;
  lastRun: string | null;
  lastStatus: string | null;
  lastError: string | null;
  nextRun: string | null;
  createdBy: string | null;
  canUpdate: boolean;
}

export default defineAction({
  description:
    "List recurring cron jobs visible in the selected personal or organization scope. This read surface is used by the Agent Jobs page.",
  agentTool: false,
  schema: z.object({
    scope: scopeSchema.default("personal"),
  }),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async ({ scope }, ctx): Promise<RecurringJobActionItem[]> => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) throw new Error("Not authenticated.");

    if (scope === "organization" && !ctx?.orgId) return [];

    const owner =
      scope === "organization"
        ? organizationResourceOwner(ctx.orgId as string)
        : userEmail;
    const resources = await resourceList(owner, "jobs/");
    const jobs: RecurringJobActionItem[] = [];

    for (const resource of resources) {
      if (!resource.path.endsWith(".md") || resource.path.endsWith(".keep")) {
        continue;
      }
      const full = await resourceGetByPath(owner, resource.path);
      if (!full || hasTriggerFrontmatter(full.content)) continue;

      const { meta, body } = parseJobFrontmatter(full.content);
      const canUpdate =
        scope === "personal" || !(await authorizeJobMutation(owner, meta));
      jobs.push({
        id: full.id,
        name: jobName(full.path),
        path: full.path,
        scope,
        schedule: meta.schedule,
        scheduleDescription: meta.schedule ? describeCron(meta.schedule) : "",
        instructions: body,
        enabled: meta.enabled,
        lastRun: meta.lastRun ?? null,
        lastStatus: meta.lastStatus ?? null,
        lastError: meta.lastError ?? null,
        nextRun: nextRun(meta),
        createdBy: meta.createdBy ?? null,
        canUpdate,
      });
    }

    return jobs;
  },
});
