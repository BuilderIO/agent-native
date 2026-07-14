import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  organizationResourceOwner,
  resourceDelete,
  resourceGetByPath,
  resourcePut,
} from "../../resources/store.js";
import { isValidCron, nextOccurrence } from "../cron.js";
import { buildJobContent, parseJobFrontmatter } from "../scheduler.js";
import { authorizeJobMutation } from "../tools.js";

const scopeSchema = z.enum(["personal", "organization"]);

function hasTriggerFrontmatter(content: string): boolean {
  const header = content.match(/^---\n([\s\S]*?)\n---/m)?.[1] ?? "";
  return /^triggerType\s*:/m.test(header);
}

export default defineAction({
  description:
    "Enable, pause, or delete one recurring cron job from the Agent Jobs page.",
  agentTool: false,
  schema: z.object({
    operation: z.enum(["update", "delete"]),
    name: z.string().min(1),
    scope: scopeSchema.default("personal"),
    enabled: z.boolean().optional(),
  }),
  run: async ({ operation, name, scope, enabled }, ctx) => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) throw new Error("Not authenticated.");
    if (scope === "organization" && !ctx?.orgId) {
      throw new Error("An organization is required for organization jobs.");
    }

    const owner =
      scope === "organization"
        ? organizationResourceOwner(ctx.orgId as string)
        : userEmail;
    const path = `jobs/${name}.md`;
    const resource = await resourceGetByPath(owner, path);
    if (!resource) {
      throw Object.assign(new Error(`Job "${name}" not found.`), {
        statusCode: 404,
      });
    }

    const { meta, body } = parseJobFrontmatter(resource.content);
    if (hasTriggerFrontmatter(resource.content)) {
      throw Object.assign(new Error(`Job "${name}" is an automation.`), {
        statusCode: 400,
      });
    }
    const denied = await authorizeJobMutation(resource.owner, meta);
    if (denied) throw Object.assign(new Error(denied), { statusCode: 403 });

    if (operation === "delete") {
      await resourceDelete(resource.id);
      return { deleted: true, name };
    }

    if (enabled === undefined) {
      throw Object.assign(new Error("enabled is required for update."), {
        statusCode: 400,
      });
    }
    meta.enabled = enabled;
    if (enabled && meta.schedule && isValidCron(meta.schedule)) {
      meta.nextRun = nextOccurrence(meta.schedule).toISOString();
    }
    await resourcePut(
      resource.owner,
      resource.path,
      buildJobContent(meta, body),
    );

    return {
      name,
      enabled: meta.enabled,
      nextRun: meta.nextRun ?? null,
    };
  },
});
