import { fail } from "@agent-native/core/action";
import { isValidCron } from "@agent-native/core/jobs";
import { getOrgSetting, putOrgSetting } from "@agent-native/core/settings";
import { z } from "zod";

import type { IndexSchedule } from "./brain-contract.js";

export const INDEX_SCHEDULE_SETTING_KEY = "analytics-index-schedule";
export const DEFAULT_INDEX_SCHEDULE_CRON = "0 6 * * *";
export const DEFAULT_INDEX_SCHEDULE_TIMEZONE = "UTC";
export const DEFAULT_INDEX_SCHEDULE_AUTOMATION_NAME = "analytics-data-index";

const storedIndexScheduleSchema = z.object({
  enabled: z.boolean(),
  cron: z.string().min(1),
  timezone: z.string().min(1),
  automationName: z.string().min(1).nullable(),
});

export function defaultIndexSchedule(): IndexSchedule {
  return {
    enabled: false,
    cron: DEFAULT_INDEX_SCHEDULE_CRON,
    timezone: DEFAULT_INDEX_SCHEDULE_TIMEZONE,
    automationName: null,
  };
}

// Same check as isValidTimezone in packages/core/src/jobs/cron.ts, which is
// not exported from a public subpath. Keep the two in step.
export function isValidIndexScheduleTimezone(timezone: string): boolean {
  if (!timezone.trim()) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
    // coercion-ok: an unknown IANA timezone is an explicit false validation result
  } catch {
    return false;
  }
}

export function parseIndexScheduleInput(input: {
  cron: string;
  timezone: string;
}): { cron: string; timezone: string } {
  const cron = input.cron.trim();
  const timezone = input.timezone.trim();
  // isValidCron alone accepts an empty string and six-field (seconds) forms;
  // the contract is five-field only.
  if (cron.split(/\s+/).length !== 5 || !isValidCron(cron)) {
    fail(
      `Invalid cron expression "${cron}". Use five fields, for example "${DEFAULT_INDEX_SCHEDULE_CRON}".`,
      { errorCode: "invalid_index_schedule", statusCode: 400 },
    );
  }
  if (!isValidIndexScheduleTimezone(timezone)) {
    fail(
      `Unknown timezone "${timezone}". Use an IANA name such as "UTC" or "America/New_York".`,
      { errorCode: "invalid_index_schedule", statusCode: 400 },
    );
  }
  return { cron, timezone };
}

export async function readIndexSchedule(orgId: string): Promise<IndexSchedule> {
  const stored = await getOrgSetting(orgId, INDEX_SCHEDULE_SETTING_KEY);
  if (!stored) return defaultIndexSchedule();
  const parsed = storedIndexScheduleSchema.safeParse(stored);
  if (!parsed.success) {
    // Only the set action writes this setting, so a mismatch means the row was
    // edited outside the app. Saving cannot repair it because saving reads it
    // first; the row has to be fixed or removed by hand.
    fail(
      `The saved index schedule (setting ${INDEX_SCHEDULE_SETTING_KEY}) is unreadable and must be repaired before it can be read or changed.`,
      { errorCode: "index_schedule_unreadable", statusCode: 500 },
    );
  }
  return parsed.data;
}

export async function writeIndexSchedule(
  orgId: string,
  schedule: IndexSchedule,
): Promise<void> {
  await putOrgSetting(orgId, INDEX_SCHEDULE_SETTING_KEY, { ...schedule });
}
