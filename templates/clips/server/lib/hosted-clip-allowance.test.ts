import { createRequire } from "node:module";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedClipAllowancePolicy } from "./hosted-clip-allowance.js";

type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;
const state = vi.hoisted(() => ({ db: null as any }));
let client: PGliteClient;

vi.mock("../db/index.js", async () => {
  const schema = await import("../db/schema.js");
  return { getDb: () => state.db, schema };
});
vi.mock("@agent-native/core/org", () => ({
  registerIdentityColumns: vi.fn(),
}));

const allowance = await import("./hosted-clip-allowance.js");

const NOW = new Date("2026-10-14T12:00:00.000Z");

function policy(
  overrides: Partial<HostedClipAllowancePolicy> = {},
): HostedClipAllowancePolicy {
  return {
    enabled: true,
    perIdentityClipLimit: 3,
    reservationBytes: 100,
    ...overrides,
  };
}

function reserve(input: {
  email?: string | null;
  emailVerified?: boolean;
  userId?: string | null;
  recordingId: string;
  ipPrefix?: string | null;
  policy?: HostedClipAllowancePolicy;
}) {
  return allowance.reserveHostedClipAllowance({
    email: input.email === undefined ? "owner@example.com" : input.email,
    emailVerified: input.emailVerified ?? true,
    userId: input.userId === undefined ? "user-1" : input.userId,
    recordingId: input.recordingId,
    ipPrefix: input.ipPrefix ?? null,
    policy: input.policy ?? policy(),
    now: NOW,
  });
}

beforeEach(async () => {
  client = await PGlite.create("memory://");
  state.db = drizzle(client);
  await client.exec(`
    CREATE TABLE recordings (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      storage_mode TEXT,
      failure_code TEXT,
      owner_email TEXT
    );
    CREATE TABLE application_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE clips_hosted_clip_allowances (
      recording_id TEXT PRIMARY KEY,
      identity_key TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('reserved', 'consumed', 'released')),
      ip_prefix TEXT,
      quota_bytes BIGINT NOT NULL DEFAULT 0 CHECK (quota_bytes >= 0),
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      consumed_at TEXT,
      released_at TEXT
    );
    CREATE INDEX clips_hosted_allowances_identity_created_idx
      ON clips_hosted_clip_allowances (identity_key, created_at);
    CREATE INDEX clips_hosted_allowances_user_created_idx
      ON clips_hosted_clip_allowances (user_id, created_at);
    CREATE INDEX clips_hosted_allowances_ip_created_idx
      ON clips_hosted_clip_allowances (ip_prefix, created_at);
    CREATE INDEX clips_hosted_allowances_created_idx
      ON clips_hosted_clip_allowances (created_at);
  `);
});

afterEach(async () => {
  state.db = null;
  await client.close();
});

