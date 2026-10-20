import { z } from "zod";

import { defineAction } from "../../action.js";
import { resolveAutomationAccess } from "../../automations/access.js";
import {
  deleteAutomationSharingStateWithDb,
  ensureAutomationSharingTables,
} from "../../automations/sharing-store.js";
import { getDbExec } from "../../db/client.js";
import {
  organizationResourceOwner,
  resourceDelete,
  resourceGetByPath,
} from "../../resources/store.js";
import { RESUME_AUTOMATION_PATCH } from "../automation-outcome.js";
import { isValidCron, isValidTimezone, nextOccurrence } from "../cron.js";
import { jobBelongsToApp, type JobFrontmatterPatch } from "../frontmatter.js";
import { deleteAutomationRuns } from "../run-history.js";
import { parseJobFrontmatter } from "../scheduler.js";
import { applyJobResourceEdit } from "../update-job-resource.js";

const scopeSchema = z.enum(["personal", "organization"]);

const schema = z
  .object({
    operation: z.enum(["update", "delete"]),
    resourceId: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).optional(),
    scope: scopeSchema.default("personal"),
    enabled: z.boolean().optional(),
    schedule: z.string().trim().min(1).optional(),
    timezone: z.string().trim().min(1).optional(),
  })
  .refine(({ resourceId, name }) => Boolean(resourceId) !== Boolean(name), {
    message: "Specify either a resourceId or a name and scope.",
  });

export default defineAction({
  description:
    "Enable, pause, or delete one legacy recurring job by stable resourceId. Name and scope remain compatibility inputs.",
  agentTool: false,
  schema,
  run: async (input, ctx) => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) throw new Error("Not authenticated.");

    let resourceId = input.resourceId;
    if (!resourceId && input.name) {
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
    if (
      !access ||
      access.classification.kind !== "job" ||
      !jobBelongsToApp(access.meta, ctx?.appId)
    ) {
      throw Object.assign(new Error("Recurring job not found."), {
        statusCode: 404,
      });
    }

    const { resource, name } = access;
    const allowedBySharing =
      input.operation === "delete"
        ? access.capabilities.canDelete
        : access.capabilities.canEdit;
    if (!allowedBySharing) {
      const message =
        input.operation === "delete"
          ? "Only the job owner can delete it."
          : "Collaborate access is required to update this job.";
      throw Object.assign(new Error(message), { statusCode: 403 });
    }

    if (input.operation === "delete") {
      await ensureAutomationSharingTables();
      await resourceDelete(resource.id);
      await deleteAutomationSharingStateWithDb(getDbExec(), resource.id);
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
    if (input.schedule !== undefined && !isValidCron(input.schedule)) {
      throw Object.assign(
        new Error(`Invalid cron expression "${input.schedule}".`),
        { statusCode: 400 },
      );
    }
    if (input.timezone !== undefined && !isValidTimezone(input.timezone)) {
      throw Object.assign(new Error(`Unknown timezone "${input.timezone}".`), {
        statusCode: 400,
      });
    }

    const edit = await applyJobResourceEdit({
      resource,
      fields: (content): JobFrontmatterPatch => {
        const { meta: latest } = parseJobFrontmatter(content);
        const fields: JobFrontmatterPatch = {};
        if (input.schedule !== undefined) fields.schedule = input.schedule;
        if (input.timezone !== undefined) fields.timezone = input.timezone;
        if (input.enabled !== undefined) {
          fields.enabled = input.enabled;
          if (
            input.enabled &&
            (latest.pausedReason ||
              latest.lastErrorCode ||
              latest.consecutiveFailures)
          ) {
            Object.assign(fields, RESUME_AUTOMATION_PATCH);
          }
        }

        const schedule = input.schedule ?? latest.schedule;
        const timezone = input.timezone ?? latest.timezone;
        const enabled = fields.enabled ?? latest.enabled;
        if (enabled && schedule && isValidCron(schedule)) {
          fields.nextRun = nextOccurrence(
            schedule,
            undefined,
            timezone,
          ).toISOString();
        }
        return fields;
      },
      revalidate: async (latestResource) => {
        const latestAccess = await resolveAutomationAccess(
          { userEmail },
          latestResource.id,
        );
        return Boolean(
          latestAccess &&
          latestAccess.classification.kind === "job" &&
          jobBelongsToApp(latestAccess.meta, ctx?.appId) &&
          latestAccess.capabilities.canEdit,
        );
      },
    });
    if (!edit.ok) {
      const statusCode =
        edit.reason === "unauthorized"
          ? 403
          : edit.reason === "conflict"
            ? 409
            : 404;
      throw Object.assign(
        new Error(
          edit.reason === "conflict"
            ? "Recurring job changed while it was being updated."
            : "Recurring job not found or no longer accessible.",
        ),
        { statusCode },
      );
    }

    const { meta: updated } = parseJobFrontmatter(edit.resource.content);
    return {
      resourceId: resource.id,
      name,
      enabled: updated.enabled,
      nextRun: updated.nextRun ?? null,
    };
  },
});
