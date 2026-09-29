import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());
const ensureColumnExistsMock = vi.hoisted(() => vi.fn(async () => true));
const ensureIndexExistsMock = vi.hoisted(() => vi.fn(async () => true));
const ensureTableExistsMock = vi.hoisted(() => vi.fn(async () => true));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
}));
vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: ensureColumnExistsMock,
  ensureIndexExists: ensureIndexExistsMock,
  ensureTableExists: ensureTableExistsMock,
}));
vi.mock("../db/migrations.js", () => ({
  runMigrations: vi.fn(() => vi.fn(async () => {})),
}));
vi.mock("../agent/run-manager.js", () => ({
  resolveBackgroundRunHardTimeoutMs: vi.fn(() => 10 * 60_000),
}));

import {
  AUTOMATION_TRIGGER_EVENT_MIGRATIONS,
  AUTOMATION_TRIGGER_EVENT_EXPIRY_BATCH_SIZE,
  AUTOMATION_TRIGGER_EVENT_DEDUPE_RETENTION_MS,
  AUTOMATION_TRIGGER_EVENT_PURGE_BATCH_SIZE,
  MAX_AUTOMATION_TRIGGER_EVENT_FAILURES,
  claimNextAutomationTriggerEvent,
  completeAutomationTriggerEvent,
  enqueueAutomationTriggerEvent,
  ensureAutomationTriggerEventQueue,
  expireAutomationTriggerEvent,
  expireStaleAutomationTriggerEvents,
  failAutomationTriggerEvent,
  getAutomationTriggerSweepCursor,
  listReadyAutomationTriggerIds,
  purgeExpiredAutomationTriggerEvents,
  reserveAutomationTriggerEventPurge,
  retryAutomationTriggerEvent,
  scheduleAutomationTriggerEventPurge,
  setAutomationTriggerSweepCursor,
} from "./event-queue.js";

