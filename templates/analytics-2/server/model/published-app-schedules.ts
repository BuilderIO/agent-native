import { randomUUID } from "node:crypto";

import { fail, isActionContractError } from "@agent-native/core/action";
import { orgMembers } from "@agent-native/core/org";
import {
  readDeployCredentialEnv,
  runWithRequestContext,
} from "@agent-native/core/server";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import type { z } from "zod";

import {
  namespaceIdSchema,
  releaseIdSchema,
  resultIdSchema,
  runNamespaceSchema,
  type Snapshot,
} from "../../shared/notebook-execution.js";
import {
  nextScheduleFire,
  normalizedScheduleCron,
  scheduleIso,
  setScheduleOutput,
  stopScheduleRunOutput,
  type listSchedulesInput,
  type listScheduleRunsInput,
  type PublishedAppScheduleConfig,
  type scheduleRecipientsInput,
  type ScheduleRecipient,
  type setScheduleInput,
  type stopScheduleRunInput,
} from "../../shared/published-app-schedules.js";
import { getDb, schema } from "../db/index.js";
import { phase1ScheduleFixture } from "../execution/phase1-schedule-fixture.js";
import { sqlSource } from "../execution/source-resolver.js";
import { withWarehouseSource } from "../execution/warehouse-connector.js";
import { digest } from "./notebook-execution/planner.js";
import { notebookResultManifests } from "./notebook-execution/schema.js";
import { notebookRunStore } from "./notebook-execution/service.js";
import type {
  ExecutionActor,
  SnapshotReader,
} from "./notebook-execution/snapshot.js";
import { checkNotebookAuthorities } from "./notebook-results.js";
import { resolvePublishedProjectAccess } from "./project-access.js";
import {
  canManageProject,
  projectAccessLevel,
} from "./project-grant-access.js";
import { readProjectRelease, readReleaseManifest } from "./project-releases.js";
import { publishedAppMemberDirectory } from "./published-app-access.js";
import { executionSnapshot, releaseCells } from "./published-app-sessions.js";
import type { Queryable } from "./scope.js";

const {
  publishedAppSchedules: schedules,
  publishedAppScheduleRecipients: recipients,
  publishedAppScheduleTicks: ticks,
  publishedAppScheduleReceipts: receipts,
  publishedAppScheduleDeliveries: deliveries,
} = schema;

export type Schedule = typeof schedules.$inferSelect;
export type ScheduleTick = typeof ticks.$inferSelect;
export type ScheduleRelease = NonNullable<
  Awaited<ReturnType<typeof readProjectRelease>>
>;
type SetInput = z.infer<typeof setScheduleInput>;
type StopInput = z.infer<typeof stopScheduleRunInput>;

function notFound(): never {
  return fail("This app is unavailable.", {
    statusCode: 404,
    errorCode: "project_not_found",
  });
}

function forbidden(): never {
  return fail("You don’t have permission to manage scheduled runs.", {
    statusCode: 403,
    errorCode: "schedule_forbidden",
  });
}

export function scheduleUnavailable(): never {
  return fail("Scheduled runs are temporarily unavailable.", {
    statusCode: 503,
    errorCode: "schedule_backend_unavailable",
  });
}

export function scheduleEmailAvailable(projectId: string) {
  return Boolean(
    phase1ScheduleFixture()?.now(projectId) ||
    (readDeployCredentialEnv("RESEND_API_KEY") &&
      readDeployCredentialEnv("EMAIL_FROM")),
  );
}

export const memberScope = (orgId: string) =>
  and(
    eq(orgMembers.orgId, orgId),
    inArray(orgMembers.role, ["owner", "admin", "member"]),
    isNull(orgMembers.federationRemovalPendingAt),
  );
export async function findScheduleMember(
  db: Queryable,
  orgId: string,
  memberId: string,
) {
  const [member] = await db
    .select({ id: orgMembers.id, email: orgMembers.email })
    .from(orgMembers)
    .where(and(memberScope(orgId), eq(orgMembers.id, memberId)))
    .limit(1);
  return member ?? null;
}
export function actorForMember(
  orgId: string,
  member: { email: string },
): ExecutionActor {
  return { orgId, ownerEmail: member.email, caller: "scheduler" };
}
export async function withScheduleActor<T>(
  actor: ExecutionActor,
  operation: () => Promise<T>,
) {
  return runWithRequestContext(
    { orgId: actor.orgId, userEmail: actor.ownerEmail },
    operation,
  );
}

