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
  AUTOMATION_TRIGGER_EVENT_DEDUPE_RETENTION_MS,
  AUTOMATION_TRIGGER_EVENT_PURGE_BATCH_SIZE,
  MAX_AUTOMATION_TRIGGER_EVENT_FAILURES,
  claimNextAutomationTriggerEvent,
  completeAutomationTriggerEvent,
  enqueueAutomationTriggerEvent,
  failAutomationTriggerEvent,
  listReadyAutomationTriggerIds,
  purgeExpiredAutomationTriggerEvents,
  retryAutomationTriggerEvent,
} from "./event-queue.js";

describe("automation trigger event queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({ rows: [], rowsAffected: 1 });
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
    expect(update.sql).toContain("ORDER BY candidate.sequence_id ASC");
    expect(update.sql).toContain("earlier.status IN ('pending', 'processing')");
    expect(update.sql).toContain("candidate.status = 'processing'");
    expect(update.sql).toContain("RETURNING claimed.id");
    expect(update.args).toContain("mail");
  });

  it("defers busy events without consuming a failure attempt", async () => {
    await retryAutomationTriggerEvent(
      "queue-1",
      1234,
      2,
      1,
      new Error("automation is running"),
      { delayMs: 5_000, countFailure: false },
    );

    const update = executeMock.mock.calls[0]?.[0] as {
      args: unknown[];
      sql: string;
    };
    expect(update.sql).toContain("SET status = 'pending'");
    expect(update.sql).toContain("claimed_at = NULL");
    expect(update.sql).toContain("available_at = ?");
    expect(update.sql).toContain("failure_attempts = failure_attempts + ?");
    expect(update.sql).toContain(
      "claimed_at = ? AND attempts = ? AND failure_attempts = ?",
    );
    expect(update.sql).not.toContain("payload");
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
    );

    const update = executeMock.mock.calls[0]?.[0] as {
      args: unknown[];
      sql: string;
    };
    expect(update.sql).toContain("SET status = 'failed'");
    expect(update.sql).toContain("payload = ?");
    expect(update.sql).toContain("completed_at = ?");
    expect(update.sql).toContain("failure_attempts = failure_attempts + 1");
    expect(update.sql).toContain(
      "claimed_at = ? AND attempts = ? AND failure_attempts = ?",
    );
    expect(update.args).toEqual([
      '{"kind":"completed"}',
      expect.any(Number),
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

  it("scrubs a completed event payload and retains its dedupe row", async () => {
    await completeAutomationTriggerEvent("queue-1", 1234, 1);

    const update = executeMock.mock.calls[0]?.[0] as {
      args: unknown[];
      sql: string;
    };
    expect(update.sql).toContain("SET status = 'completed'");
    expect(update.sql).toContain("payload = ?");
    expect(update.sql).toContain("completed_at = ?");
    expect(update.sql).toContain("claimed_at = ? AND attempts = ?");
    expect(update.sql).not.toContain("DELETE");
    expect(update.sql).not.toContain("event_id =");
    expect(update.args).toEqual([
      '{"kind":"completed"}',
      expect.any(Number),
      "queue-1",
      1234,
      1,
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
