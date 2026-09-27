import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());
const ensureIndexExistsMock = vi.hoisted(() => vi.fn(async () => true));
const ensureTableExistsMock = vi.hoisted(() => vi.fn(async () => true));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
}));
vi.mock("../db/ddl-guard.js", () => ({
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
  claimNextAutomationTriggerEvent,
  completeAutomationTriggerEvent,
  enqueueAutomationTriggerEvent,
  listReadyAutomationTriggerIds,
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

  it("leaves busy or failed events pending with a retry time and error", async () => {
    await retryAutomationTriggerEvent(
      "queue-1",
      2,
      new Error("automation is running"),
      5_000,
    );

    const update = executeMock.mock.calls[0]?.[0] as {
      args: unknown[];
      sql: string;
    };
    expect(update.sql).toContain("SET status = 'pending'");
    expect(update.sql).toContain("claimed_at = NULL");
    expect(update.sql).toContain("available_at = ?");
    expect(update.sql).not.toContain("payload");
    expect(update.args[1]).toBe("automation is running");
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
    await completeAutomationTriggerEvent("queue-1");

    const update = executeMock.mock.calls[0]?.[0] as {
      args: unknown[];
      sql: string;
    };
    expect(update.sql).toContain("SET status = 'completed'");
    expect(update.sql).toContain("payload = ?");
    expect(update.sql).toContain("completed_at = ?");
    expect(update.sql).not.toContain("DELETE");
    expect(update.sql).not.toContain("event_id =");
    expect(update.args).toEqual([
      '{"kind":"completed"}',
      expect.any(Number),
      "queue-1",
    ]);
  });
});
