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
const mockTrack = vi.hoisted(() => vi.fn());
const hostedConfig = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));
vi.mock("@agent-native/core/server", () => ({
  getAppConfig: () => ({ clips: { hostedStorage: hostedConfig.value } }),
}));
vi.mock("@agent-native/core/tracking", () => ({
  track: (...args: unknown[]) => mockTrack(...args),
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

function setHostedConfig(overrides: Record<string, unknown> = {}) {
  hostedConfig.value = {
    perIdentityClipLimit: 3,
    maxClipBytes: 100,
    retainedByteAlertRatio: 0.8,
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
  setHostedConfig();
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
      session_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (session_id, key)
    );
    CREATE TABLE recording_media_cleanups (id TEXT PRIMARY KEY,accounting_settled BOOLEAN NOT NULL DEFAULT false);
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
  mockTrack.mockReset();
  state.db = null;
  await client.close();
});

function captureStatements(failOn?: RegExp): string[] {
  const statements: string[] = [];
  // Allowance queries run on the PGlite transaction handle, so wrap that.
  type Transaction = { query: (...args: unknown[]) => unknown };
  const originalTransaction = client.transaction.bind(client) as (
    callback: (tx: Transaction) => Promise<unknown>,
  ) => Promise<unknown>;
  vi.spyOn(client, "transaction").mockImplementation(((
    callback: (tx: Transaction) => Promise<unknown>,
  ) =>
    originalTransaction((tx) => {
      const originalQuery = tx.query.bind(tx);
      tx.query = (text, ...rest) => {
        statements.push(String(text));
        if (failOn?.test(String(text)))
          return Promise.reject(new Error("statement timeout"));
        return originalQuery(text, ...rest);
      };
      return callback(tx);
    })) as typeof client.transaction);
  return statements;
}

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

    setHostedConfig({ globalRetainedByteCap: 1_000 });
    const consumed = await allowance.consumeHostedClipAllowance({
      recordingId: "budget-1",
      userId: "user-1",
      actualBytes: 400,
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
      reason: "abort",
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

  it("releases only old hosted reservations that have no recording row", async () => {
    await reserve({ recordingId: "orphaned-reservation" });
    await reserve({ recordingId: "live-reservation" });
    await client.query(
      `INSERT INTO recordings (id, status, storage_mode, owner_email) VALUES ($1, 'uploading', 'hosted', 'owner@example.com')`,
      ["live-reservation"],
    );

    await expect(
      allowance.releaseOrphanedHostedClipAllowance({
        recordingId: "orphaned-reservation",
        userId: "user-1",
        createdBefore: NOW,
        now: NOW,
      }),
    ).resolves.toBe(false);
    await expect(
      allowance.releaseOrphanedHostedClipAllowance({
        recordingId: "live-reservation",
        userId: "user-1",
        createdBefore: new Date(NOW.getTime() + 1),
        now: NOW,
      }),
    ).resolves.toBe(false);
    await expect(
      allowance.releaseOrphanedHostedClipAllowance({
        recordingId: "orphaned-reservation",
        userId: "user-1",
        createdBefore: new Date(NOW.getTime() + 1),
        now: NOW,
      }),
    ).resolves.toBe(true);

    const { rows } = await client.query(
      `SELECT recording_id, status, quota_bytes FROM clips_hosted_clip_allowances ORDER BY recording_id`,
    );
    expect(rows).toEqual([
      {
        recording_id: "live-reservation",
        status: "reserved",
        quota_bytes: 100,
      },
      {
        recording_id: "orphaned-reservation",
        status: "released",
        quota_bytes: 0,
      },
    ]);
  });

  it("retains an orphaned reservation while its durable media cleanup is unconfirmed", async () => {
    await reserve({ recordingId: "pending-cleanup" });
    await client.exec(
      "INSERT INTO recording_media_cleanups(id) VALUES ('pending-cleanup')",
    );
    expect(
      await allowance.releaseOrphanedHostedClipAllowance({
        recordingId: "pending-cleanup",
        userId: "user-1",
        createdBefore: new Date(NOW.getTime() + 1),
        now: NOW,
      }),
    ).toBe(false);
    expect(
      (
        await client.query(
          "SELECT status,quota_bytes FROM clips_hosted_clip_allowances WHERE recording_id='pending-cleanup'",
        )
      ).rows,
    ).toEqual([{ status: "reserved", quota_bytes: 100 }]);
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
      reason: "abort",
      now: NOW,
    });
    await client.query(
      `INSERT INTO application_state (session_id, key, value, updated_at) VALUES ($1, $2, $3, $4)`,
      [
        "owner@example.com",
        allowance.hostedCleanupConfirmedKey("hosted-retry"),
        "old-marker",
        NOW.getTime(),
      ],
    );
    await client.query(
      `INSERT INTO application_state (session_id, key, value, updated_at) VALUES ($1, $2, $3, $4)`,
      [
        "other@example.com",
        allowance.hostedCleanupConfirmedKey("hosted-retry"),
        "other-owner-marker",
        NOW.getTime(),
      ],
    );

    setHostedConfig({
      maxClipBytes: 100,
      perIdentityClipLimit: 1,
      globalRetainedByteCap: 1_000,
    });
    const result = await allowance.reacquireHostedClipAllowanceForRetry({
      recordingId: "hosted-retry",
      userId: "user-1",
      ownerEmail: "OWNER@example.com",
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
      `SELECT session_id, key FROM application_state WHERE key = $1`,
      [allowance.hostedCleanupConfirmedKey("hosted-retry")],
    );
    expect(state.rows).toEqual([
      {
        session_id: "other@example.com",
        key: allowance.hostedCleanupConfirmedKey("hosted-retry"),
      },
    ]);
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
      reason: "abort",
      now: NOW,
    });

    await expect(
      allowance.reacquireHostedClipAllowanceForRetry({
        recordingId: "hosted-retry-owner",
        userId: "user-1",
        ownerEmail: "other@example.com",
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
      `INSERT INTO application_state (session_id, key, value, updated_at) VALUES ($1, $2, $3, $4)`,
      [
        "owner@example.com",
        allowance.hostedCleanupConfirmedKey("hosted-cleanup"),
        "marker-v1",
        NOW.getTime(),
      ],
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

  it("removes a mixed-case resumable session only for the matching owner", async () => {
    await client.query(
      `INSERT INTO recordings (id, status, storage_mode, owner_email) VALUES ($1, 'failed', 'hosted', 'owner@example.com')`,
      ["hosted-mixed-case-session"],
    );
    await reserve({ recordingId: "hosted-mixed-case-session" });
    const sessionKey = "resumable-session-hosted-mixed-case-session";
    await client.query(
      `INSERT INTO application_state (session_id, key, value, updated_at)
       VALUES ($1, $2, $3, $4)`,
      [
        "owner@example.com",
        allowance.hostedCleanupConfirmedKey("hosted-mixed-case-session"),
        "marker-v1",
        NOW.getTime(),
      ],
    );
    await client.query(
      `INSERT INTO application_state (session_id, key, value, updated_at)
       VALUES ($1, $2, $3, $4), ($5, $2, $6, $4)`,
      [
        "OWNER@example.com",
        sessionKey,
        "legacy-session",
        NOW.getTime(),
        "other@example.com",
        "other-owner-session",
      ],
    );

    await expect(
      allowance.releaseHostedClipAllowanceAfterCleanup({
        recordingId: "hosted-mixed-case-session",
        ownerEmail: "owner@example.com",
        expectedUpdatedAt: NOW.toISOString(),
        cleanupMarkerValue: "marker-v1",
        sessionKey,
        now: NOW,
      }),
    ).resolves.toBe(true);

    const { rows } = await client.query(
      `SELECT session_id, value FROM application_state WHERE key = $1 ORDER BY session_id`,
      [sessionKey],
    );
    expect(rows).toEqual([
      { session_id: "other@example.com", value: "other-owner-session" },
    ]);
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

  it("tracks once when retained bytes cross the configured alert threshold", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
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

    const crossings = mockTrack.mock.calls.filter(
      ([name]) => name === "clips_hosted_retained_bytes_threshold",
    );
    expect(crossings).toHaveLength(1);
    expect(crossings[0]?.[1]).toMatchObject({
      retainedBytes: 800,
      globalRetainedByteCap: 1_000,
      ratio: 0.8,
    });
    expect(warn).toHaveBeenCalledWith(
      "[clips-hosted] clips_hosted_retained_bytes_threshold",
      expect.objectContaining({
        recordingId: "threshold-2",
        authUserId: "user-2",
      }),
    );
    vi.restoreAllMocks();
  });

  it("tracks allowance state changes with the retained level after the write", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    setHostedConfig({ globalRetainedByteCap: 1_000 });
    const capped = policy({
      reservationBytes: 100,
      globalRetainedByteCap: 1_000,
    });
    const tracked = (name: string) =>
      mockTrack.mock.calls.filter(([event]) => event === name);

    await reserve({ recordingId: "events-1", policy: capped });
    expect(tracked("clips_hosted_reserved")[0]).toEqual([
      "clips_hosted_reserved",
      expect.objectContaining({
        recordingId: "events-1",
        retainedBytes: 100,
        globalRetainedByteCap: 1_000,
        ratio: 0.1,
      }),
      { authUserId: "user-1" },
    ]);

    await allowance.consumeHostedClipAllowance({
      recordingId: "events-1",
      userId: "user-1",
      actualBytes: 60,
      now: NOW,
    });
    expect(tracked("clips_hosted_consumed")[0]?.[1]).toMatchObject({
      actualBytes: 60,
      retainedBytes: 60,
    });

    await allowance.addHostedClipRetainedBytesWithinCap({
      recordingId: "events-1",
      userId: "user-1",
      additionalBytes: 10,
    });
    expect(tracked("clips_hosted_derivative_added")[0]?.[1]).toMatchObject({
      additionalBytes: 10,
      retainedBytes: 70,
    });
    await allowance.addHostedClipRetainedBytesWithinCap({
      recordingId: "events-1",
      userId: "user-1",
      additionalBytes: 2_000,
    });
    expect(tracked("clips_hosted_derivative_rejected")[0]?.[1]).toMatchObject({
      additionalBytes: 2_000,
      retainedBytes: 70,
    });

    await allowance.subtractHostedClipRetainedBytes({
      recordingId: "events-1",
      deletedBytes: 30,
    });
    expect(tracked("clips_hosted_media_deleted")[0]?.[1]).toEqual({
      app_name: "clips",
      template_name: "clips",
      recordingId: "events-1",
      freedBytes: 30,
    });

    await reserve({
      email: "other@example.com",
      userId: "user-2",
      recordingId: "events-2",
      policy: capped,
    });
    await allowance.releaseHostedClipAllowance({
      recordingId: "events-2",
      userId: "user-2",
      reason: "abandon",
    });
    expect(tracked("clips_hosted_released")[0]?.[1]).toEqual({
      app_name: "clips",
      template_name: "clips",
      recordingId: "events-2",
      reason: "abandon",
      releasedBytes: 100,
    });
  });

  it("tracks reaper releases without a retained level", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    setHostedConfig({ globalRetainedByteCap: 1_000 });
    await reserve({ recordingId: "reaped" });
    mockTrack.mockClear();
    await allowance.releaseOrphanedHostedClipAllowance({
      recordingId: "reaped",
      userId: "user-1",
      createdBefore: new Date(NOW.getTime() + 1),
      now: NOW,
    });
    expect(mockTrack).toHaveBeenCalledWith(
      "clips_hosted_released",
      {
        app_name: "clips",
        template_name: "clips",
        recordingId: "reaped",
        reason: "orphan_reaped",
        releasedBytes: 100,
      },
      { authUserId: "user-1" },
    );
  });

  it("tracks denials with their reason and stage", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    await reserve({ recordingId: "denied-1", emailVerified: false });
    expect(mockTrack).toHaveBeenCalledWith(
      "clips_hosted_denied",
      expect.objectContaining({
        recordingId: "denied-1",
        denyReason: "unverified",
        stage: "reserve",
      }),
      { authUserId: "user-1" },
    );
  });

  it("denies a consume over the cap with a consume-stage denial", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    await reserve({ recordingId: "consume-cap" });
    setHostedConfig({ globalRetainedByteCap: 1_000 });
    mockTrack.mockClear();
    await expect(
      allowance.consumeHostedClipAllowance({
        recordingId: "consume-cap",
        userId: "user-1",
        actualBytes: 5_000,
        now: NOW,
      }),
    ).resolves.toEqual({ ok: false, reason: "global_storage_cap" });
    expect(mockTrack).toHaveBeenCalledWith(
      "clips_hosted_denied",
      expect.objectContaining({
        denyReason: "global_storage_cap",
        stage: "consume",
      }),
      { authUserId: "user-1" },
    );
  });

  it("does not re-track consumption when finalize retries a consumed allowance", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    await reserve({ recordingId: "consume-twice" });
    const consume = () =>
      allowance.consumeHostedClipAllowance({
        recordingId: "consume-twice",
        userId: "user-1",
        actualBytes: 50,
        now: NOW,
      });
    await consume();
    await consume();
    expect(
      mockTrack.mock.calls.filter(([name]) => name === "clips_hosted_consumed"),
    ).toHaveLength(1);
  });

  it("never tracks a transaction that fails after its event was queued", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    await client.exec(`
      CREATE FUNCTION fail_allowance_commit() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'commit refused'; END;
      $$ LANGUAGE plpgsql;
      CREATE CONSTRAINT TRIGGER fail_allowance_commit
        AFTER INSERT ON clips_hosted_clip_allowances
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION fail_allowance_commit();
    `);
    await expect(reserve({ recordingId: "rolled-back" })).rejects.toThrow(
      /commit refused/,
    );
    expect(mockTrack).not.toHaveBeenCalled();
    const { rows } = await client.query(
      "SELECT 1 FROM clips_hosted_clip_allowances WHERE recording_id = 'rolled-back'",
    );
    expect(rows).toEqual([]);
  });

  it("keeps reserve, consume and release working when tracking throws", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    mockTrack.mockImplementation(() => {
      throw new Error("analytics down");
    });
    await expect(
      reserve({ recordingId: "track-throws" }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      allowance.consumeHostedClipAllowance({
        recordingId: "track-throws",
        userId: "user-1",
        actualBytes: 10,
        now: NOW,
      }),
    ).resolves.toMatchObject({ ok: true });
    await reserve({
      email: "other@example.com",
      userId: "user-2",
      recordingId: "track-throws-release",
    });
    await expect(
      allowance.releaseHostedClipAllowance({
        recordingId: "track-throws-release",
        userId: "user-2",
        reason: "abort",
      }),
    ).resolves.toMatchObject({ ok: true, alreadyReleased: false });
    expect(mockTrack).toHaveBeenCalled();
  });

  it("reads the retained-byte SUM once per capped reserve and reuses it for the level", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const statements = captureStatements();
    await reserve({
      recordingId: "capped-once",
      policy: policy({ globalRetainedByteCap: 1_000 }),
    });
    expect(statements.filter((text) => /sum\(/i.test(text))).toHaveLength(1);
    expect(mockTrack).toHaveBeenCalledWith(
      "clips_hosted_reserved",
      expect.objectContaining({ globalRetainedByteCap: 1_000 }),
      { authUserId: "user-1" },
    );
  });

  it("runs no retained-byte SUM and reports no level while no cap is configured", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const statements = captureStatements();
    const sums = () => statements.filter((text) => /sum\(/i.test(text));

    await reserve({ recordingId: "uncapped" });
    await allowance.consumeHostedClipAllowance({
      recordingId: "uncapped",
      userId: "user-1",
      actualBytes: 50,
      now: NOW,
    });
    await allowance.adjustHostedClipRetainedBytes({
      recordingId: "uncapped",
      userId: "user-1",
      retainedBytes: 40,
      now: NOW,
    });
    await allowance.accountHostedClipAdditionalBytes({
      recordingId: "uncapped",
      userId: "user-1",
      additionalBytes: 5,
    });
    await allowance.subtractHostedClipRetainedBytes({
      recordingId: "uncapped",
      deletedBytes: 5,
      now: NOW,
    });
    await reserve({
      email: "other@example.com",
      userId: "user-2",
      recordingId: "uncapped-release",
    });
    await allowance.releaseHostedClipAllowance({
      recordingId: "uncapped-release",
      userId: "user-2",
      reason: "abort",
    });
    await reserve({
      email: "third@example.com",
      userId: "user-3",
      recordingId: "uncapped-reaped",
    });
    await allowance.releaseOrphanedHostedClipAllowance({
      recordingId: "uncapped-reaped",
      userId: "user-3",
      createdBefore: new Date(NOW.getTime() + 1),
      now: NOW,
    });

    await client.query(
      `INSERT INTO recordings (id, status, storage_mode, owner_email) VALUES ($1, 'failed', 'hosted', $2), ($3, 'failed', 'hosted', $2)`,
      ["uncapped-retry", "retry@example.com", "uncapped-cleanup"],
    );
    const retryOwner = {
      email: "retry@example.com",
      userId: "user-4",
    };
    await reserve({ ...retryOwner, recordingId: "uncapped-retry" });
    await allowance.releaseHostedClipAllowance({
      recordingId: "uncapped-retry",
      userId: "user-4",
      reason: "abort",
      now: NOW,
    });
    await expect(
      allowance.reacquireHostedClipAllowanceForRetry({
        recordingId: "uncapped-retry",
        userId: "user-4",
        ownerEmail: "retry@example.com",
        now: NOW,
      }),
    ).resolves.toMatchObject({ ok: true, alreadyReserved: false });
    await reserve({ ...retryOwner, recordingId: "uncapped-cleanup" });
    await client.query(
      `INSERT INTO application_state (session_id, key, value, updated_at) VALUES ($1, $2, $3, $4)`,
      [
        "retry@example.com",
        allowance.hostedCleanupConfirmedKey("uncapped-cleanup"),
        "marker",
        NOW.getTime(),
      ],
    );
    await expect(
      allowance.releaseHostedClipAllowanceAfterCleanup({
        recordingId: "uncapped-cleanup",
        ownerEmail: "retry@example.com",
        expectedUpdatedAt: NOW.toISOString(),
        cleanupMarkerValue: "marker",
        now: NOW,
      }),
    ).resolves.toBe(true);

    expect(sums()).toEqual([]);
    expect(mockTrack).toHaveBeenCalled();
    for (const [, props] of mockTrack.mock.calls) {
      expect(props).not.toHaveProperty("retainedBytes");
      expect(props).not.toHaveProperty("ratio");
      expect(props).not.toHaveProperty("globalRetainedByteCap");
    }

    setHostedConfig({ globalRetainedByteCap: 1_000 });
    mockTrack.mockClear();
    await reserve({
      email: "fourth@example.com",
      userId: "user-4",
      recordingId: "capped-release",
      policy: policy({ globalRetainedByteCap: 1_000 }),
    });
    await allowance.releaseHostedClipAllowance({
      recordingId: "capped-release",
      userId: "user-4",
      reason: "abort",
    });
    expect(sums().length).toBeGreaterThan(0);
    expect(mockTrack).toHaveBeenCalledWith(
      "clips_hosted_released",
      expect.not.objectContaining({ retainedBytes: expect.anything() }),
      { authUserId: "user-4" },
    );
  });

  it("runs no retained-byte SUM for release, subtract or an adjust decrease even with a cap", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const capped = policy({ globalRetainedByteCap: 1_000 });
    setHostedConfig({ globalRetainedByteCap: 1_000 });
    await reserve({ recordingId: "cap-consumed", policy: capped });
    await allowance.consumeHostedClipAllowance({
      recordingId: "cap-consumed",
      userId: "user-1",
      actualBytes: 80,
      now: NOW,
    });
    await reserve({
      email: "other@example.com",
      userId: "user-2",
      recordingId: "cap-released",
      policy: capped,
    });

    const statements = captureStatements();
    await allowance.adjustHostedClipRetainedBytes({
      recordingId: "cap-consumed",
      userId: "user-1",
      retainedBytes: 60,
      now: NOW,
    });
    await allowance.subtractHostedClipRetainedBytes({
      recordingId: "cap-consumed",
      deletedBytes: 10,
      now: NOW,
    });
    await allowance.releaseHostedClipAllowance({
      recordingId: "cap-released",
      userId: "user-2",
      reason: "abort",
    });
    expect(statements.length).toBeGreaterThan(0);
    expect(statements.filter((text) => /sum\(/i.test(text))).toHaveLength(0);
  });

  it("commits a release even when the retained-byte SUM would fail", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    setHostedConfig({ globalRetainedByteCap: 1_000 });
    await reserve({
      recordingId: "sum-fails",
      policy: policy({ globalRetainedByteCap: 1_000 }),
    });
    captureStatements(/sum\(/i);
    await expect(
      allowance.releaseHostedClipAllowance({
        recordingId: "sum-fails",
        userId: "user-1",
        reason: "abort",
      }),
    ).resolves.toMatchObject({ ok: true, alreadyReleased: false });
  });

  it("tracks a threshold crossing when a retry reservation crosses the alert level", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await client.query(
      `INSERT INTO recordings (id, status, storage_mode, owner_email) VALUES ($1, 'failed', 'hosted', 'owner@example.com')`,
      ["retry-threshold"],
    );
    await reserve({ recordingId: "retry-threshold" });
    await allowance.releaseHostedClipAllowance({
      recordingId: "retry-threshold",
      userId: "user-1",
      reason: "abort",
      now: NOW,
    });
    await reserve({
      email: "other@example.com",
      userId: "user-2",
      recordingId: "retry-fill",
      policy: policy({ reservationBytes: 750 }),
    });
    setHostedConfig({
      maxClipBytes: 100,
      globalRetainedByteCap: 1_000,
      retainedByteAlertRatio: 0.8,
    });
    mockTrack.mockClear();
    await expect(
      allowance.reacquireHostedClipAllowanceForRetry({
        recordingId: "retry-threshold",
        userId: "user-1",
        ownerEmail: "owner@example.com",
        now: NOW,
      }),
    ).resolves.toMatchObject({ ok: true, alreadyReserved: false });
    const crossings = mockTrack.mock.calls.filter(
      ([name]) => name === "clips_hosted_retained_bytes_threshold",
    );
    expect(crossings).toHaveLength(1);
    expect(crossings[0]?.[1]).toMatchObject({
      recordingId: "retry-threshold",
      retainedBytes: 850,
      thresholdBytes: 800,
    });
  });

  it("denies an adjust over the cap with an adjust-stage denial", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    await reserve({ recordingId: "adjust-cap" });
    await allowance.consumeHostedClipAllowance({
      recordingId: "adjust-cap",
      userId: "user-1",
      actualBytes: 50,
      now: NOW,
    });
    setHostedConfig({ globalRetainedByteCap: 1_000 });
    mockTrack.mockClear();
    await expect(
      allowance.adjustHostedClipRetainedBytes({
        recordingId: "adjust-cap",
        userId: "user-1",
        retainedBytes: 5_000,
        now: NOW,
      }),
    ).resolves.toEqual({ ok: false, reason: "global_storage_cap" });
    expect(mockTrack).toHaveBeenCalledWith(
      "clips_hosted_denied",
      expect.objectContaining({
        recordingId: "adjust-cap",
        denyReason: "global_storage_cap",
        stage: "adjust",
      }),
      { authUserId: "user-1" },
    );
  });

  it("logs a tracking failure whose thrown value cannot be stringified", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockTrack.mockImplementation(() => {
      throw Object.create(null);
    });
    await expect(
      reserve({ recordingId: "track-null-proto" }),
    ).resolves.toMatchObject({ ok: true });
    expect(warn).toHaveBeenCalledWith(
      "[clips-hosted] tracking failed",
      expect.objectContaining({ event: "clips_hosted_reserved" }),
    );
  });

  it("logs a tracking failure without failing the write", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockTrack.mockImplementation(() => {
      throw new Error("analytics down");
    });
    await expect(
      reserve({ recordingId: "track-warns" }),
    ).resolves.toMatchObject({ ok: true });
    expect(warn).toHaveBeenCalledWith("[clips-hosted] tracking failed", {
      event: "clips_hosted_reserved",
      error: "analytics down",
    });
    const { rows } = await client.query(
      "SELECT status FROM clips_hosted_clip_allowances WHERE recording_id = 'track-warns'",
    );
    expect(rows).toEqual([{ status: "reserved" }]);
  });

  it("emits no denial event or IP log from the status snapshot", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const exhausted = policy({
      perIdentityClipLimit: 1,
      ipPrefixDailyGrantCap: 1,
    });
    await reserve({ recordingId: "snapshot-1", policy: exhausted });
    mockTrack.mockClear();
    warn.mockClear();
    const snapshot = await allowance.getHostedClipAllowanceSnapshot({
      email: "owner@example.com",
      userId: "user-1",
      emailVerified: true,
      ipPrefix: null,
      policy: exhausted,
      now: NOW,
    });
    expect(snapshot).toMatchObject({ status: "denied" });
    expect(mockTrack).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not repeat the missing-IP log when a reserve is retried", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const ipCapped = policy({ ipPrefixDailyGrantCap: 5 });
    await reserve({ recordingId: "retry-ip", policy: ipCapped });
    await reserve({ recordingId: "retry-ip", policy: ipCapped });
    expect(
      warn.mock.calls.filter(
        ([message]) => message === "[clips-hosted] ip_prefix_unavailable",
      ),
    ).toHaveLength(1);
  });

  it("logs, without denying, when the IP prefix cap has no client IP", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await reserve({
      recordingId: "no-ip",
      policy: policy({ ipPrefixDailyGrantCap: 1 }),
    });
    expect(result).toMatchObject({ ok: true });
    expect(warn).toHaveBeenCalledWith(
      "[clips-hosted] ip_prefix_unavailable",
      expect.objectContaining({ recordingId: "no-ip", authUserId: "user-1" }),
    );
  });

  it("serializes derivative byte additions and records stored bytes after cleanup failure", async () => {
    const capped = policy({
      reservationBytes: 200,
      globalRetainedByteCap: 250,
    });
    await reserve({ recordingId: "derivatives", policy: capped });
    setHostedConfig({ globalRetainedByteCap: 150 });
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