export async function scheduleProjectAccess(
  db: Queryable,
  actor: ExecutionActor,
  projectId: string,
) {
  const access = await resolvePublishedProjectAccess(actor, projectId, db);
  if (!access) return null;
  const [member] = await db
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .where(
      and(memberScope(actor.orgId), eq(orgMembers.email, actor.ownerEmail)),
    )
    .limit(1);
  if (!member) return null;
  const canManage =
    !access.appOnly &&
    canManageProject(await projectAccessLevel(actor, access.project, [], db));
  return { ...access, memberId: member.id, canManage };
}

async function requireScheduleAccess(
  db: Queryable,
  actor: ExecutionActor,
  projectId: string,
  manage: boolean,
) {
  const access = await scheduleProjectAccess(db, actor, projectId);
  if (!access) notFound();
  if (manage && !access.canManage) forbidden();
  return access;
}

export async function lockScheduleProject(
  db: Queryable,
  orgId: string,
  projectId: string,
) {
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(
      and(eq(schema.projects.id, projectId), eq(schema.projects.orgId, orgId)),
    )
    .limit(1)
    .for("update");
  return project && project.trashedAt === null ? project : null;
}

export async function scheduleRelease(
  db: Queryable,
  actor: ExecutionActor,
  projectId: string,
  releaseId: string | null,
) {
  return releaseId
    ? readProjectRelease(db, { orgId: actor.orgId, projectId, releaseId })
    : null;
}

export async function verifyScheduleSources(
  actor: ExecutionActor,
  release: ScheduleRelease,
) {
  try {
    const sources = new Set(
      release.project.cells.flatMap(({ contents }) => {
        if (contents.kind !== "sql") return [];
        const source = sqlSource(contents);
        return source.kind === "warehouse" ? [source.id] : [];
      }),
    );
    return await withScheduleActor(actor, async () => {
      for (const id of sources)
        await withWarehouseSource(id, actor, async () => undefined);
      return true;
    });
  } catch (error) {
    if (isActionContractError(error) && error.statusCode < 500) return false;
    throw error;
  }
}

export async function recipientCanRead(
  db: Queryable,
  actor: ExecutionActor,
  release: ScheduleRelease,
  sourceResults?: readonly string[],
) {
  if (!(await scheduleProjectAccess(db, actor, release.projectId)))
    return false;
  const ids =
    sourceResults ??
    (await readReleaseManifest(db, release.manifestId)).flatMap(
      ({ resultId }) => (resultId ? [resultId] : []),
    );
  if (ids.length) {
    const rows = await db
      .select({ authorities: notebookResultManifests.authorities })
      .from(notebookResultManifests)
      .where(
        inArray(
          notebookResultManifests.id,
          ids.map((id) => resultIdSchema.parse(id)),
        ),
      )
      .limit(ids.length);
    if (
      rows.length !== new Set(ids).size ||
      rows.some(({ authorities }) => authorities === null)
    )
      scheduleUnavailable();
    const authorities = [
      ...new Map(
        rows.flatMap(({ authorities }) =>
          (authorities ?? []).map((authority) => [
            digest(authority),
            authority,
          ]),
        ),
      ).values(),
    ];
    const failure = await withScheduleActor(actor, () =>
      checkNotebookAuthorities(actor, authorities),
    );
    if (failure?.status === "unreadable") scheduleUnavailable();
    if (failure) return false;
  }
  return true;
}

export async function readScheduleRecipients(
  db: Queryable,
  ids: string[],
  memberId?: string,
) {
  if (!ids.length) return [];
  return db
    .select({
      scheduleId: recipients.scheduleId,
      memberId: recipients.memberId,
      on: recipients.on,
    })
    .from(recipients)
    .where(
      and(
        inArray(recipients.scheduleId, ids),
        eq(recipients.enabled, true),
        isNull(recipients.revokedAt),
        memberId === undefined ? undefined : eq(recipients.memberId, memberId),
      ),
    )
    .orderBy(asc(recipients.createdAt), asc(recipients.memberId))
    .limit(ids.length * 20);
}

export function scheduleFlags({
  cadence,
  timezone,
  target,
  updatePublishedResults,
  useCachedSqlResults,
}: Schedule) {
  return {
    cadence,
    timezone,
    target,
    updatePublishedResults,
    useCachedSqlResults,
  };
}
function view(schedule: Schedule, members: ScheduleRecipient[]) {
  return {
    scheduleId: schedule.id,
    revision: String(schedule.revision),
    enabled: schedule.enabled,
    deleted: schedule.deletedAt !== null,
    config: { ...scheduleFlags(schedule), recipients: members },
    nextFireAt: schedule.nextFireAt
      ? scheduleIso(new Date(schedule.nextFireAt))
      : null,
    normalizedCron: schedule.normalizedCron,
  };
}

