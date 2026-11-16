import { createRequire } from "node:module";

import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");

let db: ReturnType<typeof drizzle>;
let client: Awaited<ReturnType<typeof PGlite.create>>;

vi.mock("../db/index.js", async () => {
  const schema = await import("../db/schema.js");
  return { getDb: () => db, schema };
});

import {
  assertStitchCapacity,
  claimStitchJob,
  insertStitchJob,
  planStitchRecovery,
  pruneSettledStitchJobs,
  renewStitchLease,
  settleStitchJob,
  STITCH_DISPATCH_GRACE_MS,
  STITCH_JOB_RETENTION_MS,
  STITCH_LEASE_MS,
  STITCH_MAX_ACTIVE_PER_OWNER,
  STITCH_MAX_ACTIVE_TOTAL,
  STITCH_MAX_ATTEMPTS,
  STITCH_MAX_RUNNING,
  StitchQueueFullError,
} from "./stitch-job-store.js";

const T0 = Date.parse("2026-11-14T12:00:00.000Z");

beforeEach(async () => {
  client = await PGlite.create("memory://");
  db = drizzle(client);
  // Mirrors migration 105 in server/plugins/db.ts.
  await client.exec(`CREATE TABLE clips_stitch_jobs (
    recording_id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    org_id TEXT,
    source_ids_json TEXT NOT NULL,
    storage_provider_id TEXT,
    state TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    lease_token TEXT,
    lease_until TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE TABLE recordings (id TEXT PRIMARY KEY, status TEXT NOT NULL);`);
});

afterEach(async () => {
  await client.close();
});

async function queue(
  recordingId: string,
  options: { owner?: string; now?: number; status?: string } = {},
) {
  await client.query("INSERT INTO recordings (id, status) VALUES ($1, $2)", [
    recordingId,
    options.status ?? "processing",
  ]);
  await insertStitchJob({
    recordingId,
    ownerEmail: options.owner ?? "owner@example.com",
    orgId: "org-1",
    sourceRecordingIds: ["a", "b"],
    storageProviderId: "s3",
    now: options.now ?? T0,
  });
}

interface JobRow {
  state: string;
  attempts: number;
  lease_token: string | null;
  last_error: string | null;
}

async function row(recordingId: string): Promise<JobRow | undefined> {
  const result = (await client.query(
    "SELECT state, attempts, lease_token, last_error FROM clips_stitch_jobs WHERE recording_id = $1",
    [recordingId],
  )) as { rows: JobRow[] };
  return result.rows[0];
}

describe("stitch job leases", () => {
  it("lets one worker claim a queued job and refuses a second while the lease lives", async () => {
    await queue("rec-1");
    const first = await claimStitchJob("rec-1", T0);
    expect(first).toMatchObject({ claimed: true });
    expect(await row("rec-1")).toMatchObject({ state: "running", attempts: 1 });

    const second = await claimStitchJob("rec-1", T0 + STITCH_LEASE_MS - 1);
    expect(second).toMatchObject({ claimed: false, reason: "leased" });
  });

  it("hands a job whose worker died to the next worker, and fences the old one", async () => {
    await queue("rec-1");
    const dead = await claimStitchJob("rec-1", T0);
    if (!dead.claimed) throw new Error("expected a claim");

    // The first worker stopped renewing; its lease ran out.
    const later = T0 + STITCH_LEASE_MS + 1;
    const next = await claimStitchJob("rec-1", later);
    if (!next.claimed) throw new Error("expected the job to be reclaimed");
    expect(next.token).not.toBe(dead.token);
    expect(next.job.attempts).toBe(2);

    // The old worker can neither renew nor settle the job any more.
    expect(await renewStitchLease("rec-1", dead.token, later)).toBe(false);
    expect(
      await settleStitchJob({
        recordingId: "rec-1",
        token: dead.token,
        state: "failed",
        error: "late",
        now: later,
      }),
    ).toBe(false);
    expect(await renewStitchLease("rec-1", next.token, later)).toBe(true);
    expect(
      await settleStitchJob({
        recordingId: "rec-1",
        token: next.token,
        state: "ready",
        now: later,
      }),
    ).toBe(true);
    expect(await row("rec-1")).toMatchObject({
      state: "ready",
      lease_token: null,
    });
    // A settled job is never run again.
    expect(
      await claimStitchJob("rec-1", later + STITCH_LEASE_MS),
    ).toMatchObject({ claimed: false, reason: "settled" });
  });

  it("stops after the last attempt", async () => {
    await queue("rec-1");
    let now = T0;
    for (let attempt = 1; attempt <= STITCH_MAX_ATTEMPTS; attempt += 1) {
      expect(await claimStitchJob("rec-1", now)).toMatchObject({
        claimed: true,
      });
      now += STITCH_LEASE_MS + 1;
    }
    expect(await claimStitchJob("rec-1", now)).toMatchObject({
      claimed: false,
      reason: "exhausted",
    });
  });

  it("keeps a job queued while the running limit is reached", async () => {
    for (let i = 0; i <= STITCH_MAX_RUNNING; i += 1) {
      await queue(`rec-${i}`);
    }
    for (let i = 0; i < STITCH_MAX_RUNNING; i += 1) {
      expect(await claimStitchJob(`rec-${i}`, T0)).toMatchObject({
        claimed: true,
      });
    }
    const waiting = `rec-${STITCH_MAX_RUNNING}`;
    expect(await claimStitchJob(waiting, T0)).toMatchObject({
      claimed: false,
      reason: "busy",
    });
    expect(await row(waiting)).toMatchObject({ state: "queued", attempts: 0 });

    // Once a slot frees up, the waiting job can start.
    expect(
      await settleStitchJob({
        recordingId: "rec-0",
        token: (await row("rec-0"))?.lease_token ?? "",
        state: "ready",
        now: T0,
      }),
    ).toBe(true);
    expect(await claimStitchJob(waiting, T0)).toMatchObject({ claimed: true });
  });

  it("only lets the sweep settle a job nobody holds", async () => {
    await queue("rec-1");
    const claim = await claimStitchJob("rec-1", T0);
    expect(claim.claimed).toBe(true);
    expect(
      await settleStitchJob({ recordingId: "rec-1", state: "failed", now: T0 }),
    ).toBe(false);
    expect(
      await settleStitchJob({
        recordingId: "rec-1",
        state: "failed",
        error: "gone",
        now: T0 + STITCH_LEASE_MS + 1,
      }),
    ).toBe(true);
    expect(await row("rec-1")).toMatchObject({
      state: "failed",
      last_error: "gone",
    });
  });
});

