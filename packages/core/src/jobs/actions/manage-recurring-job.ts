import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  organizationResourceOwner,
  resourceDelete,
  resourceGetByPath,
  resourcePut,
} from "../../resources/store.js";
import { isValidCron, isValidTimezone, nextOccurrence } from "../cron.js";
import {
  classifyJobResource,
  patchJobFrontmatterFields,
  type JobFrontmatterPatch,
} from "../frontmatter.js";
import { deleteAutomationRuns } from "../run-history.js";
import { parseJobFrontmatter } from "../scheduler.js";
import { authorizeJobMutation } from "../tools.js";

const scopeSchema = z.enum(["personal", "organization"]);

export default defineAction({
  description:
    "Enable, pause, or delete one legacy recurring cron job from the Agent Automations page.",
  agentTool: false,
  schema: z.object({
    operation: z.enum(["update", "delete"]),
    name: z.string().min(1),
    scope: scopeSchema.default("personal"),
    enabled: z.boolean().optional(),
    schedule: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
  }),
  run: async ({ operation, name, scope, enabled, schedule, timezone }, ctx) => {
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

    const { meta } = parseJobFrontmatter(resource.content);
    if (classifyJobResource(resource.content).kind === "automation") {
      throw Object.assign(new Error(`Job "${name}" is an automation.`), {
        statusCode: 400,
      });
    }
    const denied = await authorizeJobMutation(resource.owner, meta, ctx.appId);
    if (denied) throw Object.assign(new Error(denied), { statusCode: 403 });

    if (operation === "delete") {
      await resourceDelete(resource.id);
      // Names are reusable; history left behind would surface as the run
      // history of whatever job is next created under this name.
      await deleteAutomationRuns(resource.owner, name);
      return { deleted: true, name };
    }

    const fields: JobFrontmatterPatch = {};
    if (timezone !== undefined) {
      if (!isValidTimezone(timezone)) {
        throw Object.assign(new Error(`Unknown timezone "${timezone}".`), {
          statusCode: 400,
        });
      }
      meta.timezone = timezone;
      fields.timezone = timezone;
    }
    if (
      enabled === undefined &&
      schedule === undefined &&
      timezone === undefined
    ) {
      throw Object.assign(
        new Error("enabled, schedule, or timezone is required for update."),
        { statusCode: 400 },
      );
    }
    if (schedule !== undefined) {
      if (!isValidCron(schedule)) {
        throw Object.assign(
          new Error(`Invalid cron expression "${schedule}".`),
          { statusCode: 400 },
        );
      }
      meta.schedule = schedule;
      fields.schedule = schedule;
    }
    if (enabled !== undefined) {
      meta.enabled = enabled;
      fields.enabled = enabled;
    }
    if (meta.enabled && meta.schedule && isValidCron(meta.schedule)) {
      meta.nextRun = nextOccurrence(
        meta.schedule,
        undefined,
        meta.timezone,
      ).toISOString();
      fields.nextRun = meta.nextRun;
    }
    await resourcePut(
      resource.owner,
      resource.path,
      patchJobFrontmatterFields(resource.content, fields),
    );

    return {
      name,
      enabled: meta.enabled,
      nextRun: meta.nextRun ?? null,
    };
  },
});
