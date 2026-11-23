import { randomUUID } from "node:crypto";

import {
  getAppProductionUrl,
  getConfiguredAppBasePath,
  sendEmail,
  type JobRunnerContext,
  type JobRunnerResult,
} from "@agent-native/core/server";
import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";

import { runRequestSchema } from "../../shared/notebook-execution.js";
import { completeResultManifestSchema } from "../../shared/notebook-result-contract.js";
import { nextScheduleFire } from "../../shared/published-app-schedules.js";
import { getDb, schema } from "../db/index.js";
import { phase1ScheduleFixture } from "../execution/phase1-schedule-fixture.js";
import { ensureAnalyticsDatabase } from "./database.js";
import { digest } from "./notebook-execution/planner.js";
import {
  notebookOutputs,
  notebookResultManifests,
  notebookRunAttempts,
  notebookRuns,
  notebookRunWork,
} from "./notebook-execution/schema.js";
import {
  notebookRunStore,
  wakeNotebookRun,
} from "./notebook-execution/service.js";
import { MAX_NOTEBOOK_CELLS } from "./notebook-execution/snapshot.js";
import { checkNotebookAuthorities } from "./notebook-results.js";
import {
  actorForMember,
  findScheduleMember,
  lockScheduleProject,
  readScheduleRecipients,
  recipientCanRead,
  scheduleEmailAvailable,
  scheduleExecutionSnapshot,
  scheduleFlags,
  scheduleProjectAccess,
  scheduleRelease,
  verifyScheduleSources,
  withScheduleActor,
  type Schedule,
  type ScheduleTick,
} from "./published-app-schedules.js";
import { defaultCacheFor } from "./published-app-sessions.js";
import type { Queryable } from "./scope.js";

export { PUBLISHED_APP_SCHEDULE_RUNNER } from "./published-app-schedule-trigger.js";

const recoveryMs = 24 * 3_600_000;
const batchSize = 16;
const mailRetryMs = 60_000;
const mailRetryLimit = 4;
const {
  publishedAppDefaultCaches: caches,
  publishedAppSchedules: schedules,
  publishedAppScheduleTicks: ticks,
  publishedAppScheduleDeliveries: deliveries,
} = schema;

function beforeDeadline(context: JobRunnerContext) {
  return !context.signal.aborted && Date.now() < context.deadlineAt;
}
async function principalFor(
  db: Queryable,
  record: { orgId: string; projectId: string },
  memberId: string,
) {
  const member = await findScheduleMember(db, record.orgId, memberId);
  if (!member) return null;
  const actor = actorForMember(record.orgId, member);
  const access = await scheduleProjectAccess(db, actor, record.projectId);
  return access?.canManage ? actor : null;
}