describe("stitch admission", () => {
  it("bounds queued and running stitches per owner", async () => {
    for (let i = 0; i < STITCH_MAX_ACTIVE_PER_OWNER; i += 1) {
      await queue(`rec-${i}`, { owner: "busy@example.com" });
    }
    await expect(assertStitchCapacity("Busy@Example.com")).rejects.toThrow(
      StitchQueueFullError,
    );
    await expect(
      assertStitchCapacity("someone-else@example.com"),
    ).resolves.toBeUndefined();

    // A settled stitch no longer counts.
    await settleStitchJob({ recordingId: "rec-0", state: "failed", now: T0 });
    await expect(
      assertStitchCapacity("busy@example.com"),
    ).resolves.toBeUndefined();
  });

  it("bounds queued and running stitches on the whole server", async () => {
    for (let i = 0; i < STITCH_MAX_ACTIVE_TOTAL; i += 1) {
      await queue(`rec-${i}`, { owner: `user-${i}@example.com` });
    }
    await expect(assertStitchCapacity("new@example.com")).rejects.toMatchObject(
      { scope: "total" },
    );
  });
});

describe("stitch recovery plan", () => {
  it("re-dispatches lost and waiting jobs up to the free slots, oldest first", async () => {
    await queue("dead", { now: T0 });
    await queue("waiting-1", { now: T0 + 1_000 });
    await queue("waiting-2", { now: T0 + 2_000 });
    await queue("fresh", { now: T0 + 60_000 });
    await claimStitchJob("dead", T0);

    const now = T0 + STITCH_LEASE_MS + 1;
    // "fresh" was just queued; its own dispatch gets the grace period.
    expect(now - (T0 + 60_000)).toBeGreaterThan(STITCH_DISPATCH_GRACE_MS);
    const plan = await planStitchRecovery(now);
    expect(plan.dispatch.map((job) => job.recordingId)).toEqual(
      ["dead", "waiting-1", "waiting-2", "fresh"].slice(0, STITCH_MAX_RUNNING),
    );
    expect(plan.exhausted).toEqual([]);
    expect(plan.orphaned).toEqual([]);
  });

  it("leaves a job alone during its dispatch grace period", async () => {
    await queue("rec-1", { now: T0 });
    const plan = await planStitchRecovery(T0 + STITCH_DISPATCH_GRACE_MS - 1);
    expect(plan.dispatch).toEqual([]);
  });

  it("reports jobs out of attempts and jobs whose recording is gone", async () => {
    await queue("spent");
    let now = T0;
    for (let attempt = 1; attempt <= STITCH_MAX_ATTEMPTS; attempt += 1) {
      await claimStitchJob("spent", now);
      now += STITCH_LEASE_MS + 1;
    }
    await queue("deleted", { now: T0, status: "failed" });

    const plan = await planStitchRecovery(now);
    expect(plan.exhausted.map((job) => job.recordingId)).toEqual(["spent"]);
    expect(plan.orphaned.map((job) => job.recordingId)).toEqual(["deleted"]);
    expect(plan.dispatch).toEqual([]);
  });

  it("prunes settled jobs after the retention window", async () => {
    await queue("old");
    await settleStitchJob({ recordingId: "old", state: "ready", now: T0 });
    await queue("active");
    expect(await pruneSettledStitchJobs(T0 + STITCH_JOB_RETENTION_MS - 1)).toBe(
      0,
    );
    expect(await pruneSettledStitchJobs(T0 + STITCH_JOB_RETENTION_MS + 1)).toBe(
      1,
    );
    expect(await row("active")).toMatchObject({ state: "queued" });
  });
});