function scopeFor(projectId: string, orgId: string) {
  return and(eq(schedules.projectId, projectId), eq(schedules.orgId, orgId));
}

async function requireReleaseConfig(
  db: Queryable,
  actor: ExecutionActor,
  projectId: string,
  releaseId: string | null,
  config?: PublishedAppScheduleConfig,
) {
  const release = await scheduleRelease(db, actor, projectId, releaseId);
  if (!release)
    fail("Publish this app before scheduling a run.", {
      statusCode: 409,
      errorCode: "release_required",
    });
  if (!(await verifyScheduleSources(actor, release)))
    fail("You don’t have access to this app’s data sources.", {
      statusCode: 403,
      errorCode: "source_denied",
    });
  if (!config?.recipients.length) return;
  if (!scheduleEmailAvailable(projectId)) scheduleUnavailable();
  for (const recipient of config.recipients) {
    const member = await findScheduleMember(
      db,
      actor.orgId,
      recipient.memberId,
    );
    if (
      !member ||
      !(await recipientCanRead(
        db,
        actorForMember(actor.orgId, member),
        release,
      ))
    )
      fail("Select a workspace member with access to this app.", {
        statusCode: 422,
        errorCode: "recipient_not_eligible",
      });
  }
}

async function readReceipt(
  db: Queryable,
  actor: ExecutionActor,
  actorId: string,
  input: SetInput | StopInput,
) {
  const fingerprint = digest(input);
  const scope = {
    orgId: actor.orgId,
    projectId: input.projectId,
    actorId,
    opId: input.opId,
  };
  const [receipt] = await db
    .select()
    .from(receipts)
    .where(
      and(
        eq(receipts.orgId, scope.orgId),
        eq(receipts.projectId, scope.projectId),
        eq(receipts.actorId, scope.actorId),
        eq(receipts.opId, scope.opId),
      ),
    )
    .limit(1);
  if (receipt && receipt.fingerprint !== fingerprint)
    fail("This operation was already used with different settings.", {
      statusCode: 409,
      errorCode: "intent_mismatch",
    });
  return { scope, fingerprint, previous: receipt?.response };
}

