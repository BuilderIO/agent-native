import { accessFilter } from "@agent-native/core/sharing";
import { type AnyColumn, and, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  MAX_OUTPUTS_PER_RECORDING,
  OUTPUT_USE_APPS,
  OUTPUT_USE_EVENT_NAMES,
  OUTPUT_USE_WINDOW_DAYS,
  OUTPUT_USE_WINDOW_MS,
  type OutputUseApp,
  isOutputUseApp,
  outputIdOf,
  outputUrl,
  outputUseRule,
  type SessionOutput,
  type SessionRecordingOutputs,
} from "../../shared/output-use.js";
import { getDb, schema } from "../db/index.js";
import {
  recordingTenantSql,
  type SessionEventIndexInputRow,
  type SessionEventScope,
  sessionEventTenantKey,
  sessionIdOf,
  stableId,
  viewerReadsRecordingEventsSql,
  viewerTenantKeys,
  warnIndexFailure,
} from "./session-event-index.js";
import {
  listRecordingSessionAssociations,
  sessionRecordingAssociationsReady,
} from "./session-recording-associations.js";

/**
 * Output outcomes: the outputs each tenant's apps made, as defined in
 * `shared/output-use.ts`, and when each was first used. Ingest derives them
 * inside the transaction that stores the events, whatever the sink, so no
 * view reads raw events or BigQuery. A write that fails rolls back to a
 * savepoint, and a batch ingest fails to store is lost; either records the
 * event-time span the batch covered. An output
 * whose use window overlaps such a span is unmeasured, never unused: the
 * lost batch could have held its use.
 */

const OUTPUT_OUTCOME_RETENTION_BUFFER_DAYS = 2;
const SESSION_ID_BATCH_SIZE = 1_000;
const DAY_MS = 24 * 60 * 60_000;

let outputOutcomeTablesReady = false;

type OutputOutcomeRow = typeof schema.analyticsOutputOutcomes.$inferInsert;
type OutputOutcomeGapRow =
  typeof schema.analyticsOutputOutcomeGaps.$inferInsert;

interface OutputTenant {
  tenantKey: string;
  ownerEmail: string;
  orgId: string | null;
}

async function coverageTableExists(db: any): Promise<boolean> {
  const result = await db.execute(
    sql`SELECT to_regclass('analytics_output_outcome_coverage') AS table_name`,
  );
  const rows = Array.isArray(result) ? result : result?.rows;
  if (!Array.isArray(rows)) {
    throw new Error("Postgres table existence check returned no row array");
  }
  const value = rows[0]?.table_name;
  if (value === null) return false;
  if (typeof value === "string" && value) return true;
  throw new Error("Postgres table existence check returned an invalid value");
}

/**
 * Code deploys before the scheduled migration creates these tables. Until
 * the coverage table (created last) exists nothing is recorded, and reads
 * say so. Tables are only ever added, so only "ready" is cached.
 */
async function outputOutcomesReady(db: any): Promise<boolean> {
  outputOutcomeTablesReady ||= await coverageTableExists(db);
  return outputOutcomeTablesReady;
}

/** Rows some rule reads, judged by name and app before any parsing. */
function outputRuleRows(
  rows: readonly SessionEventIndexInputRow[],
): SessionEventIndexInputRow[] {
  return rows.filter(
    (row) =>
      OUTPUT_USE_EVENT_NAMES.has(row.eventName) &&
      isOutputUseApp(row.app) &&
      Boolean(row.ownerEmail) &&
      Boolean(row.timestamp),
  );
}

