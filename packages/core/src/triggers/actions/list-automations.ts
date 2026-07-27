import { z } from "zod";

import { defineAction } from "../../action.js";
import { describeCron, isValidCron, nextOccurrence } from "../../jobs/cron.js";
import { resourceGetByPath, resourceList } from "../../resources/store.js";
import { parseTriggerFrontmatter } from "../dispatcher.js";

const scopeSchema = z.enum(["personal", "organization"]);

function hasTriggerFrontmatter(content: string): boolean {
  const header = content.match(/^---\n([\s\S]*?)\n---/m)?.[1] ?? "";
  return /^triggerType\s*:/m.test(header);
}

function nextRun(
  meta: ReturnType<typeof parseTriggerFrontmatter>["meta"],
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
  canUpdate: boolean;
}

export default defineAction({
  description:
    "List event-triggered and schedule-triggered automations in the selected scope. Automations are currently personal-only.",
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
    if (scope === "organization") return [];

    const owner = userEmail;
    const resources = await resourceList(owner, "jobs/");
    const automations: AutomationActionItem[] = [];

    for (const resource of resources) {
      if (!resource.path.endsWith(".md") || resource.path.endsWith(".keep")) {
        continue;
      }
      const full = await resourceGetByPath(owner, resource.path);
      if (!full || !hasTriggerFrontmatter(full.content)) continue;
      const { meta, body } = parseTriggerFrontmatter(full.content);
      automations.push({
        id: full.id,
        name: resource.path.replace(/^jobs\//, "").replace(/\.md$/, ""),
        path: resource.path,
        scope,
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
        canUpdate: true,
      });
    }

    return automations;
  },
});