export async function setPublishedAppSchedule(
  actor: ExecutionActor,
  input: SetInput,
  now = new Date(),
  prepare?: () => Promise<void>,
) {
  const { projectId, opId, change } = input;
  const db = getDb();
  const access = await requireScheduleAccess(db, actor, projectId, true);
  if (change.kind === "create" || change.kind === "resume") {
    const replay = await readReceipt(db, actor, access.memberId, input);
    if (replay.previous) return setScheduleOutput.parse(replay.previous);
    await requireReleaseConfig(
      db,
      actor,
      projectId,
      access.project.publishedVersionId,
      "config" in change ? change.config : undefined,
    );
    await prepare?.();
  }
  const committedAt = now.toISOString();
  return db.transaction(async (tx) => {
    const project = await lockScheduleProject(tx, actor.orgId, projectId);
    if (!project) notFound();
    const { memberId } = await requireScheduleAccess(
      tx,
      actor,
      projectId,
      true,
    );
    const { scope, fingerprint, previous } = await readReceipt(
      tx,
      actor,
      memberId,
      input,
    );
    if (previous) return setScheduleOutput.parse(previous);
    const [before] = await tx
      .select()
      .from(schedules)
      .where(
        and(
          scopeFor(projectId, actor.orgId),
          eq(schedules.id, change.scheduleId),
        ),
      )
      .limit(1)
      .for("update");
    if (change.kind !== "create" && !before)
      fail("That schedule is unavailable.", {
        statusCode: 404,
        errorCode: "schedule_not_found",
      });
    if (
      change.kind === "create"
        ? before !== undefined
        : before?.deletedAt !== null ||
          String(before.revision) !== change.expectedRevision
    )
      fail("This schedule changed. Review the latest settings.", {
        statusCode: 409,
        errorCode: "schedule_revision_conflict",
      });
    const config = "config" in change ? change.config : undefined;
    const deletedAt = change.kind === "delete" ? committedAt : null;
    const enabled =
      !deletedAt &&
      (change.kind === "pause"
        ? false
        : change.kind === "edit"
          ? before?.enabled === true
          : true);
    const currentFlags = before ? scheduleFlags(before) : undefined;
    const { recipients: members, ...flags } =
      config ??
      (currentFlags
        ? {
            ...currentFlags,
            recipients: (
              await readScheduleRecipients(tx, [change.scheduleId])
            ).map(({ memberId, on }) => ({ memberId, on })),
          }
        : scheduleUnavailable());
    if (config || change.kind === "resume")
      await requireReleaseConfig(
        tx,
        actor,
        projectId,
        project.publishedVersionId,
        { ...flags, recipients: members },
      );
    const next =
      enabled || config
        ? nextScheduleFire(flags.cadence, flags.timezone, now)
        : null;
    if ((enabled || config) && !next)
      fail("Enter a valid five-field cron expression.", {
        statusCode: 422,
        errorCode: "invalid_cadence",
      });
    const noChange =
      before &&
      ((change.kind === "pause" && !before.enabled) ||
        (change.kind === "resume" && before.enabled));
    const row = {
      ...flags,
      deletedAt,
      enabled,
      normalizedCron: normalizedScheduleCron(flags.cadence),
      nextFireAt: enabled && next ? next.toISOString() : null,
      updatedAt: committedAt,
      revision: before ? before.revision + 1n : 1n,
      runPrincipalId:
        config || change.kind === "resume" || !before
          ? memberId
          : before.runPrincipalId,
    };
    let saved: Schedule;
    const effects = {
      create: "created",
      edit: "updated",
      pause: "paused",
      resume: "resumed",
      delete: "deleted",
    } as const;
    if (noChange) saved = before;
    else {
      const inserted = before
        ? await tx
            .update(schedules)
            .set(row)
            .where(
              and(
                scopeFor(projectId, actor.orgId),
                eq(schedules.id, before.id),
              ),
            )
            .returning()
        : await tx
            .insert(schedules)
            .values({
              ...row,
              id: change.scheduleId,
              orgId: actor.orgId,
              projectId,
              creatorId: memberId,
              createdAt: committedAt,
            })
            .onConflictDoNothing()
            .returning();
      if (!inserted[0])
        fail("This schedule changed. Review the latest settings.", {
          statusCode: 409,
          errorCode: "schedule_revision_conflict",
        });
      saved = inserted[0];
      if (config || deletedAt) {
        const active = await readScheduleRecipients(tx, [saved.id]);
        const retained = new Map(
          (deletedAt ? [] : members).map(({ memberId, on }) => [memberId, on]),
        );
        for (const current of active) {
          if (retained.get(current.memberId) === current.on)
            retained.delete(current.memberId);
          else
            await tx
              .update(recipients)
              .set({ enabled: false, revokedAt: committedAt })
              .where(
                and(
                  eq(recipients.scheduleId, saved.id),
                  eq(recipients.memberId, current.memberId),
                  isNull(recipients.revokedAt),
                ),
              );
        }
        if (retained.size)
          await tx.insert(recipients).values(
            [...retained].map(([memberId, on]) => ({
              id: randomUUID(),
              scheduleId: saved.id,
              memberId,
              on,
              enabled: true,
              createdAt: committedAt,
            })),
          );
      }
      if (deletedAt)
        await tx
          .update(ticks)
          .set({
            status: "cancelled",
            cacheOutcome: "preserved",
            terminalAt: committedAt,
          })
          .where(
            and(
              eq(ticks.scheduleId, saved.id),
              eq(ticks.status, "queued"),
              isNull(ticks.runId),
            ),
          );
    }
    const response = setScheduleOutput.parse({
      opId,
      effect: noChange ? "no_change" : effects[change.kind],
      schedule: view(saved, deletedAt ? [] : members),
      committedAt,
    });
    await tx
      .insert(receipts)
      .values({ ...scope, fingerprint, response, committedAt });
    return response;
  });
}

