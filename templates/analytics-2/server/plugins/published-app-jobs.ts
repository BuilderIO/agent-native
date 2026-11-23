import { randomUUID } from "node:crypto";

import { SHARED_OWNER } from "@agent-native/core/resources";
import {
  getAppConfig,
  registerJobRunner,
  registerRecurringSweepHandler,
  type JobRunnerContext,
  type JobRunnerResult,
} from "@agent-native/core/server";
import { and, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { phase1ScheduleFixture } from "../execution/phase1-schedule-fixture.js";
import {
  ensurePublishedAppScheduleTrigger,
  PUBLISHED_APP_SCHEDULE_RUNNER,
  PUBLISHED_APP_SCHEDULE_TRIGGER,
} from "../model/published-app-schedule-trigger.js";

async function runPublishedAppJob(
  context: JobRunnerContext,
  projectId?: string,
): Promise<JobRunnerResult> {
  if (
    context.path !== PUBLISHED_APP_SCHEDULE_TRIGGER ||
    context.ownerEmail !== SHARED_OWNER ||
    context.manual
  ) {
    return {
      status: "skipped",
      reason: "Invalid published app schedule trigger.",
    };
  }
  const { runPublishedAppSchedules } =
    await import("../model/published-app-jobs.js");
  return runPublishedAppSchedules(context, projectId);
}

export default function registerPublishedAppJobs() {
  registerJobRunner(PUBLISHED_APP_SCHEDULE_RUNNER, runPublishedAppJob);
  registerRecurringSweepHandler(
    PUBLISHED_APP_SCHEDULE_RUNNER,
    ensurePublishedAppScheduleTrigger,
  );
  const fixture = phase1ScheduleFixture();
  if (fixture) {
    const buildSha = getAppConfig().observability.buildSha;
    if (!buildSha) throw new Error("The Phase 1 scheduler has no build SHA");
    fixture.registerScheduler({
      buildSha,
      async sweep({ projectId, scheduleId, dueAt }) {
        const db = getDb();
        const [schedule] = await db
          .select({
            orgId: schema.projects.orgId,
            title: schema.projects.title,
          })
          .from(schema.publishedAppSchedules)
          .innerJoin(
            schema.projects,
            eq(schema.publishedAppSchedules.projectId, schema.projects.id),
          )
          .where(
            and(
              eq(schema.projects.id, projectId),
              eq(schema.publishedAppSchedules.id, scheduleId),
            ),
          )
          .limit(1);
        if (!schedule?.orgId || !schedule.title.startsWith("schedule15-v1 "))
          throw new Error("Expected the Phase 1 schedule project");
        const signal = AbortSignal.timeout(10_000);
        return runPublishedAppJob(
          {
            name: PUBLISHED_APP_SCHEDULE_RUNNER,
            path: PUBLISHED_APP_SCHEDULE_TRIGGER,
            meta: {
              schedule: "* * * * *",
              enabled: true,
              runner: PUBLISHED_APP_SCHEDULE_RUNNER,
            },
            ownerEmail: SHARED_OWNER,
            orgId: schedule.orgId,
            historyId: randomUUID(),
            manual: false,
            scheduledFor: dueAt,
            deadlineAt: Date.now() + 9_000,
            hardDeadlineAt: Date.now() + 10_000,
            signal,
            async assertCanContinue() {
              signal.throwIfAborted();
            },
            actionAutomation: {
              triggerId: scheduleId,
              triggerName: PUBLISHED_APP_SCHEDULE_RUNNER,
            },
          },
          projectId,
        );
      },
      async settled({ projectId, scheduleId, dueAt }) {
        const {
          publishedAppScheduleTicks: ticks,
          publishedAppScheduleDeliveries: deliveries,
        } = schema;
        const db = getDb();
        const [tick] = await db
          .select({ id: ticks.id, terminalAt: ticks.terminalAt })
          .from(ticks)
          .where(
            and(
              eq(ticks.projectId, projectId),
              eq(ticks.scheduleId, scheduleId),
              eq(ticks.dueAt, new Date(dueAt).toISOString()),
            ),
          )
          .limit(1);
        if (!tick?.terminalAt) return false;
        const pending = await db
          .select({ id: deliveries.id })
          .from(deliveries)
          .where(
            and(
              eq(deliveries.tickId, tick.id),
              inArray(deliveries.status, ["pending", "sending"]),
            ),
          )
          .limit(1);
        return pending.length === 0;
      },
    });
  }
}
