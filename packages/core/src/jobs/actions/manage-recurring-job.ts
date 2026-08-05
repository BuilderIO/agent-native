import { z } from "zod";

import { defineAction } from "../../action.js";
import { resolveAutomationAccess } from "../../automations/access.js";
import {
  organizationResourceOwner,
  resourceDelete,
  resourceGetByPath,
  resourcePut,
} from "../../resources/store.js";
import { isValidCron, isValidTimezone, nextOccurrence } from "../cron.js";
import { deleteAutomationRuns } from "../run-history.js";
import { buildJobContent, parseJobFrontmatter } from "../scheduler.js";

const scopeSchema = z.enum(["personal", "organization"]);

const schema = z
  .object({
    operation: z.enum(["update", "delete"]),
    resourceId: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    scope: scopeSchema.optional(),
    enabled: z.boolean().optional(),
    schedule: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
  })
  .refine((input) => input.resourceId || (input.name && input.scope), {
    message: "resourceId or name and scope is required.",
  });

export default defineAction({
  description:
    "Enable, pause, or delete one legacy recurring job by stable resourceId. Name and scope remain compatibility inputs.",
  agentTool: false,
  schema,
  run: async (input, ctx) => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) throw new Error("Not authenticated.");

    let resourceId = input.resourceId?.trim();
    if (!resourceId) {
      if (!input.name || !input.scope) {
        throw Object.assign(
          new Error("resourceId or name and scope is required."),
          { statusCode: 400 },
        );
      }
      if (input.scope === "organization" && !ctx?.orgId) {
        throw Object.assign(
          new Error("An organization is required for organization jobs."),
          { statusCode: 400 },
        );
      }
      const owner =
        input.scope === "organization"
          ? organizationResourceOwner(ctx.orgId as string)
          : userEmail;
      const resource = await resourceGetByPath(owner, `jobs/${input.name}.md`);
      resourceId = resource?.id;
    }

    const access = resourceId
      ? await resolveAutomationAccess({ userEmail }, resourceId)
      : null;
    if (!access || access.classification.kind !== "job") {
      throw Object.assign(new Error("Recurring job not found."), {
        statusCode: 404,
      });
    }
    if (input.operation === "delete" && !access.capabilities.canDelete) {
      throw Object.assign(new Error("Only the job owner can delete it."), {
        statusCode: 403,
      });
    }
    if (input.operation === "update" && !access.capabilities.canEdit) {
      throw Object.assign(
        new Error("Collaborate access is required to update this job."),
        { statusCode: 403 },
      );
    }

    const { resource, name } = access;
    const { meta, body } = parseJobFrontmatter(resource.content);
    if (input.operation === "delete") {
      await resourceDelete(resource.id);
      await deleteAutomationRuns(resource.owner, name);
      return { deleted: true, resourceId: resource.id, name };
    }

    if (
      input.enabled === undefined &&
      input.schedule === undefined &&
      input.timezone === undefined
    ) {
      throw Object.assign(
        new Error("enabled, schedule, or timezone is required for update."),
        { statusCode: 400 },
      );
    }
    if (input.timezone !== undefined) {
      if (!isValidTimezone(input.timezone)) {
        throw Object.assign(
          new Error(`Unknown timezone "${input.timezone}".`),
          { statusCode: 400 },
        );
      }
      meta.timezone = input.timezone;
    }
    if (input.schedule !== undefined) {
      if (!isValidCron(input.schedule)) {
        throw Object.assign(
          new Error(`Invalid cron expression "${input.schedule}".`),
          { statusCode: 400 },
        );
      }
      meta.schedule = input.schedule;
    }
    if (input.enabled !== undefined) meta.enabled = input.enabled;
    if (meta.enabled && meta.schedule && isValidCron(meta.schedule)) {
      meta.nextRun = nextOccurrence(
        meta.schedule,
        undefined,
        meta.timezone,
      ).toISOString();
    }
    await resourcePut(
      resource.owner,
      resource.path,
      buildJobContent(meta, body),
    );

    return {
      resourceId: resource.id,
      name,
      enabled: meta.enabled,
      nextRun: meta.nextRun ?? null,
    };
  },
});