export async function listPublishedAppSchedules(
  actor: ExecutionActor,
  input: z.infer<typeof listSchedulesInput>,
) {
  const db = getDb();
  const { projectId, cursor, limit, filter } = input;
  const access = await requireScheduleAccess(db, actor, projectId, false);
  if (!access.canManage) {
    const release = await scheduleRelease(
      db,
      actor,
      projectId,
      access.project.publishedVersionId,
    );
    if (!release || !(await recipientCanRead(db, actor, release))) notFound();
  }
  const mine = !access.canManage || filter === "mine";
  const rows = await db
    .select()
    .from(schedules)
    .where(
      and(
        scopeFor(projectId, actor.orgId),
        isNull(schedules.deletedAt),
        cursor ? gt(schedules.id, cursor) : undefined,
        mine
          ? sql`exists (select 1 from ${recipients} where ${recipients.scheduleId} = ${schedules.id} and ${recipients.memberId} = ${access.memberId} and ${recipients.enabled} and ${recipients.revokedAt} is null)`
          : undefined,
      ),
    )
    .orderBy(asc(schedules.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const members = await readScheduleRecipients(
    db,
    page.map(({ id }) => id),
    mine ? access.memberId : undefined,
  );
  return {
    schedules: page.map((row) =>
      view(
        row,
        members
          .filter(({ scheduleId }) => scheduleId === row.id)
          .map(({ memberId, on }) => ({ memberId, on })),
      ),
    ),
    nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    canManage: access.canManage,
    notificationsAvailable: scheduleEmailAvailable(projectId),
  };
}

export async function listPublishedAppScheduleRuns(
  actor: ExecutionActor,
  input: z.infer<typeof listScheduleRunsInput>,
) {
  const db = getDb();
  const { projectId, scheduleId, cursor, limit } = input;
  await requireScheduleAccess(db, actor, projectId, true);
  const scope = and(
    eq(ticks.orgId, actor.orgId),
    eq(ticks.projectId, projectId),
    scheduleId ? eq(ticks.scheduleId, scheduleId) : undefined,
  );
  const [after] = cursor
    ? await db
        .select({ id: ticks.id, dueAt: ticks.dueAt })
        .from(ticks)
        .where(and(scope, eq(ticks.id, cursor)))
        .limit(1)
    : [];
  if (cursor && !after)
    fail("That scheduled run is unavailable.", {
      statusCode: 404,
      errorCode: "schedule_not_found",
    });
  const rows = await db
    .select()
    .from(ticks)
    .where(
      and(
        scope,
        after
          ? or(
              lt(ticks.dueAt, after.dueAt),
              and(eq(ticks.dueAt, after.dueAt), lt(ticks.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(ticks.dueAt), desc(ticks.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const delivery = page.length
    ? await db
        .select()
        .from(deliveries)
        .where(
          inArray(
            deliveries.tickId,
            page.map(({ id }) => id),
          ),
        )
        .limit(page.length * 20)
    : [];
  return {
    runs: page.map(
      ({
        id,
        scheduleId,
        dueAt,
        releaseId,
        runId,
        status,
        diagnostic,
        cacheOutcome,
      }) => ({
        tickId: id,
        scheduleId,
        dueAt: scheduleIso(new Date(dueAt)),
        releaseId,
        runId,
        status,
        diagnostic,
        cache: cacheOutcome,
        deliveries: delivery
          .filter(({ tickId }) => tickId === id)
          .map(({ recipientId, status }) => ({
            memberId: recipientId,
            outcome: status === "sending" ? ("pending" as const) : status,
          })),
      }),
    ),
    nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
  };
}

export async function listPublishedAppScheduleRecipients(
  actor: ExecutionActor,
  input: z.infer<typeof scheduleRecipientsInput>,
) {
  const db = getDb();
  const { projectId, search, cursor, limit } = input;
  const { project } = await requireScheduleAccess(db, actor, projectId, true);
  const release = await scheduleRelease(
    db,
    actor,
    projectId,
    project.publishedVersionId,
  );
  if (!release) notFound();
  const directory = publishedAppMemberDirectory(actor.orgId, db);
  const pattern = `%${search?.replace(/[\\%_]/g, "\\$&") ?? ""}%`;
  const rows = await db
    .select()
    .from(directory)
    .where(
      and(
        cursor ? gt(directory.id, cursor) : undefined,
        search
          ? or(ilike(directory.name, pattern), ilike(directory.email, pattern))
          : undefined,
      ),
    )
    .orderBy(asc(directory.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const members = [];
  for (const member of page) {
    if (
      await recipientCanRead(db, actorForMember(actor.orgId, member), release)
    )
      members.push({
        memberId: member.id,
        email: member.email,
        name: member.name ?? member.email,
      });
  }
  return {
    members,
    nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
  };
}

export async function stopPublishedAppScheduleRun(
  actor: ExecutionActor,
  input: StopInput,
) {
  const db = getDb();
  const { projectId, tickId, opId } = input;
  return db.transaction(async (tx) => {
    const project = await lockScheduleProject(tx, actor.orgId, projectId);
    if (!project) notFound();
    const { memberId } = await requireScheduleAccess(
      tx,
      actor,
      projectId,
      true,
    );
    const { scope, fingerprint, previous } = await readReceipt(
      tx,
      actor,
      memberId,
      input,
    );
    if (previous) return stopScheduleRunOutput.parse(previous);
    const [tick] = await tx
      .select()
      .from(ticks)
      .where(
        and(
          eq(ticks.id, tickId),
          eq(ticks.orgId, actor.orgId),
          eq(ticks.projectId, projectId),
        ),
      )
      .limit(1)
      .for("update");
    if (!tick)
      fail("That scheduled run is unavailable.", {
        statusCode: 404,
        errorCode: "schedule_not_found",
      });
    const committedAt = new Date().toISOString();
    let outcome: z.infer<typeof stopScheduleRunOutput>["outcome"] =
      "completion_won";
    if (tick.status === "cancel_unknown") outcome = "cancel_unknown";
    else if (tick.status === "cancelled") outcome = "cancelled";
    else if (!tick.terminalAt) {
      const principal = await findScheduleMember(
        tx,
        actor.orgId,
        tick.principalId,
      );
      const result =
        tick.runId && principal
          ? await notebookRunStore.cancel(
              actorForMember(actor.orgId, principal),
              tick.runId,
              undefined,
              tx,
            )
          : {
              status: tick.runId
                ? ("unknown" as const)
                : ("cancelled" as const),
            };
      if (result.status === "unknown") outcome = "cancel_unknown";
      else if (result.status === "cancelled") outcome = "cancelled";
      else if (result.status === "pending") outcome = "requested";
      else if (result.status !== "completed") scheduleUnavailable();
      if (outcome !== "completion_won") {
        const status = outcome === "requested" ? "stopping" : outcome;
        await tx
          .update(ticks)
          .set({
            status,
            ...(status === "stopping"
              ? {}
              : {
                  terminalAt: committedAt,
                  cacheOutcome: "preserved" as const,
                }),
          })
          .where(eq(ticks.id, tickId));
      }
    }
    const response = { opId, tickId, outcome };
    await tx
      .insert(receipts)
      .values({ ...scope, fingerprint, response, committedAt });
    return response;
  });
}

export function scheduleExecutionSnapshot(
  release: ScheduleRelease,
  tickId: string,
) {
  const namespace = runNamespaceSchema.parse({
    kind: "schedule-tick",
    releaseId: releaseIdSchema.parse(release.id),
    tickId,
    namespaceId: namespaceIdSchema.parse(
      digest(["schedule-tick", release.orgId, release.id, tickId]),
    ),
  });
  return executionSnapshot(
    release,
    namespace,
    0n,
    releaseCells(release.project),
  );
}

export async function readAuthorizedScheduleTick(
  actor: ExecutionActor,
  snapshot: Snapshot,
  db = getDb(),
) {
  const { namespace, ref } = snapshot;
  if (namespace.kind !== "schedule-tick" || ref.workspaceId !== actor.orgId)
    return null;
  const [tick] = await db
    .select()
    .from(ticks)
    .where(
      and(
        eq(ticks.id, namespace.tickId),
        eq(ticks.orgId, actor.orgId),
        eq(ticks.projectId, ref.projectId),
        eq(ticks.releaseId, namespace.releaseId),
      ),
    )
    .limit(1);
  if (!tick?.snapshot || digest(tick.snapshot) !== digest(snapshot))
    return null;
  const access = await scheduleProjectAccess(db, actor, ref.projectId);
  return access?.canManage && access.memberId === tick.principalId
    ? tick
    : null;
}

export const readScheduledExecutionSnapshot: SnapshotReader = async (
  actor,
  requested,
  transaction,
) => {
  const db = transaction ?? getDb();
  const tick = await readAuthorizedScheduleTick(actor, requested, db);
  if (!tick || tick.terminalAt) return { status: "denied" };
  const release = await scheduleRelease(
    db,
    actor,
    tick.projectId,
    tick.releaseId,
  );
  if (!release) return { status: "absent" };
  const snapshot = scheduleExecutionSnapshot(release, tick.id);
  return digest(snapshot) === tick.inputDigest
    ? {
        status: "accepted",
        value: { snapshot, cells: releaseCells(release.project) },
      }
    : { status: "denied" };
};
