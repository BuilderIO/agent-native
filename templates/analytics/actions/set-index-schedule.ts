import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import {
  defineAutomation,
  listAutomationDefinitions,
  updateAutomation,
} from "@agent-native/core/triggers";
import { z } from "zod";

import type { IndexSchedule } from "../server/lib/brain-contract.js";
import { requireAnalyticsAdminContext } from "../server/lib/db-admin-connections.js";
import {
  DEFAULT_INDEX_SCHEDULE_AUTOMATION_NAME,
  parseIndexScheduleInput,
  readIndexSchedule,
  writeIndexSchedule,
} from "../server/lib/index-schedule.js";
import { cliBoolean } from "./schema-helpers.js";

const INDEX_RUN_BODY = [
  'Call the build-data-index action with trigger "scheduled".',
  "Then report the result in one sentence: whether the build succeeded, the entry count, and any error.",
].join("\n");

export default defineAction({
  description:
    "Enable, disable, or reschedule the organization's recurring data index build. Requires an organization owner or admin. Enabling creates or updates one scheduled automation that runs build-data-index. Disabling turns that automation off without deleting it.",
  schema: z.object({
    enabled: cliBoolean.describe("Whether the scheduled build runs."),
    cron: z
      .string()
      .describe(
        'Five-field cron expression, evaluated in the timezone below. For example "0 6 * * *".',
      ),
    timezone: z
      .string()
      .describe(
        'IANA timezone for the cron expression. For example "UTC" or "America/New_York".',
      ),
  }),
  run: async ({ enabled, cron, timezone }, ctx) => {
    const admin = await requireAnalyticsAdminContext({
      userEmail: getRequestUserEmail() || ctx?.userEmail,
      orgId: getRequestOrgId() || ctx?.orgId || null,
    });
    const schedule = parseIndexScheduleInput({ cron, timezone });
    // The scheduler matches org automations by app id. Without it the
    // automation would be saved but never run.
    const appId = ctx?.appId;
    if (!appId) {
      fail("Analytics automations need the app id from the action context.", {
        errorCode: "app_id_required",
        statusCode: 500,
      });
    }

    const current = await readIndexSchedule(admin.orgId);
    const name =
      current.automationName ?? DEFAULT_INDEX_SCHEDULE_AUTOMATION_NAME;
    const actor = { userEmail: admin.userEmail, orgId: admin.orgId, appId };
    const definitions = await listAutomationDefinitions(actor, "organization");
    const exists = definitions.some((definition) => definition.name === name);

    if (exists) {
      await updateAutomation(actor, {
        name,
        scope: "organization",
        enabled,
        schedule: schedule.cron,
        timezone: schedule.timezone,
        body: INDEX_RUN_BODY,
      });
    } else if (enabled) {
      await defineAutomation(actor, {
        name,
        scope: "organization",
        triggerType: "schedule",
        body: INDEX_RUN_BODY,
        schedule: schedule.cron,
        timezone: schedule.timezone,
      });
    }

    const next: IndexSchedule = {
      enabled,
      cron: schedule.cron,
      timezone: schedule.timezone,
      automationName: enabled || exists ? name : current.automationName,
    };
    await writeIndexSchedule(admin.orgId, next);
    return next;
  },
});
