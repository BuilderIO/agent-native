/**
 * Durable state for server stitches. `stitch-recordings` inserts a `queued`
 * row next to the destination recording and dispatches the post-finalize
 * worker; the worker claims the row with a lease and renews it while it works.
 * When a worker dies (a serverless invocation ending, a deploy, a crash) its
 * lease runs out and the recovery sweep dispatches the job again, up to
 * STITCH_MAX_ATTEMPTS times. Every write that settles a job checks the lease
 * token, so a worker that lost its lease can never overwrite the outcome of
 * the one that took over.
 */
import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  count,
  eq,
  inArray,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

const jobs = schema.stitchJobs;

export type StitchJobRow = typeof jobs.$inferSelect;

/** A worker renews its lease well before this runs out. */
export const STITCH_LEASE_MS = 5 * 60_000;
export const STITCH_LEASE_RENEW_MS = 45_000;
/** Times a stitch may be started before it is marked failed. */
export const STITCH_MAX_ATTEMPTS = 3;
/** Stitches running at once across every instance. */
export const STITCH_MAX_RUNNING = 2;
/** Queued plus running stitches one person may have. */
export const STITCH_MAX_ACTIVE_PER_OWNER = 3;
/** Queued plus running stitches on the whole deployment. */
export const STITCH_MAX_ACTIVE_TOTAL = 25;
/** The action dispatches its own job; the sweep leaves it alone this long. */
export const STITCH_DISPATCH_GRACE_MS = 30_000;
/** Settled job rows are kept this long for debugging. */
export const STITCH_JOB_RETENTION_MS = 7 * 24 * 60 * 60_000;

const ACTIVE_STATES = ["queued", "running"] as const;

type Db = ReturnType<typeof getDb>;
type Executor = Pick<Db, "select" | "insert" | "update" | "delete">;

const iso = (ms: number) => new Date(ms).toISOString();

export class StitchQueueFullError extends Error {
  constructor(readonly scope: "owner" | "total") {
    super(
      scope === "owner"
        ? `You already have ${STITCH_MAX_ACTIVE_PER_OWNER} stitches waiting or running. Try again when one of them is done.`
        : "Too many stitches are waiting on this server right now. Try again in a few minutes.",
    );
    this.name = "StitchQueueFullError";
  }
}

/** Throws StitchQueueFullError when the owner or the server has too much queued. */
export async function assertStitchCapacity(
  ownerEmail: string,
  db: Executor = getDb(),
): Promise<void> {
  // guard:allow-unscoped — admission control counts every active stitch job.
  const [totals] = await db
    .select({
      total: count(),
      owner: sql<number>`count(*) FILTER (WHERE lower(${jobs.ownerEmail}) = lower(${ownerEmail}))`,
    })
    .from(jobs)
    .where(inArray(jobs.state, [...ACTIVE_STATES]));
  if (Number(totals?.owner ?? 0) >= STITCH_MAX_ACTIVE_PER_OWNER) {
    throw new StitchQueueFullError("owner");
  }
  if (Number(totals?.total ?? 0) >= STITCH_MAX_ACTIVE_TOTAL) {
    throw new StitchQueueFullError("total");
  }
}

export async function insertStitchJob(
  input: {
    recordingId: string;
    ownerEmail: string;
    orgId: string | null;
    sourceRecordingIds: readonly string[];
    storageProviderId: string | null;
    now?: number;
  },
  db: Executor = getDb(),
): Promise<void> {
  const now = iso(input.now ?? Date.now());
  await db.insert(jobs).values({
    recordingId: input.recordingId,
    ownerEmail: input.ownerEmail,
    orgId: input.orgId,
    sourceIdsJson: JSON.stringify(input.sourceRecordingIds),
    storageProviderId: input.storageProviderId,
    state: "queued",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
}

export function stitchJobSourceIds(job: Pick<StitchJobRow, "sourceIdsJson">) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(job.sourceIdsJson);
  } catch {
    return [];
  }
  return Array.isArray(parsed)
    ? parsed.filter((id): id is string => typeof id === "string" && !!id)
    : [];
}

export type StitchClaim =
  | { claimed: true; token: string; job: StitchJobRow }
  | {
      claimed: false;
      reason: "missing" | "settled" | "leased" | "busy" | "exhausted";
      job: StitchJobRow | null;
    };

/**
 * Takes the job for this worker: a queued job, or a running one whose lease
 * ran out. Refuses when STITCH_MAX_RUNNING other stitches hold live leases
 * (the job stays queued for the sweep) or every attempt was used.
 */
