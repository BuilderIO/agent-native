import { nextOccurrence } from "@agent-native/core/jobs";
import {
  buildJobResourceContent,
  parseJobResource,
} from "@agent-native/core/jobs/frontmatter";
import {
  resourceGetByPath,
  resourcePutIfAbsent,
  SHARED_OWNER,
} from "@agent-native/core/resources";

export const PUBLISHED_APP_SCHEDULE_RUNNER =
  "analytics2-published-app-schedules";
export const PUBLISHED_APP_SCHEDULE_TRIGGER = `jobs/${PUBLISHED_APP_SCHEDULE_RUNNER}.md`;

const schedule = "* * * * *";
const timezone = "UTC";
const appId = "analytics-2";

export async function ensurePublishedAppScheduleTrigger(): Promise<void> {
  const existing = await resourceGetByPath(
    SHARED_OWNER,
    PUBLISHED_APP_SCHEDULE_TRIGGER,
  );
  if (existing) {
    const { meta } = parseJobResource(existing.content);
    if (
      meta.runner !== PUBLISHED_APP_SCHEDULE_RUNNER ||
      meta.schedule !== schedule ||
      meta.appId !== appId
    ) {
      throw new Error("The published app schedule trigger is misconfigured.");
    }
    return;
  }

  await resourcePutIfAbsent(
    SHARED_OWNER,
    PUBLISHED_APP_SCHEDULE_TRIGGER,
    buildJobResourceContent(
      {
        appId,
        triggerType: "schedule",
        runner: PUBLISHED_APP_SCHEDULE_RUNNER,
        schedule,
        timezone,
        enabled: true,
        nextRun: nextOccurrence(schedule, undefined, timezone).toISOString(),
      },
      "Admit and recover due analytics published app runs.",
    ),
    "text/markdown",
  );
}