describe("hosted clip allowance", () => {
  it("canonicalizes only Gmail aliases and buckets strict IP literals", () => {
    expect(
      allowance.canonicalHostedClipIdentityKey(
        " First.Last+clips@Googlemail.com ",
      ),
    ).toBe("firstlast@gmail.com");
    expect(
      allowance.canonicalHostedClipIdentityKey(
        " First.Last+clips@example.com ",
      ),
    ).toBe("first.last+clips@example.com");
    expect(allowance.canonicalHostedClipIdentityKey("not-an-email")).toBeNull();

    expect(allowance.hostedClipIpPrefix("192.0.2.54")).toBe("192.0.2.0/24");
    expect(allowance.hostedClipIpPrefix("2001:db8:12:34::9")).toBe(
      "2001:0db8:0012:0034:0000:0000:0000:0000/64",
    );
    expect(allowance.hostedClipIpPrefix("not-an-ip")).toBeNull();
  });

  it("applies verification, disposable, and disabled denials in order", async () => {
    const disposablePolicy = policy({
      disposableDomains: new Set(["mailinator.com"]),
    });
    await expect(
      reserve({
        email: "new@mailinator.com",
        emailVerified: false,
        recordingId: "unverified",
        policy: disposablePolicy,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "unverified" });
    await expect(
      reserve({
        email: "new@mailinator.com",
        recordingId: "disposable",
        policy: disposablePolicy,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "disposable" });
    await expect(
      reserve({
        recordingId: "disabled",
        policy: policy({ enabled: false }),
      }),
    ).resolves.toMatchObject({ ok: false, reason: "disabled" });
    await expect(
      reserve({ email: null, recordingId: "anonymous" }),
    ).resolves.toMatchObject({ ok: false, reason: "sign_in_required" });
  });

  it("grants exactly one of two concurrent attempts to claim clip three", async () => {
    const capped = policy({ perIdentityClipLimit: 3 });
    await reserve({ recordingId: "recording-1", policy: capped });
    await reserve({ recordingId: "recording-2", policy: capped });

    const outcomes = await Promise.all([
      reserve({ recordingId: "recording-3a", policy: capped }),
      reserve({ recordingId: "recording-3b", policy: capped }),
    ]);
    expect(outcomes.filter((result) => result.ok)).toHaveLength(1);
    expect(outcomes.filter((result) => !result.ok)).toEqual([
      { ok: false, reason: "exhausted" },
    ]);

    const snapshot = await allowance.getHostedClipAllowanceSnapshot({
      email: "owner@example.com",
      emailVerified: true,
      userId: "user-1",
      ipPrefix: null,
      policy: capped,
      now: NOW,
    });
    expect(snapshot).toMatchObject({
      consumedCount: 0,
      reservedCount: 3,
      remainingCount: 0,
      status: "denied",
      denialReason: "exhausted",
    });
  });

  it("serializes the global daily cap across different identities", async () => {
    const capped = policy({ globalDailyClipCap: 1 });
    const outcomes = await Promise.all([
      reserve({
        email: "first@example.com",
        userId: "user-1",
        recordingId: "global-first",
        policy: capped,
      }),
      reserve({
        email: "second@example.com",
        userId: "user-2",
        recordingId: "global-second",
        policy: capped,
      }),
    ]);

    expect(outcomes.filter((result) => result.ok)).toHaveLength(1);
    expect(outcomes.filter((result) => !result.ok)).toEqual([
      { ok: false, reason: "global_daily_cap" },
    ]);
  });

  it("enforces the IP-prefix daily new-identity cap while allowing a missing IP", async () => {
    const capped = policy({ ipPrefixDailyGrantCap: 1 });
    await expect(
      reserve({
        email: "first@example.com",
        userId: "user-1",
        recordingId: "ip-first",
        ipPrefix: "203.0.113.0/24",
        policy: capped,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      reserve({
        email: "second@example.com",
        userId: "user-2",
        recordingId: "ip-second",
        ipPrefix: "203.0.113.0/24",
        policy: capped,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "ip_velocity" });
    await expect(
      reserve({
        email: "third@example.com",
        userId: "user-3",
        recordingId: "ip-missing",
        ipPrefix: null,
        policy: capped,
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("counts reservations against global caps, consumes actual bytes, and releases reserved bytes", async () => {
    const capped = policy({
      perIdentityClipLimit: 5,
      reservationBytes: 700,
      globalDailyClipCap: 5,
      globalRetainedByteCap: 1_000,
    });
    await expect(
      reserve({ recordingId: "budget-1", policy: capped }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      reserve({
        email: "other@example.com",
        userId: "user-2",
        recordingId: "budget-2",
        policy: capped,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "global_storage_cap" });

    const consumed = await allowance.consumeHostedClipAllowance({
      recordingId: "budget-1",
      userId: "user-1",
      actualBytes: 400,
      globalRetainedByteCap: 1_000,
      now: NOW,
    });
    expect(consumed).toMatchObject({
      ok: true,
      allowance: { status: "consumed" },
    });

    await expect(
      reserve({
        email: "other@example.com",
        userId: "user-2",
        recordingId: "budget-2",
        policy: capped,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "global_storage_cap" });

    const second = await reserve({
      email: "other@example.com",
      userId: "user-2",
      recordingId: "budget-3",
      policy: policy({
        perIdentityClipLimit: 5,
        reservationBytes: 700,
        globalDailyClipCap: 5,
        globalRetainedByteCap: 1_100,
      }),
    });
    expect(second).toMatchObject({ ok: true });
    const released = await allowance.releaseHostedClipAllowance({
      recordingId: "budget-3",
      userId: "user-2",
      now: NOW,
    });
    expect(released).toMatchObject({
      ok: true,
      allowance: { status: "released", quotaBytes: 0 },
    });
    await expect(
      reserve({
        email: "another@example.com",
        userId: "user-3",
        recordingId: "budget-4",
        policy: policy({
          perIdentityClipLimit: 5,
          reservationBytes: 700,
          globalDailyClipCap: 5,
          globalRetainedByteCap: 1_100,
        }),
      }),
    ).resolves.toMatchObject({ ok: true });

    const snapshot = await allowance.getHostedClipAllowanceSnapshot({
      email: "owner@example.com",
      emailVerified: true,
      userId: "user-1",
      ipPrefix: null,
      policy: capped,
      now: NOW,
    });
    expect(snapshot).toMatchObject({
      consumedCount: 1,
      retainedBytes: 400,
      reservedBytes: 0,
    });
  });

  it("reacquires the same released grant for an explicit retry without spending a second daily grant", async () => {
    const capped = policy({
      perIdentityClipLimit: 1,
      reservationBytes: 100,
      globalDailyClipCap: 1,
    });
    await client.query(
      `INSERT INTO recordings (id, status, storage_mode, owner_email) VALUES ($1, 'failed', 'hosted', 'owner@example.com')`,
      ["hosted-retry"],
    );
    await reserve({ recordingId: "hosted-retry", policy: capped });
    await allowance.releaseHostedClipAllowance({
      recordingId: "hosted-retry",
      userId: "user-1",
      now: NOW,
    });
    await client.query(
      `INSERT INTO application_state (key, value) VALUES ($1, $2)`,
      [allowance.hostedCleanupConfirmedKey("hosted-retry"), "old-marker"],
    );

    const result = await allowance.reacquireHostedClipAllowanceForRetry({
      recordingId: "hosted-retry",
      userId: "user-1",
      ownerEmail: "OWNER@example.com",
      reservationBytes: 100,
      perIdentityClipLimit: 1,
      globalRetainedByteCap: 1_000,
      now: new Date(NOW.getTime() + 1_000),
    });

    expect(result).toMatchObject({ ok: true, alreadyReserved: false });
    const {
      rows: [row],
    } = await client.query(
      `SELECT status, quota_bytes, created_at FROM clips_hosted_clip_allowances WHERE recording_id = $1`,
      ["hosted-retry"],
    );
    expect(row).toMatchObject({ status: "reserved", quota_bytes: 100 });
    expect(row.created_at).toBe(NOW.toISOString());
    const state = await client.query(
      `SELECT key FROM application_state WHERE key = $1`,
      [allowance.hostedCleanupConfirmedKey("hosted-retry")],
    );
    expect(state.rows).toHaveLength(0);
  });

  it("does not reacquire a hosted recording allowance for another owner", async () => {
    await client.query(
      `INSERT INTO recordings (id, status, storage_mode, owner_email) VALUES ($1, 'failed', 'hosted', 'owner@example.com')`,
      ["hosted-retry-owner"],
    );
    await reserve({ recordingId: "hosted-retry-owner" });
    await allowance.releaseHostedClipAllowance({
      recordingId: "hosted-retry-owner",
      userId: "user-1",
      now: NOW,
    });

    await expect(
      allowance.reacquireHostedClipAllowanceForRetry({
        recordingId: "hosted-retry-owner",
        userId: "user-1",
        ownerEmail: "other@example.com",
        reservationBytes: 100,
        perIdentityClipLimit: 3,
        now: NOW,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "invalid_transition" });
  });

  it("releases only the failed hosted reservation with its exact marker and version", async () => {
    await client.query(
      `INSERT INTO recordings (id, status, storage_mode, owner_email) VALUES ($1, 'failed', 'hosted', 'owner@example.com')`,
      ["hosted-cleanup"],
    );
    await reserve({ recordingId: "hosted-cleanup" });
    await client.query(
      `INSERT INTO application_state (key, value) VALUES ($1, $2)`,
      [allowance.hostedCleanupConfirmedKey("hosted-cleanup"), "marker-v1"],
    );

    await expect(
      allowance.releaseHostedClipAllowanceAfterCleanup({
        recordingId: "hosted-cleanup",
        ownerEmail: "other@example.com",
        expectedUpdatedAt: NOW.toISOString(),
        cleanupMarkerValue: "marker-v1",
        now: NOW,
      }),
    ).resolves.toBe(false);
    await expect(
      allowance.releaseHostedClipAllowanceAfterCleanup({
        recordingId: "hosted-cleanup",
        ownerEmail: "owner@example.com",
        expectedUpdatedAt: NOW.toISOString(),
        cleanupMarkerValue: "stale-marker",
        now: NOW,
      }),
    ).resolves.toBe(false);
    await client.query(
      `UPDATE recordings SET status = 'uploading' WHERE id = $1`,
      ["hosted-cleanup"],
    );
    await expect(
      allowance.releaseHostedClipAllowanceAfterCleanup({
        recordingId: "hosted-cleanup",
        ownerEmail: "OWNER@example.com",
        expectedUpdatedAt: NOW.toISOString(),
        cleanupMarkerValue: "marker-v1",
        now: NOW,
      }),
    ).resolves.toBe(false);
    await client.query(
      `UPDATE recordings SET status = 'failed' WHERE id = $1`,
      ["hosted-cleanup"],
    );
    await expect(
      allowance.releaseHostedClipAllowanceAfterCleanup({
        recordingId: "hosted-cleanup",
        ownerEmail: "owner@example.com",
        expectedUpdatedAt: NOW.toISOString(),
        cleanupMarkerValue: "marker-v1",
        now: NOW,
      }),
    ).resolves.toBe(true);
    const {
      rows: [row],
    } = await client.query(
      `SELECT status, quota_bytes FROM clips_hosted_clip_allowances WHERE recording_id = $1`,
      ["hosted-cleanup"],
    );
    expect(row).toEqual({ status: "released", quota_bytes: 0 });
  });

  it("allows deletion accounting to release bytes without deleting consumed history", async () => {
    await reserve({ recordingId: "retained-history" });
    await allowance.consumeHostedClipAllowance({
      recordingId: "retained-history",
      userId: "user-1",
      actualBytes: 80,
      now: NOW,
    });
    await allowance.adjustHostedClipRetainedBytes({
      recordingId: "retained-history",
      userId: "user-1",
      retainedBytes: 0,
      now: NOW,
    });

    await client.query(
      "INSERT INTO recordings (id, status) VALUES ($1, 'ready')",
      ["retained-history"],
    );
    await client.query("DELETE FROM recordings WHERE id = $1", [
      "retained-history",
    ]);
    await expect(
      allowance.getHostedClipAllowanceStatus({
        recordingId: "retained-history",
        userId: "user-1",
      }),
    ).resolves.toMatchObject({ status: "consumed", quotaBytes: 0 });
    await reserve({
      email: "owner@example.com",
      userId: "user-1",
      recordingId: "retained-history-replacement-1",
    });
    await reserve({
      email: "owner@example.com",
      userId: "user-1",
      recordingId: "retained-history-replacement-2",
    });
    await expect(
      reserve({
        email: "owner@example.com",
        userId: "user-1",
        recordingId: "retained-history-no-refund",
      }),
    ).resolves.toMatchObject({ ok: false, reason: "exhausted" });
  });

  it("logs once when retained bytes cross the configured alert threshold", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const capped = policy({
      reservationBytes: 799,
      globalRetainedByteCap: 1_000,
      retainedByteAlertRatio: 0.8,
    });

    await reserve({ recordingId: "threshold-1", policy: capped });
    await reserve({
      email: "other@example.com",
      userId: "user-2",
      recordingId: "threshold-2",
      policy: { ...capped, reservationBytes: 1 },
    });
    await reserve({
      email: "third@example.com",
      userId: "user-3",
      recordingId: "threshold-3",
      policy: { ...capped, reservationBytes: 1 },
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[clips-hosted-storage] retained-byte alert threshold reached",
      expect.objectContaining({
        retainedBytes: 800,
        globalRetainedByteCap: 1_000,
        thresholdBytes: 800,
      }),
    );
    warn.mockRestore();
  });

  it("serializes derivative byte additions and records stored bytes after cleanup failure", async () => {
    const capped = policy({
      reservationBytes: 200,
      globalRetainedByteCap: 250,
    });
    await reserve({ recordingId: "derivatives", policy: capped });
    await allowance.consumeHostedClipAllowance({
      recordingId: "derivatives",
      userId: "user-1",
      actualBytes: 100,
      now: NOW,
    });

    const additions = await Promise.all(
      Array.from({ length: 10 }, () =>
        allowance.addHostedClipRetainedBytesWithinCap({
          recordingId: "derivatives",
          userId: "user-1",
          additionalBytes: 10,
          globalRetainedByteCap: 150,
        }),
      ),
    );
    expect(additions.filter((result) => result.ok)).toHaveLength(5);
    expect(additions.filter((result) => !result.ok)).toHaveLength(5);

    await allowance.accountHostedClipAdditionalBytes({
      recordingId: "derivatives",
      userId: "user-1",
      additionalBytes: 20,
    });
    await expect(
      allowance.getHostedClipAllowanceStatus({
        recordingId: "derivatives",
        userId: "user-1",
      }),
    ).resolves.toMatchObject({ quotaBytes: 170, status: "consumed" });

    await expect(
      allowance.adjustHostedClipRetainedBytes({
        recordingId: "derivatives",
        userId: "user-1",
        retainedBytes: 0,
        globalRetainedByteCap: 150,
        now: NOW,
      }),
    ).resolves.toMatchObject({ ok: true, allowance: { quotaBytes: 0 } });
  });

  it("subtracts deleted derivative bytes from a consumed row without going negative or touching a reservation", async () => {
    await reserve({ recordingId: "shrinking" });
    await expect(
      allowance.subtractHostedClipRetainedBytes({
        recordingId: "shrinking",
        deletedBytes: 40,
      }),
    ).resolves.toEqual({ adjusted: false, quotaBytes: 100 });

    await allowance.consumeHostedClipAllowance({
      recordingId: "shrinking",
      userId: "user-1",
      actualBytes: 100,
      now: NOW,
    });
    await expect(
      allowance.subtractHostedClipRetainedBytes({
        recordingId: "shrinking",
        deletedBytes: 40,
      }),
    ).resolves.toEqual({ adjusted: true, quotaBytes: 60 });
    await expect(
      allowance.subtractHostedClipRetainedBytes({
        recordingId: "shrinking",
        deletedBytes: 500,
      }),
    ).resolves.toEqual({ adjusted: true, quotaBytes: 0 });
    await expect(
      allowance.subtractHostedClipRetainedBytes({
        recordingId: "missing",
        deletedBytes: 1,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("reports the same current denial gates without writing", async () => {
    const capped = policy({
      ipPrefixDailyGrantCap: 1,
      globalDailyClipCap: 1,
      globalRetainedByteCap: 1_000,
      disposableDomains: new Set(["mailinator.com"]),
    });
    await reserve({
      email: "owner@example.com",
      userId: "user-1",
      recordingId: "snapshot-first",
      ipPrefix: "198.51.100.0/24",
      policy: capped,
    });

    await expect(
      allowance.getHostedClipAllowanceSnapshot({
        email: "another@mailinator.com",
        emailVerified: true,
        userId: "user-2",
        ipPrefix: "198.51.100.0/24",
        policy: capped,
        now: NOW,
      }),
    ).resolves.toMatchObject({ denialReason: "disposable" });
    await expect(
      allowance.getHostedClipAllowanceSnapshot({
        email: "other@example.com",
        emailVerified: true,
        userId: "user-2",
        ipPrefix: "198.51.100.0/24",
        policy: capped,
        now: NOW,
      }),
    ).resolves.toMatchObject({ denialReason: "ip_velocity" });
    await expect(
      allowance.getHostedClipAllowanceSnapshot({
        email: "other@example.com",
        emailVerified: true,
        userId: "user-2",
        ipPrefix: null,
        policy: capped,
        now: NOW,
      }),
    ).resolves.toMatchObject({ denialReason: "global_daily_cap" });
    await expect(
      allowance.getHostedClipAllowanceSnapshot({
        email: "owner@example.com",
        emailVerified: false,
        userId: "user-1",
        ipPrefix: null,
        policy: capped,
        now: NOW,
      }),
    ).resolves.toMatchObject({ denialReason: "unverified" });
  });

  it("reports a full retained-byte budget in read-only snapshots", async () => {
    const capped = policy({
      reservationBytes: 1_000,
      globalRetainedByteCap: 1_000,
    });
    await expect(
      reserve({ recordingId: "storage-first", policy: capped }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      allowance.getHostedClipAllowanceSnapshot({
        email: "other@example.com",
        emailVerified: true,
        userId: "user-2",
        ipPrefix: null,
        policy: capped,
        now: NOW,
      }),
    ).resolves.toMatchObject({ denialReason: "global_storage_cap" });
  });
});