export async function claimStitchJob(
  recordingId: string,
  now: number = Date.now(),
): Promise<StitchClaim> {
  const db = getDb();
  const token = randomUUID();
  const nowIso = iso(now);
  // guard:allow-unscoped — the job row is keyed by the recording id the signed worker token names.
  const claimed = await db
    .update(jobs)
    .set({
      state: "running",
      leaseToken: token,
      leaseUntil: iso(now + STITCH_LEASE_MS),
      attempts: sql`${jobs.attempts} + 1`,
      updatedAt: nowIso,
    })
    .where(
      and(
        eq(jobs.recordingId, recordingId),
        lt(jobs.attempts, STITCH_MAX_ATTEMPTS),
        or(
          eq(jobs.state, "queued"),
          and(eq(jobs.state, "running"), lte(jobs.leaseUntil, nowIso)),
        ),
        sql`(SELECT count(*) FROM clips_stitch_jobs AS live
          WHERE live.state = 'running'
            AND live.lease_until > ${nowIso}
            AND live.recording_id <> ${recordingId}) < ${STITCH_MAX_RUNNING}`,
      ),
    )
    .returning();
  const [job] = claimed;
  if (job) return { claimed: true, token, job };

  // guard:allow-unscoped — reads back the same job row to say why it was not claimed.
  const [current] = await db
    .select()
    .from(jobs)
    .where(eq(jobs.recordingId, recordingId))
    .limit(1);
  if (!current) return { claimed: false, reason: "missing", job: null };
  if (current.state === "ready" || current.state === "failed") {
    return { claimed: false, reason: "settled", job: current };
  }
  if (
    current.state === "running" &&
    current.leaseUntil &&
    current.leaseUntil > nowIso
  ) {
    return { claimed: false, reason: "leased", job: current };
  }
  if (current.attempts >= STITCH_MAX_ATTEMPTS) {
    return { claimed: false, reason: "exhausted", job: current };
  }
  return { claimed: false, reason: "busy", job: current };
}

/** Extends the lease; false once another worker took the job over. */
export async function renewStitchLease(
  recordingId: string,
  token: string,
  now: number = Date.now(),
): Promise<boolean> {
  // guard:allow-unscoped — lease renewal by job key and lease token.
  const renewed = await getDb()
    .update(jobs)
    .set({ leaseUntil: iso(now + STITCH_LEASE_MS), updatedAt: iso(now) })
    .where(
      and(
        eq(jobs.recordingId, recordingId),
        eq(jobs.state, "running"),
        eq(jobs.leaseToken, token),
      ),
    )
    .returning({ recordingId: jobs.recordingId });
  return renewed.length === 1;
}

/**
 * Settles the job. With a token it only succeeds for the worker that holds
 * the lease; without one (the sweep) it only settles a job nobody holds.
 */
export async function settleStitchJob(input: {
  recordingId: string;
  state: "ready" | "failed";
  token?: string;
  error?: string | null;
  now?: number;
}): Promise<boolean> {
  const now = input.now ?? Date.now();
  const nowIso = iso(now);
  // guard:allow-unscoped — settles one job row by key, guarded by its lease.
  const settled = await getDb()
    .update(jobs)
    .set({
      state: input.state,
      leaseToken: null,
      leaseUntil: null,
      lastError: input.error ?? null,
      updatedAt: nowIso,
    })
    .where(
      and(
        eq(jobs.recordingId, input.recordingId),
        input.token
          ? and(eq(jobs.state, "running"), eq(jobs.leaseToken, input.token))
          : or(
              eq(jobs.state, "queued"),
              and(eq(jobs.state, "running"), lte(jobs.leaseUntil, nowIso)),
            ),
      ),
    )
    .returning({ recordingId: jobs.recordingId });
  return settled.length === 1;
}

export interface StitchRecoveryPlan {
  /** Jobs to dispatch again, oldest first, at most the free slots. */
  dispatch: StitchJobRow[];
  /** Jobs whose lease ran out after the last attempt. */
  exhausted: StitchJobRow[];
  /** Jobs whose destination recording is gone or no longer processing. */
  orphaned: StitchJobRow[];
}

/** What the recovery sweep should do now; it changes nothing itself. */
export async function planStitchRecovery(
  now: number = Date.now(),
): Promise<StitchRecoveryPlan> {
  const db = getDb();
  const nowIso = iso(now);
  // guard:allow-unscoped — system recovery sweep over unclaimed stitch jobs.
  const waiting = await db
    .select({ job: jobs, recordingStatus: schema.recordings.status })
    .from(jobs)
    .leftJoin(schema.recordings, eq(schema.recordings.id, jobs.recordingId))
    .where(
      or(
        and(
          eq(jobs.state, "queued"),
          lte(jobs.createdAt, iso(now - STITCH_DISPATCH_GRACE_MS)),
        ),
        and(eq(jobs.state, "running"), lte(jobs.leaseUntil, nowIso)),
      ),
    )
    .orderBy(asc(jobs.createdAt))
    .limit(200);

  // guard:allow-unscoped — counts live leases across every instance.
  const [live] = await db
    .select({ running: count() })
    .from(jobs)
    .where(and(eq(jobs.state, "running"), sql`${jobs.leaseUntil} > ${nowIso}`));
  let free = Math.max(0, STITCH_MAX_RUNNING - Number(live?.running ?? 0));

  const plan: StitchRecoveryPlan = {
    dispatch: [],
    exhausted: [],
    orphaned: [],
  };
  for (const { job, recordingStatus } of waiting) {
    if (recordingStatus !== "processing") {
      plan.orphaned.push(job);
    } else if (job.attempts >= STITCH_MAX_ATTEMPTS) {
      plan.exhausted.push(job);
    } else if (free > 0) {
      plan.dispatch.push(job);
      free -= 1;
    }
  }
  return plan;
}

/** Drops settled job rows older than the retention window. */
export async function pruneSettledStitchJobs(
  now: number = Date.now(),
): Promise<number> {
  // guard:allow-unscoped — retention cleanup of settled stitch job rows.
  const pruned = await getDb()
    .delete(jobs)
    .where(
      and(
        ne(jobs.state, "queued"),
        ne(jobs.state, "running"),
        lt(jobs.updatedAt, iso(now - STITCH_JOB_RETENTION_MS)),
      ),
    )
    .returning({ recordingId: jobs.recordingId });
  return pruned.length;
}