/** Ingest serializes properties itself, so a parse failure is a real error. */
function parseProperties(properties: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(properties);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function computeUseBy(madeAt: string): string {
  return new Date(Date.parse(madeAt) + OUTPUT_USE_WINDOW_MS).toISOString();
}

function sortedById<T extends { id: string }>(rows: Iterable<T>): T[] {
  return [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * One batch's outcomes, merged the way the upsert merges them with stored
 * rows: the earliest making and its session, and the earliest qualifying use.
 * Every tenant that sent a rule's event gets coverage, even when nothing in
 * the batch qualified.
 */
export function aggregateOutputOutcomeRows(
  rows: readonly SessionEventIndexInputRow[],
): { outcomes: OutputOutcomeRow[]; tenants: OutputTenant[] } {
  const outcomes = new Map<string, OutputOutcomeRow>();
  const tenants = new Map<string, OutputTenant>();
  for (const row of outputRuleRows(rows)) {
    const app = row.app as OutputUseApp;
    const rule = outputUseRule(app)!;
    const made = rule.madeEvents.includes(row.eventName);
    const used = rule.usedEvents.find(
      (event) => event.eventName === row.eventName,
    );
    const orgId = row.orgId || null;
    const tenantKey = sessionEventTenantKey(row.ownerEmail, orgId);
    tenants.set(tenantKey, {
      tenantKey,
      ownerEmail: row.ownerEmail,
      orgId,
    });
    const properties = parseProperties(row.properties);
    const outputId = outputIdOf(properties);
    if (!outputId) continue;
    if (!made && !used?.qualifies(properties)) continue;

    const id = stableId("aoo", [tenantKey, app, outputId]);
    let outcome = outcomes.get(id);
    if (!outcome) {
      outcome = {
        id,
        tenantKey,
        ownerEmail: row.ownerEmail,
        orgId,
        app,
        outputType: rule.outputType,
        outputId,
        madeAt: null,
        useBy: null,
        madeSessionId: null,
        firstUsedAt: null,
        usedEvent: null,
        lastSeenAt: row.timestamp,
      };
      outcomes.set(id, outcome);
    }
    if (row.timestamp > outcome.lastSeenAt) outcome.lastSeenAt = row.timestamp;
    const sessionId = sessionIdOf(row.sessionId);
    if (made) {
      if (!outcome.madeAt || row.timestamp < outcome.madeAt) {
        outcome.madeAt = row.timestamp;
        outcome.useBy = computeUseBy(row.timestamp);
        outcome.madeSessionId = sessionId ?? outcome.madeSessionId ?? null;
      } else if (!outcome.madeSessionId) {
        outcome.madeSessionId = sessionId;
      }
    } else if (!outcome.firstUsedAt || row.timestamp < outcome.firstUsedAt) {
      outcome.firstUsedAt = row.timestamp;
      outcome.usedEvent = row.eventName;
    }
  }
  // Sorted by id so concurrent batches lock shared rows in the same order.
  return {
    outcomes: sortedById(outcomes.values()),
    tenants: [...tenants.values()].sort((a, b) =>
      a.tenantKey < b.tenantKey ? -1 : a.tenantKey > b.tenantKey ? 1 : 0,
    ),
  };
}

/** One marker per tenant spanning the event times its failed batch held. */
function outputGapRows(
  rows: readonly SessionEventIndexInputRow[],
  recordedAt: string,
): OutputOutcomeGapRow[] {
  const spans = new Map<string, OutputOutcomeGapRow>();
  for (const row of rows) {
    const orgId = row.orgId || null;
    const tenantKey = sessionEventTenantKey(row.ownerEmail, orgId);
    const span = spans.get(tenantKey);
    if (!span) {
      spans.set(tenantKey, {
        id: "",
        tenantKey,
        ownerEmail: row.ownerEmail,
        orgId,
        firstAt: row.timestamp,
        lastAt: row.timestamp,
        recordedAt,
      });
      continue;
    }
    if (row.timestamp < span.firstAt) span.firstAt = row.timestamp;
    if (row.timestamp > span.lastAt) span.lastAt = row.timestamp;
  }
  return sortedById(
    [...spans.values()].map((span) => ({
      ...span,
      id: stableId("aoog", [
        span.tenantKey,
        span.firstAt,
        span.lastAt,
        recordedAt,
      ]),
    })),
  );
}

/**
 * Runs inside the transaction that stores the events. A failure rolls back
 * to a savepoint and never fails ingest; only a failed gap marker does,
 * taking the events with it, so no output silently loses a use. The
 * readiness probe belongs inside the savepoint: a failed query aborts the
 * transaction it runs in.
 */
export async function recordOutputOutcomes(
  tx: any,
  rows: readonly SessionEventIndexInputRow[],
  receivedAt: string,
): Promise<void> {
  const ruleRows = outputRuleRows(rows);
  if (!ruleRows.length) return;
  try {
    await tx.transaction(async (savepoint: any) => {
      if (!(await outputOutcomesReady(savepoint))) return;
      const { outcomes, tenants } = aggregateOutputOutcomeRows(ruleRows);
      if (outcomes.length) {
        const o = schema.analyticsOutputOutcomes;
        const earlierMade = sql`excluded.made_at is not null and (${o.madeAt} is null or excluded.made_at < ${o.madeAt})`;
        const earlierUse = sql`excluded.first_used_at is not null and (${o.firstUsedAt} is null or excluded.first_used_at < ${o.firstUsedAt})`;
        await savepoint
          .insert(o)
          .values(outcomes)
          .onConflictDoUpdate({
            target: [o.tenantKey, o.app, o.outputId],
            set: {
              // least() and greatest() skip nulls in Postgres.
              madeAt: sql`least(${o.madeAt}, excluded.made_at)`,
              useBy: sql`least(${o.useBy}, excluded.use_by)`,
              madeSessionId: sql`case when ${earlierMade} then coalesce(excluded.made_session_id, ${o.madeSessionId}) else coalesce(${o.madeSessionId}, excluded.made_session_id) end`,
              firstUsedAt: sql`least(${o.firstUsedAt}, excluded.first_used_at)`,
              usedEvent: sql`case when ${earlierUse} then excluded.used_event else ${o.usedEvent} end`,
              lastSeenAt: sql`greatest(${o.lastSeenAt}, excluded.last_seen_at)`,
            },
          });
      }
      await savepoint
        .insert(schema.analyticsOutputOutcomeCoverage)
        .values(tenants.map((tenant) => ({ ...tenant, startedAt: receivedAt })))
        .onConflictDoNothing();
    });
  } catch (error) {
    if (!(await coverageTableExists(tx))) {
      warnIndexFailure(
        "Output outcome tables are not migrated yet; events were stored without output outcomes:",
        error,
      );
      return;
    }
    await tx
      .insert(schema.analyticsOutputOutcomeGaps)
      .values(outputGapRows(ruleRows, receivedAt))
      .onConflictDoNothing();
    warnIndexFailure(
      "Output outcome write failed; outputs in its span read as unmeasured:",
      error,
    );
  }
}

/**
 * Ingest rejected or failed to store a batch, and the tracker does not resend
 * it, so any use it held is gone. Records its span outside the rolled-back
 * transaction so outputs it could have used read as unmeasured, not unused.
 */
export async function recordLostOutputBatch(
  db: any,
  rows: readonly SessionEventIndexInputRow[],
  receivedAt: string,
): Promise<void> {
  const ruleRows = outputRuleRows(rows);
  if (!ruleRows.length) return;
  try {
    if (!(await outputOutcomesReady(db))) return;
    await db
      .insert(schema.analyticsOutputOutcomeGaps)
      .values(outputGapRows(ruleRows, receivedAt))
      .onConflictDoNothing();
  } catch (error) {
    console.error(
      "[first-party-analytics] A failed batch's output span was not recorded; a use it held may read as unused:",
      error,
    );
  }
}

/** An output stored in `o` that was made but not used once its window closed. */
function unusedOutputSql(
  o: typeof schema.analyticsOutputOutcomes,
  nowIso: string,
) {
  const coverage = schema.analyticsOutputOutcomeCoverage;
  const gaps = schema.analyticsOutputOutcomeGaps;
  return sql`${o.madeAt} is not null
    and ${o.useBy} <= ${nowIso}
    and ${o.madeAt} >= (select ${coverage.startedAt} from ${coverage} where ${coverage.tenantKey} = ${o.tenantKey})
    and (${o.firstUsedAt} is null or ${o.firstUsedAt} > ${o.useBy})
    and not exists (
      select 1 from ${gaps}
      where ${gaps.tenantKey} = ${o.tenantKey}
        and ${gaps.firstAt} <= ${o.useBy}
        and ${gaps.lastAt} >= ${o.madeAt}
    )`;
}

/**
 * Conditions on `session_recordings` for "made it, didn't use it": the
 * recording's session made an output of `app` whose use window has closed
 * with no qualifying use. Each lookup is correlated to the recording's own
 * tenant and sessions, so it never widens the recording access filter it is
 * combined with, and a recording shared from another tenant never matches.
 */
export async function unusedOutputConditions(
  scope: SessionEventScope,
  app: OutputUseApp | undefined,
  now = new Date(),
) {
  if (!app) return [];
  const db = getDb() as any;
  if (!(await outputOutcomesReady(db))) return [sql`false`];
  const associationsReady = await sessionRecordingAssociationsReady(db);
  const r = schema.sessionRecordings;
  const o = schema.analyticsOutputOutcomes;
  const association = alias(
    schema.sessionRecordingSessionAssociations,
    "unused_output_association",
  );
  const associationPresence = alias(
    schema.sessionRecordingSessionAssociations,
    "unused_output_association_presence",
  );
  const tenant = recordingTenantSql(r);
  const unused = unusedOutputSql(o, now.toISOString());
  const madeUnusedIn = (sessionId: AnyColumn) => sql`exists (
    select 1 from ${o}
    where ${o.tenantKey} = ${tenant}
      and ${o.app} = ${app}
      and ${o.madeSessionId} = ${sessionId}
      and ${unused}
  )`;
  const match = associationsReady
    ? sql`(
        exists (
          select 1 from ${schema.sessionRecordingSessionAssociations} as ${association}
          where ${association.recordingId} = ${r.id}
            and ${madeUnusedIn(association.sessionId)}
        )
        or (
          not exists (
            select 1 from ${schema.sessionRecordingSessionAssociations} as ${associationPresence}
            where ${associationPresence.recordingId} = ${r.id}
          )
          and ${madeUnusedIn(r.sessionId)}
        )
      )`
    : madeUnusedIn(r.sessionId);
  return [viewerReadsRecordingEventsSql(r, scope), match];
}

/**
 * The latest output coverage start among the viewer's tenants. Each output
 * is judged against its own tenant's start, so only the latest holds for all.
 */
export async function getOutputCoverageStart(
  scope: SessionEventScope,
): Promise<string | null> {
  const db = getDb() as any;
  if (!(await outputOutcomesReady(db))) return null;
  const coverage = schema.analyticsOutputOutcomeCoverage;
  const rows = await db
    .select({ startedAt: coverage.startedAt })
    .from(coverage)
    .where(inArray(coverage.tenantKey, viewerTenantKeys(scope)));
  const starts = rows
    .map((row: { startedAt: string }) => row.startedAt)
    .filter(Boolean)
    .sort();
  return starts.at(-1) ?? null;
}

interface StoredOutput {
  tenantKey: string;
  app: string;
  outputType: string;
  outputId: string;
  madeAt: string;
  useBy: string;
  madeSessionId: string;
  firstUsedAt: string | null;
  usedEvent: string | null;
  hasGap: boolean;
}

function outputStatus(
  output: StoredOutput,
  nowIso: string,
): SessionOutput["status"] {
  if (output.firstUsedAt && output.firstUsedAt <= output.useBy) return "used";
  if (output.useBy > nowIso) return "open";
  return output.hasGap ? "unmeasured" : "unused";
}

/**
 * The outputs each recording's sessions made, for recordings the viewer can
 * read, such as one list page's rows. A share grants the recording, not its
 * tenant's events, so a recording shared from another tenant reads as null.
 * Each recording lists at most `MAX_OUTPUTS_PER_RECORDING`, unused ones
 * first, so a row the unused filter matched always lists the output it
 * matched on; the rest are counted in `omittedOutputs`.
 */
export async function getSessionRecordingOutputs(
  scope: SessionEventScope,
  recordingIds: readonly string[],
  now = new Date(),
): Promise<SessionRecordingOutputs> {
  const ids = [...new Set(recordingIds)];
  const db = getDb() as any;
  const coverageStartedAt = await getOutputCoverageStart(scope);
  const outputs: Record<string, SessionOutput[] | null> = {};
  const omittedOutputs: Record<string, number> = {};
  if (!ids.length) return { outputs, omittedOutputs, coverageStartedAt };
  const r = schema.sessionRecordings;
  const viewerTenants = new Set(viewerTenantKeys(scope));
  const readable: Array<{
    id: string;
    sessionId: string;
    ownerEmail: string;
    orgId: string | null;
    firstUrl: string | null;
  }> = await db
    .select({
      id: r.id,
      sessionId: r.sessionId,
      ownerEmail: r.ownerEmail,
      orgId: r.orgId,
      firstUrl: r.firstUrl,
    })
    .from(r)
    .where(
      and(
        accessFilter(r, schema.sessionRecordingShares, {
          userEmail: scope.userEmail,
          orgId: scope.orgId ?? undefined,
        }),
        inArray(r.id, ids),
      ),
    )
    .limit(ids.length);
  const recordings: typeof readable = [];
  for (const recording of readable) {
    const own = viewerTenants.has(
      sessionEventTenantKey(recording.ownerEmail, recording.orgId),
    );
    outputs[recording.id] = own ? [] : null;
    if (own) recordings.push(recording);
  }
  if (!recordings.length || coverageStartedAt === null) {
    return { outputs, omittedOutputs, coverageStartedAt };
  }

  const sessionIdsByRecording = new Map<string, string[]>();
  if (await sessionRecordingAssociationsReady(db)) {
    for (const row of await listRecordingSessionAssociations(
      db,
      recordings.map((recording) => recording.id),
    )) {
      const values = sessionIdsByRecording.get(row.recordingId) ?? [];
      values.push(row.sessionId);
      sessionIdsByRecording.set(row.recordingId, values);
    }
  }
  const sessionIdsByTenant = new Map<string, Set<string>>();
  for (const recording of recordings) {
    if (!sessionIdsByRecording.has(recording.id)) {
      sessionIdsByRecording.set(recording.id, [recording.sessionId]);
    }
    const tenantKey = sessionEventTenantKey(
      recording.ownerEmail,
      recording.orgId,
    );
    const tenantSessionIds =
      sessionIdsByTenant.get(tenantKey) ?? new Set<string>();
    for (const sessionId of sessionIdsByRecording.get(recording.id)!) {
      tenantSessionIds.add(sessionId);
    }
    sessionIdsByTenant.set(tenantKey, tenantSessionIds);
  }

  const nowIso = now.toISOString();
  const o = schema.analyticsOutputOutcomes;
  const coverage = schema.analyticsOutputOutcomeCoverage;
  const gaps = schema.analyticsOutputOutcomeGaps;
  const stored: StoredOutput[] = [];
  const madeBySession = new Map<string, number>();
  for (const [tenantKey, tenantSessionIds] of sessionIdsByTenant) {
    const sessionIds = [...tenantSessionIds];
    for (
      let offset = 0;
      offset < sessionIds.length;
      offset += SESSION_ID_BATCH_SIZE
    ) {
      const batch = sessionIds.slice(offset, offset + SESSION_ID_BATCH_SIZE);
      // Each session's outputs are ranked unused first and cut in SQL, so a
      // session that made thousands reads no more than a recording can list.
      const ranked = db
        .select({
          tenantKey: o.tenantKey,
          app: o.app,
          outputType: o.outputType,
          outputId: o.outputId,
          madeAt: o.madeAt,
          useBy: o.useBy,
          madeSessionId: o.madeSessionId,
          firstUsedAt: o.firstUsedAt,
          usedEvent: o.usedEvent,
          hasGap: sql<boolean>`exists (
            select 1 from ${gaps}
            where ${gaps.tenantKey} = ${o.tenantKey}
              and ${gaps.firstAt} <= ${o.useBy}
              and ${gaps.lastAt} >= ${o.madeAt}
          )`.as("has_gap"),
          sessionRank: sql<number>`row_number() over (
            partition by ${o.madeSessionId}
            order by case when ${unusedOutputSql(o, nowIso)} then 0 else 1 end, ${o.madeAt}, ${o.outputId}
          )`.as("session_rank"),
          sessionMade:
            sql<number>`count(*) over (partition by ${o.madeSessionId})`.as(
              "session_made",
            ),
        })
        .from(o)
        .where(
          and(
            eq(o.tenantKey, tenantKey),
            inArray(o.madeSessionId, batch),
            inArray(o.app, OUTPUT_USE_APPS),
            sql`${o.madeAt} is not null`,
            sql`${o.madeAt} >= (select ${coverage.startedAt} from ${coverage} where ${coverage.tenantKey} = ${o.tenantKey})`,
          ),
        )
        .as("ranked_outputs");
      const rows = await db
        .select()
        .from(ranked)
        .where(lte(ranked.sessionRank, MAX_OUTPUTS_PER_RECORDING));
      for (const row of rows) {
        stored.push(row);
        madeBySession.set(
          JSON.stringify([row.tenantKey, row.madeSessionId]),
          Number(row.sessionMade),
        );
      }
    }
  }

  const outputsBySession = new Map<string, StoredOutput[]>();
  for (const output of stored) {
    const key = JSON.stringify([output.tenantKey, output.madeSessionId]);
    const values = outputsBySession.get(key) ?? [];
    values.push(output);
    outputsBySession.set(key, values);
  }
  for (const recording of recordings) {
    const tenantKey = sessionEventTenantKey(
      recording.ownerEmail,
      recording.orgId,
    );
    // An output has one making session, so distinct sessions never list the
    // same output twice.
    const made: StoredOutput[] = [];
    let madeCount = 0;
    for (const sessionId of new Set(sessionIdsByRecording.get(recording.id))) {
      const key = JSON.stringify([tenantKey, sessionId]);
      made.push(...(outputsBySession.get(key) ?? []));
      madeCount += madeBySession.get(key) ?? 0;
    }
    const listed = made
      .map((output) => ({ output, status: outputStatus(output, nowIso) }))
      .sort(
        (a, b) =>
          Number(b.status === "unused") - Number(a.status === "unused") ||
          a.output.madeAt.localeCompare(b.output.madeAt) ||
          a.output.outputId.localeCompare(b.output.outputId),
      )
      .slice(0, MAX_OUTPUTS_PER_RECORDING)
      .sort(
        (a, b) =>
          a.output.madeAt.localeCompare(b.output.madeAt) ||
          a.output.outputId.localeCompare(b.output.outputId),
      );
    if (madeCount > listed.length) {
      omittedOutputs[recording.id] = madeCount - listed.length;
    }
    outputs[recording.id] = listed.map(({ output, status }) => ({
      app: output.app as OutputUseApp,
      outputType: output.outputType,
      outputId: output.outputId,
      madeAt: output.madeAt,
      useBy: output.useBy,
      status,
      usedEvent: status === "used" ? output.usedEvent : null,
      usedAt: status === "used" ? output.firstUsedAt : null,
      url: outputUrl(output.app, output.outputId, recording.firstUrl),
    }));
  }
  return { outputs, omittedOutputs, coverageStartedAt };
}

/**
 * An outcome outlives the replays its session recorded by the use window and
 * a little more, so a retained recording never loses its outputs.
 */
export async function pruneOutputOutcomes(
  replayRetentionDays: number,
  now = new Date(),
): Promise<{ outputs: number }> {
  const db = getDb() as any;
  if (!(await outputOutcomesReady(db))) return { outputs: 0 };
  const cutoff = new Date(
    now.getTime() -
      (replayRetentionDays +
        OUTPUT_USE_WINDOW_DAYS +
        OUTPUT_OUTCOME_RETENTION_BUFFER_DAYS) *
        DAY_MS,
  ).toISOString();
  // guard:allow-unscoped -- retention intentionally sweeps expired output outcomes across tenants.
  const result = await db
    .delete(schema.analyticsOutputOutcomes)
    .where(lt(schema.analyticsOutputOutcomes.lastSeenAt, cutoff));
  // guard:allow-unscoped -- retention intentionally sweeps gap markers older than every output they could cover.
  await db
    .delete(schema.analyticsOutputOutcomeGaps)
    .where(lt(schema.analyticsOutputOutcomeGaps.lastAt, cutoff));
  return { outputs: Number(result?.rowCount ?? 0) };
}

export function __resetOutputOutcomesForTests(): void {
  outputOutcomeTablesReady = false;
}