async function claimDue(
  context: JobRunnerContext,
  clock: Date,
  candidate: Schedule,
) {
  const at = clock.toISOString();
  await getDb().transaction(async (tx) => {
    const project = await lockScheduleProject(
      tx,
      candidate.orgId,
      candidate.projectId,
    );
    const [row] = await tx
      .select()
      .from(schedules)
      .where(
        and(
          eq(schedules.id, candidate.id),
          eq(schedules.enabled, true),
          isNull(schedules.deletedAt),
          lte(schedules.nextFireAt, at),
        ),
      )
      .limit(1)
      .for("update", { skipLocked: true });
    if (!row?.nextFireAt) return;
    const dueAt = row.nextFireAt;
    const expired = Date.parse(dueAt) < clock.getTime() - recoveryMs;
    const advanceFrom = expired
      ? new Date(clock.getTime() - recoveryMs)
      : new Date(dueAt);
    const next = nextScheduleFire(row.cadence, row.timezone, advanceFrom);
    const actor = project && (await principalFor(tx, row, row.runPrincipalId));
    const release =
      actor &&
      (await scheduleRelease(
        tx,
        actor,
        row.projectId,
        project.publishedVersionId,
      ));
    const id = randomUUID();
    const authorized =
      !expired &&
      actor &&
      release &&
      (await verifyScheduleSources(actor, release));
    const snapshot = authorized ? scheduleExecutionSnapshot(release, id) : null;
    const reservation =
      snapshot && row.updatePublishedResults && release
        ? (await defaultCacheFor(release, tx)).generation
        : null;
    const members = (await readScheduleRecipients(tx, [row.id])).map(
      ({ memberId, on }) => ({ memberId, on }),
    );
    await context.assertCanContinue();
    await tx
      .insert(ticks)
      .values({
        id,
        orgId: row.orgId,
        projectId: row.projectId,
        scheduleId: row.id,
        principalId: row.runPrincipalId,
        dueAt,
        scheduleRevision: row.revision,
        releaseId: release?.id ?? null,
        snapshot,
        inputDigest: snapshot ? digest(snapshot) : null,
        flags: scheduleFlags(row),
        recipients: members,
        coreHistoryId: context.historyId,
        status: snapshot ? "queued" : "skipped",
        cacheReservation: reservation,
        cacheOutcome: snapshot ? "pending" : "preserved",
        diagnostic: snapshot
          ? null
          : {
              code: expired
                ? "recovery_window_elapsed"
                : release
                  ? "source_denied"
                  : "release_or_authority_unavailable",
            },
        createdAt: at,
        terminalAt: snapshot ? null : at,
      })
      .onConflictDoNothing();
    await tx
      .update(schedules)
      .set({
        nextFireAt: next ? next.toISOString() : null,
        ...(next ? {} : { enabled: false }),
      })
      .where(eq(schedules.id, row.id));
  });
}

type TickTerminal = {
  status: "succeeded" | "failed" | "cancelled" | "cancel_unknown" | "skipped";
  diagnostic?: string;
  cache?: "updated" | "preserved" | "superseded";
};