describe("automation trigger event queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 1 });
  });

  it("ensures the active-head index during queue initialization", async () => {
    await ensureAutomationTriggerEventQueue();

    expect(ensureIndexExistsMock).toHaveBeenCalledWith(
      "idx_automation_trigger_event_queue_active_head",
      expect.stringContaining("WHERE status IN ('pending', 'processing')"),
    );
  });

  it("persists payload and source metadata with a stable per-trigger dedupe key", async () => {
    executeMock.mockResolvedValueOnce({ rows: [{ id: "queue-1" }] });
    const input = {
      triggerId: "resource-1",
      triggerOwner: "alice@example.com",
      triggerPath: "jobs/inbox-alert.md",
      appId: "mail",
      eventName: "mail.message.received",
      eventId: "mail:alice@example.com:message-1",
      payload: { messageId: "message-1", subject: "Hello" },
      eventOwner: "alice@example.com",
      emittedAt: "2026-09-27T10:00:00.000Z",
    };

    const queued = await enqueueAutomationTriggerEvent(input);

    expect(queued).toEqual({ id: "queue-1", inserted: true });
    const insert = executeMock.mock.calls[0]?.[0] as {
      args: unknown[];
      sql: string;
    };
    expect(insert.sql).toContain(
      "ON CONFLICT (trigger_id, event_id) DO NOTHING",
    );
    expect(insert.sql).toContain("RETURNING id");
    expect(insert.args).toEqual(
      expect.arrayContaining([
        "resource-1",
        "mail:alice@example.com:message-1",
        JSON.stringify({ kind: "json", value: input.payload }),
        "alice@example.com",
        input.emittedAt,
      ]),
    );
  });

  it("treats a duplicate trigger/event pair as already accepted", async () => {
    executeMock.mockResolvedValueOnce({ rows: [{ id: "first" }] });
    const input = {
      triggerId: "resource-1",
      triggerOwner: "alice@example.com",
      triggerPath: "jobs/inbox-alert.md",
      eventName: "mail.message.received",
      eventId: "stable-1",
      payload: { messageId: "message-1" },
      emittedAt: "2026-09-27T10:00:00.000Z",
    };

    await enqueueAutomationTriggerEvent(input);
    executeMock.mockResolvedValueOnce({ rows: [] });
    expect(await enqueueAutomationTriggerEvent(input)).toEqual({
      id: expect.any(String),
      inserted: false,
    });
  });

  it("claims the oldest due event, reclaims expired claims, and scopes by app", async () => {
    executeMock.mockResolvedValueOnce({
      rows: [
        {
          id: "queue-1",
          sequence_id: "11",
          trigger_id: "resource-1",
          trigger_owner: "alice@example.com",
          trigger_path: "jobs/inbox-alert.md",
          app_id: "mail",
          event_name: "mail.message.received",
          event_id: "stable-1",
          payload: '{"kind":"json","value":{"messageId":"message-1"}}',
          event_owner: "alice@example.com",
          emitted_at: "2026-09-27T10:00:00.000Z",
          attempts: "1",
          failure_attempts: "3",
          claimed_at: "1234",
        },
      ],
    });

    const claimed = await claimNextAutomationTriggerEvent("resource-1", "mail");

    expect(claimed).toMatchObject({
      id: "queue-1",
      sequenceId: 11,
      eventId: "stable-1",
      payload: { messageId: "message-1" },
      attempts: 1,
      failureAttempts: 3,
      claimedAt: 1234,
    });
    const update = executeMock.mock.calls[0]?.[0] as {
      args: unknown[];
      sql: string;
    };
    expect(update.sql).toContain("ORDER BY head.sequence_id ASC");
    expect(update.sql).toContain("head.status IN ('pending', 'processing')");
    expect(update.sql).toContain("head.app_id = ?");
    expect(update.sql).not.toContain("NOT EXISTS");
    expect(update.sql).toContain(
      "claimed.status = 'pending' AND claimed.available_at <= ?",
    );
    expect(update.sql).toContain("claimed.status = 'processing'");
    expect(update.sql).toContain(
      "failure_attempts = claimed.failure_attempts +",
    );
    expect(update.sql).toContain(
      "CASE WHEN claimed.status = 'processing' THEN 1 ELSE 0 END",
    );
    expect(update.sql).toContain("RETURNING claimed.id");
    expect(update.args).toEqual([
      expect.any(Number),
      "resource-1",
      "mail",
      expect.any(Number),
      expect.any(Number),
    ]);
  });

  it("returns null without mutating a FIFO head that is not claimable", async () => {
    executeMock.mockResolvedValueOnce({ rows: [] });

    await expect(
      claimNextAutomationTriggerEvent("resource-1", "mail"),
    ).resolves.toBeNull();

    const query = executeMock.mock.calls[0]?.[0] as {
      args: unknown[];
      sql: string;
    };
    expect(query.sql).toContain("SELECT head.id");
    expect(query.sql).toContain("head.status IN ('pending', 'processing')");
    expect(query.sql).toContain("ORDER BY head.sequence_id ASC");
    expect(query.sql).toContain("LIMIT 1");
    expect(query.sql).toContain("claimed.available_at <= ?");
    expect(query.sql).toContain("claimed.claimed_at <= ?");
    expect(query.args).toEqual([
      expect.any(Number),
      "resource-1",
      "mail",
      expect.any(Number),
      expect.any(Number),
    ]);
    expect(executeMock).toHaveBeenCalledOnce();
  });

  it("defers busy events without consuming a failure attempt", async () => {
    await retryAutomationTriggerEvent(
      "queue-1",
      1234,
      2,
      1,
      new Error("automation is running"),
      { delayMs: 5_000, countFailure: false, timeoutMs: 5_000 },
    );

    const update = executeMock.mock.calls[0]?.[0] as {
      args: unknown[];
      maxAttempts?: number;
      sql: string;
      timeoutMs?: number;
    };
    expect(update.sql).toContain("SET status = 'pending'");
    expect(update.sql).toContain("claimed_at = NULL");
    expect(update.sql).toContain("available_at = ?");
    expect(update.sql).toContain("failure_attempts = failure_attempts + ?");
    expect(update.sql).toContain(
      "claimed_at = ? AND attempts = ? AND failure_attempts = ?",
    );
    expect(update.sql).not.toContain("payload");
    expect(update.timeoutMs).toBe(5_000);
    expect(update.maxAttempts).toBe(1);
    expect(update.args).toEqual([
      expect.any(Number),
      0,
      "automation is running",
      "queue-1",
      1234,
      2,
      1,
    ]);
  });

  it("records a terminal failure after the bounded retry limit", async () => {
    await failAutomationTriggerEvent(
      "queue-1",
      1234,
      8,
      MAX_AUTOMATION_TRIGGER_EVENT_FAILURES - 1,
      new Error("provider unavailable"),
      { timeoutMs: 5_000 },
    );

    const update = executeMock.mock.calls[0]?.[0] as {
      args: unknown[];
      maxAttempts?: number;
      sql: string;
      timeoutMs?: number;
    };
    expect(update.sql).toContain("SET status = 'failed'");
    expect(update.sql).toContain("payload = ?");
    expect(update.sql).toContain("completed_at = ?");
    expect(update.sql).toContain(
      "failure_attempts = GREATEST(failure_attempts, ?)",
    );
    expect(update.sql).toContain(
      "claimed_at = ? AND attempts = ? AND failure_attempts = ?",
    );
    expect(update.timeoutMs).toBe(5_000);
    expect(update.maxAttempts).toBe(1);
    expect(update.args).toEqual([
      '{"kind":"completed"}',
      expect.any(Number),
      MAX_AUTOMATION_TRIGGER_EVENT_FAILURES,
      "provider unavailable",
      "queue-1",
      1234,
      8,
      MAX_AUTOMATION_TRIGGER_EVENT_FAILURES - 1,
    ]);
  });

  it("round trips an undefined payload without coercing it to null", async () => {
    executeMock.mockResolvedValueOnce({
      rows: [
        {
          id: "queue-undefined",
          sequence_id: "12",
          trigger_id: "resource-1",
          trigger_owner: "alice@example.com",
          trigger_path: "jobs/inbox-alert.md",
          app_id: null,
          event_name: "mail.message.received",
          event_id: "stable-undefined",
          payload: '{"kind":"undefined"}',
          event_owner: null,
          emitted_at: "2026-09-27T10:00:00.000Z",
          attempts: "1",
          claimed_at: "1234",
        },
      ],
    });

    const claimed = await claimNextAutomationTriggerEvent("resource-1");

    expect(claimed?.payload).toBeUndefined();
  });

  it("scans pending work and expired processing claims for restart recovery", async () => {
    executeMock.mockResolvedValueOnce({ rows: [{ trigger_id: "resource-1" }] });

    expect(await listReadyAutomationTriggerIds("mail")).toEqual(["resource-1"]);
    const query = executeMock.mock.calls[0]?.[0] as {
      args: unknown[];
      sql: string;
    };
    expect(query.sql).toContain("status = 'pending' AND available_at <= ?");
    expect(query.sql).toContain("status = 'processing'");
    expect(query.sql).toContain("claimed_at <= ?");
    expect(query.sql).toContain("app_id = ?");
    expect(query.args).toContain("mail");
  });

  it("can skip a trigger whose next queued event is stale", async () => {
    executeMock.mockResolvedValueOnce({ rows: [{ trigger_id: "resource-z" }] });

    await listReadyAutomationTriggerIds(
      "mail",
      100,
      {},
      {
        timeoutMs: 5_000,
        excludeStaleEventBefore: {
          eventName: "mail.message.received",
          emittedBefore: "2026-09-27T10:00:00.000Z",
        },
      },
    );

    const query = executeMock.mock.calls[0]?.[0] as {
      args: unknown[];
      maxAttempts?: number;
      sql: string;
    };
    expect(query.sql).toContain("WITH ready AS (");
    expect(query.sql).toContain("stale.sequence_id");
    expect(query.sql).toContain("earlier.sequence_id < stale.sequence_id");
    expect(query.args).toEqual(
      expect.arrayContaining([
        "mail.message.received",
        "2026-09-27T10:00:00.000Z",
      ]),
    );
    expect(query.maxAttempts).toBe(1);
  });

  it("bounds ready-trigger pages and keysets past the durable cursor", async () => {
    const triggerIds = Array.from({ length: 100 }, (_, index) => ({
      trigger_id: `resource-${index}`,
    }));
    executeMock.mockResolvedValueOnce({ rows: triggerIds });

    await expect(listReadyAutomationTriggerIds("mail")).resolves.toHaveLength(
      100,
    );

    const query = executeMock.mock.calls[0]?.[0] as {
      args: unknown[];
      sql: string;
    };
    expect(query.sql).toContain("ORDER BY trigger_id ASC");
    expect(query.sql).toContain("LIMIT ?");
    expect(query.args.at(-1)).toBe(100);

    executeMock.mockResolvedValueOnce({ rows: [{ trigger_id: "resource-z" }] });
    await listReadyAutomationTriggerIds("mail", 100, {
      afterTriggerId: "resource-m",
      throughTriggerId: "resource-z",
    });
    const nextPage = executeMock.mock.calls[1]?.[0] as {
      args: unknown[];
      sql: string;
    };
    expect(nextPage.sql).toContain("trigger_id > ?");
    expect(nextPage.sql).toContain("trigger_id <= ?");
    expect(nextPage.args).toEqual(
      expect.arrayContaining(["resource-m", "resource-z"]),
    );
  });

  it("adds an index for bounded stale-event expiration", () => {
    const staleIndexMigration = AUTOMATION_TRIGGER_EVENT_MIGRATIONS.find(
      ({ name }) => name === "automation-trigger-event-stale-mail-index",
    );
    expect(staleIndexMigration).toMatchObject({
      version: 3,
      name: "automation-trigger-event-stale-mail-index",
    });
    expect(staleIndexMigration?.sql).toContain(
      "ON automation_trigger_event_queue (app_id, event_name, emitted_at)",
    );
  });

  it("adds a partial index for active FIFO heads", () => {
    const activeHeadIndexMigration = AUTOMATION_TRIGGER_EVENT_MIGRATIONS.find(
      ({ name }) => name === "automation-trigger-event-active-head-index",
    );
    expect(activeHeadIndexMigration).toMatchObject({
      version: 5,
      name: "automation-trigger-event-active-head-index",
    });
    expect(activeHeadIndexMigration?.sql).toContain(
      "ON automation_trigger_event_queue (app_id, trigger_id, sequence_id)",
    );
    expect(activeHeadIndexMigration?.sql).toContain(
      "WHERE status IN ('pending', 'processing')",
    );
  });

  it("persists the fair sweep cursor across cold invocations", async () => {
    executeMock.mockResolvedValueOnce({
      rows: [{ last_trigger_id: "resource-m" }],
    });
    await expect(getAutomationTriggerSweepCursor("mail")).resolves.toBe(
      "resource-m",
    );

    await setAutomationTriggerSweepCursor("mail", "resource-z");
    const update = executeMock.mock.calls[1]?.[0] as {
      args: unknown[];
      sql: string;
    };
    expect(update.sql).toContain("ON CONFLICT (scope_key) DO UPDATE");
    expect(update.sql).toContain("last_trigger_id = excluded.last_trigger_id");
    expect(update.args).toEqual(["mail", "resource-z", expect.any(Number)]);
  });

  it("reserves queue cleanup durably with a one-minute retry after a failure", async () => {
    executeMock.mockResolvedValueOnce({ rows: [{ scope_key: "mail" }] });
    await expect(
      reserveAutomationTriggerEventPurge("mail", 1_000),
    ).resolves.toBe(true);
    const claim = executeMock.mock.calls[0]?.[0] as {
      args: unknown[];
      sql: string;
    };
    expect(claim.sql).toContain("purge_after <= ?");
    expect(claim.sql).toContain("RETURNING scope_key");
    expect(claim.args).toEqual(["mail", 61_000, 1_000, 1_000]);

    await scheduleAutomationTriggerEventPurge("mail", 86_401_000);
    const schedule = executeMock.mock.calls[1]?.[0] as {
      args: unknown[];
      sql: string;
    };
    expect(schedule.sql).toContain("SET purge_after = ?, updated_at = ?");
    expect(schedule.args).toEqual([86_401_000, expect.any(Number), "mail"]);
  });

  it("scrubs a completed event payload and retains its dedupe row", async () => {
    await completeAutomationTriggerEvent("queue-1", 1234, 1, {
      timeoutMs: 5_000,
    });

    const update = executeMock.mock.calls[0]?.[0] as {
      args: unknown[];
      maxAttempts?: number;
      sql: string;
      timeoutMs?: number;
    };
    expect(update.sql).toContain("SET status = 'completed'");
    expect(update.sql).toContain("payload = ?");
    expect(update.sql).toContain("completed_at = ?");
    expect(update.sql).toContain("claimed_at = ? AND attempts = ?");
    expect(update.sql).not.toContain("DELETE");
    expect(update.sql).not.toContain("event_id =");
    expect(update.timeoutMs).toBe(5_000);
    expect(update.maxAttempts).toBe(1);
    expect(update.args).toEqual([
      '{"kind":"completed"}',
      expect.any(Number),
      "queue-1",
      1234,
      1,
    ]);
  });

  it("expires stale pending events in bounded, lock-safe batches", async () => {
    executeMock.mockResolvedValueOnce({ rows: [], rowsAffected: 17 });
    const input = {
      appId: "mail",
      eventName: "mail.message.received",
      emittedBefore: "2026-09-28T10:00:00.000Z",
      reason: "Expired stale mail event.",
      limit: AUTOMATION_TRIGGER_EVENT_EXPIRY_BATCH_SIZE,
    };

    await expect(expireStaleAutomationTriggerEvents(input)).resolves.toBe(17);

    const query = executeMock.mock.calls[0]?.[0] as {
      args: unknown[];
      sql: string;
    };
    expect(query.sql).toContain("event_name = ? AND status = 'pending'");
    expect(query.sql).toContain("emitted_at < ?");
    expect(query.sql).toContain("ORDER BY emitted_at ASC");
    expect(query.sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(query.sql).toContain("SET status = 'completed'");
    expect(query.sql).toContain("last_error = ?");
    expect(query.args).toEqual([
      input.appId,
      input.eventName,
      input.emittedBefore,
      input.limit,
      '{"kind":"completed"}',
      expect.any(Number),
      input.reason,
    ]);
  });

  it("expires a reclaimed stale event only while its claim is current", async () => {
    await expireAutomationTriggerEvent(
      "queue-1",
      1234,
      2,
      "Expired stale mail event.",
      { timeoutMs: 5_000 },
    );

    const query = executeMock.mock.calls[0]?.[0] as {
      args: unknown[];
      maxAttempts?: number;
      sql: string;
      timeoutMs?: number;
    };
    expect(query.sql).toContain("SET status = 'completed'");
    expect(query.sql).toContain("last_error = ?");
    expect(query.sql).toContain("claimed_at = ? AND attempts = ?");
    expect(query.timeoutMs).toBe(5_000);
    expect(query.maxAttempts).toBe(1);
    expect(query.args).toEqual([
      '{"kind":"completed"}',
      expect.any(Number),
      "Expired stale mail event.",
      "queue-1",
      1234,
      2,
    ]);
  });

  it("purges completed dedupe rows in bounded batches after seven days", async () => {
    const now = Date.UTC(2026, 8, 27);
    executeMock.mockResolvedValueOnce({ rows: [], rowsAffected: 17 });

    await expect(purgeExpiredAutomationTriggerEvents(now)).resolves.toBe(17);

    const query = executeMock.mock.calls[0]?.[0] as {
      args: unknown[];
      sql: string;
    };
    expect(query.sql).toContain(
      "status IN ('completed', 'failed') AND completed_at < ?",
    );
    expect(query.sql).toContain("ORDER BY completed_at ASC");
    expect(query.sql).toContain("LIMIT ?");
    expect(query.args).toEqual([
      now - AUTOMATION_TRIGGER_EVENT_DEDUPE_RETENTION_MS,
      AUTOMATION_TRIGGER_EVENT_PURGE_BATCH_SIZE,
    ]);
  });
});
