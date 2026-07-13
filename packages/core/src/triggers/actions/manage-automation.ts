import { z } from "zod";

import { defineAction } from "../../action.js";
import { isValidCron, nextOccurrence } from "../../jobs/cron.js";
import {
  resourceDelete,
  resourceGetByPath,
  resourcePut,
} from "../../resources/store.js";
import {
  buildTriggerContent,
  parseTriggerFrontmatter,
  refreshEventSubscriptions,
} from "../dispatcher.js";

export default defineAction({
  description:
    "Enable, disable, or delete a personal automation from the Agent Jobs page.",
  agentTool: false,
  schema: z.object({
    operation: z.enum(["update", "delete"]),
    name: z.string().min(1),
    scope: z.enum(["personal", "organization"]).default("personal"),
    enabled: z.boolean().optional(),
  }),
  run: async ({ operation, name, scope, enabled }, ctx) => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) throw new Error("Not authenticated.");
    if (scope === "organization") {
      throw Object.assign(new Error("Automations are personal today."), {
        statusCode: 400,
      });
    }

    const path = `jobs/${name}.md`;
    const resource = await resourceGetByPath(userEmail, path);
    if (!resource) {
      throw Object.assign(new Error(`Automation "${name}" not found.`), {
        statusCode: 404,
      });
    }
    const { meta, body } = parseTriggerFrontmatter(resource.content);
    const header = resource.content.match(/^---\n([\s\S]*?)\n---/m)?.[1] ?? "";
    if (!/^triggerType\s*:/m.test(header)) {
      throw Object.assign(new Error(`Automation "${name}" not found.`), {
        statusCode: 404,
      });
    }

    if (operation === "delete") {
      await resourceDelete(resource.id);
      await refreshEventSubscriptions();
      return { deleted: true, name };
    }
    if (enabled === undefined) {
      throw Object.assign(new Error("enabled is required for update."), {
        statusCode: 400,
      });
    }

    meta.enabled = enabled;
    if (
      enabled &&
      meta.triggerType === "schedule" &&
      meta.schedule &&
      isValidCron(meta.schedule)
    ) {
      meta.nextRun = nextOccurrence(meta.schedule).toISOString();
    }
    await resourcePut(
      resource.owner,
      resource.path,
      buildTriggerContent(meta, body),
    );
    await refreshEventSubscriptions();
    return { name, enabled: meta.enabled, nextRun: meta.nextRun ?? null };
  },
});