async function recordTerminal(
  tx: Queryable,
  tick: ScheduleTick,
  now: string,
  terminal: TickTerminal,
) {
  await tx
    .update(ticks)
    .set({
      status: terminal.status,
      diagnostic: terminal.diagnostic ? { code: terminal.diagnostic } : null,
      cacheOutcome: terminal.cache ?? "preserved",
      terminalAt: now,
    })
    .where(and(eq(ticks.id, tick.id), isNull(ticks.terminalAt)));
  if (
    (terminal.status !== "succeeded" && terminal.status !== "failed") ||
    !tick.releaseId
  )
    return;
  const eventType: "success" | "failure" =
    terminal.status === "succeeded" ? "success" : "failure";
  const members = tick.recipients.filter(
    ({ on }) => on === "both" || on === eventType,
  );
  if (members.length)
    await tx
      .insert(deliveries)
      .values(
        members.map(({ memberId }) => ({
          id: randomUUID(),
          tickId: tick.id,
          recipientId: memberId,
          eventType,
          dedupKey: digest([tick.id, memberId, "email"]),
          status: "pending" as const,
          sendAttempts: 0,
          nextRetryAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoNothing();
}

async function terminalRun(db: Queryable, tick: ScheduleTick) {
  if (!tick.runId || !tick.snapshot) return null;
  const [run] = await db
    .select()
    .from(notebookRuns)
    .where(
      and(
        eq(notebookRuns.id, tick.runId),
        eq(notebookRuns.orgId, tick.orgId),
        eq(notebookRuns.namespaceId, tick.snapshot.namespace.namespaceId),
      ),
    )
    .limit(1);
  if (!run) throw new Error("Scheduled notebook run is unreadable");
  const rows = await db
    .select({
      receipt: notebookRunAttempts.receipt,
      diagnostic: notebookRunAttempts.diagnostic,
      done: notebookRunWork.done,
      generation: notebookRunWork.generation,
    })
    .from(notebookRunWork)
    .innerJoin(
      notebookRunAttempts,
      eq(notebookRunAttempts.id, notebookRunWork.attemptId),
    )
    .where(eq(notebookRunWork.runId, run.id))
    .orderBy(asc(notebookRunWork.ordinal))
    .limit(MAX_NOTEBOOK_CELLS + 1);
  if (rows.length !== run.receipt.attempts.length)
    throw new Error("Scheduled notebook run attempts are unreadable");
  if (rows.some(({ done }) => !done)) return null;
  const failed = rows.find(({ receipt }) => receipt.state.status === "failed");
  const code = failed?.diagnostic?.code;
  if (failed)
    return {
      status:
        tick.status === "stopping" &&
        failed.receipt.state.status === "failed" &&
        failed.receipt.state.reason === "provider_outcome_unknown"
          ? ("cancel_unknown" as const)
          : ("failed" as const),
      diagnostic:
        code && /^[a-zA-Z0-9_-]{1,128}$/.test(code) ? code : "execution_failed",
    };
  if (rows.some(({ receipt }) => receipt.state.status === "cancelled"))
    return { status: "cancelled" as const };
  if (
    run.receipt.plan.rejectedCells.length ||
    rows.some(({ receipt }) => receipt.state.status !== "complete")
  )
    return { status: "failed" as const, diagnostic: "execution_plan_rejected" };
  if (
    rows.some(
      ({ receipt, generation }) =>
        receipt.attempt.outputGeneration !== generation,
    )
  )
    return {
      status: "failed" as const,
      diagnostic: "result_attempt_superseded",
    };
  const results = rows.flatMap(({ receipt: { state, attempt } }) =>
    state.status === "complete" && state.resultIds[0]
      ? [
          {
            cellId: attempt.cellId,
            resultId: state.resultIds[0],
            attempt,
            resultIds: state.resultIds,
          },
        ]
      : [],
  );
  const ids = results.flatMap(({ resultIds }) => resultIds);
  const artifacts = ids.length
    ? await db
        .select()
        .from(notebookResultManifests)
        .where(inArray(notebookResultManifests.id, ids))
        .limit(ids.length)
    : [];
  const manifests = new Map(
    artifacts.map(({ id, manifest }) => [id, manifest]),
  );
  const pointers = results.length
    ? await db
        .select()
        .from(notebookOutputs)
        .where(
          and(
            eq(notebookOutputs.namespaceId, run.namespaceId),
            inArray(
              notebookOutputs.cellId,
              results.map(({ cellId }) => cellId),
            ),
          ),
        )
        .limit(results.length)
    : [];
  const byCell = new Map(pointers.map((pointer) => [pointer.cellId, pointer]));
  const fenced = results.every(({ cellId, resultId, attempt, resultIds }) => {
    const pointer = byCell.get(cellId);
    return (
      pointer?.resultId === resultId &&
      pointer.generation === attempt.outputGeneration &&
      pointer.attemptId === attempt.attemptId &&
      resultIds.every((id) => {
        const parsed = completeResultManifestSchema.safeParse(
          manifests.get(id),
        );
        if (!parsed.success) return false;
        const { producer } = parsed.data.result;
        return (
          producer.runId === run.id &&
          producer.attemptId === attempt.attemptId &&
          producer.outputGeneration === attempt.outputGeneration
        );
      })
    );
  });
  if (!fenced || artifacts.some(({ authorities }) => authorities === null))
    return {
      status: "failed" as const,
      diagnostic: "incomplete_result_manifest",
    };
  return {
    status: "succeeded" as const,
    results: results.map(({ cellId, resultId }) => ({ cellId, resultId })),
    authorities: [
      ...new Map(
        artifacts.flatMap(({ authorities }) =>
          (authorities ?? []).map((authority) => [
            digest(authority),
            authority,
          ]),
        ),
      ).values(),
    ],
  };
}

async function processTick(
  context: JobRunnerContext,
  clock: Date,
  candidate: ScheduleTick,
) {
  const at = clock.toISOString();
  const result = await getDb().transaction(async (tx) => {
    const project = await lockScheduleProject(
      tx,
      candidate.orgId,
      candidate.projectId,
    );
    const [tick] = await tx
      .select()
      .from(ticks)
      .where(and(eq(ticks.id, candidate.id), isNull(ticks.terminalAt)))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!tick) return null;
    const actor = project && (await principalFor(tx, tick, tick.principalId));
    const release =
      actor &&
      (await scheduleRelease(tx, actor, tick.projectId, tick.releaseId));
    await context.assertCanContinue();
    if (!actor || !release || !tick.snapshot) {
      await recordTerminal(tx, tick, at, {
        status: "skipped",
        diagnostic: "release_or_authority_unavailable",
      });
      return null;
    }
    if (!tick.runId) {
      if (!(await verifyScheduleSources(actor, release))) {
        await recordTerminal(tx, tick, at, {
          status: "skipped",
          diagnostic: "source_denied",
        });
        return null;
      }
      const admission = await notebookRunStore.admit(
        actor,
        runRequestSchema.parse({
          snapshot: tick.snapshot,
          requestId: `schedule:${tick.id}`,
          mode: "run-all",
          restart: false,
          cache: tick.flags.useCachedSqlResults ? "reuse" : "bypass",
        }),
        undefined,
        tx,
      );
      if (admission.status === "pending" || admission.status === "unreadable")
        return null;
      if (admission.status !== "admitted") {
        await recordTerminal(tx, tick, at, {
          status: "failed",
          diagnostic: `admission_${admission.status}`,
        });
        return null;
      }
      await context.assertCanContinue();
      await tx
        .update(ticks)
        .set({ runId: admission.runId, status: "running" })
        .where(eq(ticks.id, tick.id));
      return { actor, runId: admission.runId };
    }
    const terminal = await terminalRun(tx, tick);
    if (!terminal) return { actor, runId: tick.runId };
    if (terminal.status !== "succeeded") {
      await recordTerminal(tx, tick, at, terminal);
      return null;
    }
    const sourceFailure = await withScheduleActor(actor, () =>
      checkNotebookAuthorities(actor, terminal.authorities),
    );
    if (sourceFailure?.status === "unreadable") return null;
    if (sourceFailure) {
      await recordTerminal(tx, tick, at, {
        status: "skipped",
        diagnostic: "source_denied",
      });
      return null;
    }
    let cache: TickTerminal["cache"] = "preserved";
    if (
      tick.flags.updatePublishedResults &&
      tick.cacheReservation !== null &&
      terminal.results.length
    ) {
      const [current] = await tx
        .select()
        .from(caches)
        .where(eq(caches.releaseId, release.id))
        .limit(1)
        .for("update");
      const eligible =
        project.publishedVersionId === release.id &&
        current?.runId === null &&
        (current.scheduleDueAt !== null
          ? current.scheduleDueAt < tick.dueAt
          : current.generation === tick.cacheReservation);
      cache = eligible ? "updated" : "superseded";
      if (eligible) {
        await context.assertCanContinue();
        await tx
          .update(caches)
          .set({
            generation: current.generation + 1n,
            results: terminal.results,
            refreshedAt: at,
            runId: null,
            scheduleDueAt: tick.dueAt,
          })
          .where(eq(caches.releaseId, release.id));
      }
    }
    await recordTerminal(tx, tick, at, { status: "succeeded", cache });
    return null;
  });
  if (result) wakeNotebookRun(result.actor, result.runId);
}

function escapeEmail(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function emailForTick(
  tick: ScheduleTick,
  releaseId: string,
  title: string,
  event: "success" | "failure",
) {
  const href = new URL(
    `${getConfiguredAppBasePath()}/app/${encodeURIComponent(tick.projectId)}/${encodeURIComponent(releaseId)}`,
    getAppProductionUrl(),
  );
  const subject = `Scheduled run ${event === "success" ? "succeeded" : "failed"}: ${title.replace(/[\r\n]/g, " ")}`;
  const details = `Scheduled for ${tick.dueAt}. Published version ${releaseId}.`;
  return {
    subject,
    text: `${details}\n${href.toString()}`,
    html: `<p>${escapeEmail(details)}</p><p><a href="${escapeEmail(href.toString())}">View app</a></p>`,
  };
}

type Delivery = typeof deliveries.$inferSelect;
async function attemptDelivery(
  context: JobRunnerContext,
  clock: Date,
  candidate: Delivery,
) {
  const db = getDb();
  const at = clock.toISOString();
  const attemptId = randomUUID();
  const claim = await db.transaction(async (tx) => {
    const [delivery] = await tx
      .select()
      .from(deliveries)
      .where(
        and(
          eq(deliveries.id, candidate.id),
          inArray(deliveries.status, ["pending", "sending"]),
          lte(deliveries.nextRetryAt, at),
        ),
      )
      .limit(1)
      .for("update", { skipLocked: true });
    if (!delivery) return null;
    const [tick] = await tx
      .select()
      .from(ticks)
      .where(eq(ticks.id, delivery.tickId))
      .limit(1);
    if (!tick) throw new Error("Scheduled delivery has no tick");
    await context.assertCanContinue();
    const first = delivery.firstAttemptAt ?? at;
    if (
      clock.getTime() - Date.parse(first) >= recoveryMs ||
      delivery.sendAttempts >= mailRetryLimit
    ) {
      await tx
        .update(deliveries)
        .set({ status: "unverified", nextRetryAt: null, updatedAt: at })
        .where(eq(deliveries.id, delivery.id));
      return null;
    }
    await tx
      .update(deliveries)
      .set({
        status: "sending",
        deliveryAttemptId: attemptId,
        sendAttempts: delivery.sendAttempts + 1,
        firstAttemptAt: first,
        nextRetryAt: new Date(clock.getTime() + mailRetryMs).toISOString(),
        updatedAt: at,
      })
      .where(eq(deliveries.id, delivery.id));
    return { delivery, tick };
  });
  if (!claim) return;
  const { delivery, tick } = claim;
  const member = await findScheduleMember(db, tick.orgId, delivery.recipientId);
  const active = (
    await readScheduleRecipients(db, [tick.scheduleId], delivery.recipientId)
  ).some(({ on }) => on === "both" || on === delivery.eventType);
  const principal = await principalFor(db, tick, tick.principalId);
  const release =
    principal &&
    (await scheduleRelease(db, principal, tick.projectId, tick.releaseId));
  const completed =
    release && tick.status === "succeeded" ? await terminalRun(db, tick) : null;
  let status: Delivery["status"] = "recipient_unavailable";
  let lastErrorCode: string | null = null;
  let nextRetryAt: string | null = null;
  const resultIds =
    completed?.status === "succeeded"
      ? completed.results.map(({ resultId }) => resultId)
      : undefined;
  if (
    member &&
    principal &&
    active &&
    release &&
    (await verifyScheduleSources(principal, release)) &&
    (await recipientCanRead(
      db,
      actorForMember(tick.orgId, member),
      release,
      resultIds,
    ))
  ) {
    if (!scheduleEmailAvailable(tick.projectId)) {
      status = "failed";
      lastErrorCode = "email_transport_unavailable";
    } else {
      await context.assertCanContinue();
      try {
        const message = {
          ...emailForTick(
            tick,
            release.id,
            release.project.title,
            delivery.eventType,
          ),
          to: member.email,
          idempotencyKey: delivery.dedupKey,
          timeoutMs: 15_000,
          signal: context.signal,
          useDeploymentCredentials: true,
          disableClickTracking: true,
          app: "analytics-2",
          orgId: tick.orgId,
          templateId: "analytics2-published-app-scheduled-run",
        };
        const fixture = phase1ScheduleFixture();
        const outcome = fixture?.now(tick.projectId)
          ? await fixture.deliver(tick.projectId, message)
          : await sendEmail(message);
        status =
          outcome.status === "sent" && outcome.provider === "resend"
            ? "sent"
            : outcome.status === "suppressed"
              ? "recipient_unavailable"
              : "unverified";
      } catch (error) {
        const response =
          error instanceof Error &&
          error.name === "EmailProviderError" &&
          "responseStatus" in error &&
          typeof error.responseStatus === "number"
            ? error.responseStatus
            : null;
        const rejected =
          response !== null &&
          response >= 400 &&
          response < 500 &&
          response !== 429 &&
          response !== 409;
        if (rejected) {
          status = "failed";
          lastErrorCode = "email_provider_rejected";
        } else if (delivery.sendAttempts + 1 < mailRetryLimit) {
          status = "pending";
          lastErrorCode = "email_outcome_unknown";
          const baseDelay = mailRetryMs * 2 ** delivery.sendAttempts;
          const jitteredDelay = Math.round(
            baseDelay * (0.75 + Math.random() * 0.5),
          );
          nextRetryAt = new Date(
            clock.getTime() + jitteredDelay,
          ).toISOString();
        } else {
          status = "unverified";
          lastErrorCode = "email_outcome_unknown";
        }
      }
    }
  }
  await context.assertCanContinue();
  await db
    .update(deliveries)
    .set({
      status,
      lastErrorCode,
      nextRetryAt,
      updatedAt: at,
      sentAt: status === "sent" ? at : null,
    })
    .where(
      and(
        eq(deliveries.id, delivery.id),
        eq(deliveries.deliveryAttemptId, attemptId),
      ),
    );
}

export async function runPublishedAppSchedules(
  context: JobRunnerContext,
  projectId?: string,
): Promise<JobRunnerResult> {
  await ensureAnalyticsDatabase();
  const clock = context.scheduledFor
    ? new Date(context.scheduledFor)
    : new Date();
  const at = clock.toISOString();
  const db = getDb();
  const due = await db
    .select()
    .from(schedules)
    .where(
      and(
        eq(schedules.enabled, true),
        isNull(schedules.deletedAt),
        lte(schedules.nextFireAt, at),
        context.orgId ? eq(schedules.orgId, context.orgId) : undefined,
        projectId ? eq(schedules.projectId, projectId) : undefined,
      ),
    )
    .orderBy(asc(schedules.nextFireAt), asc(schedules.id))
    .limit(batchSize);
  for (const candidate of due) {
    if (!beforeDeadline(context))
      return { status: "skipped", reason: "scheduler_budget_elapsed" };
    await context.assertCanContinue();
    await claimDue(context, clock, candidate);
  }
  const queued = await db
    .select()
    .from(ticks)
    .where(
      and(
        isNull(ticks.terminalAt),
        context.orgId ? eq(ticks.orgId, context.orgId) : undefined,
        projectId ? eq(ticks.projectId, projectId) : undefined,
      ),
    )
    .orderBy(asc(ticks.dueAt), asc(ticks.id))
    .limit(batchSize);
  for (const candidate of queued) {
    if (!beforeDeadline(context))
      return { status: "skipped", reason: "scheduler_budget_elapsed" };
    await context.assertCanContinue();
    await processTick(context, clock, candidate);
  }
  const pending = await db
    .select({ delivery: deliveries })
    .from(deliveries)
    .innerJoin(ticks, eq(ticks.id, deliveries.tickId))
    .where(
      and(
        inArray(deliveries.status, ["pending", "sending"]),
        lte(deliveries.nextRetryAt, at),
        context.orgId ? eq(ticks.orgId, context.orgId) : undefined,
        projectId ? eq(ticks.projectId, projectId) : undefined,
      ),
    )
    .orderBy(asc(deliveries.nextRetryAt), asc(deliveries.id))
    .limit(batchSize);
  for (const { delivery } of pending) {
    if (!beforeDeadline(context))
      return { status: "skipped", reason: "scheduler_budget_elapsed" };
    await context.assertCanContinue();
    await attemptDelivery(context, clock, delivery);
  }
  return { status: "success" };
}
