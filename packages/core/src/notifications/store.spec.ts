import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      await pglite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = await pglite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql)) {
      return { rows: await stmt.all(...args), rowsAffected: 0 };
    }
    const info = await stmt.run(...args);
    return { rows: [], rowsAffected: info.changes };
  }),
};

const recordChange = vi.fn();

vi.mock("../db/client.js", () => ({
  getDbExec: () => rawClient,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
  safeJsonParse: (value: unknown, fallback: unknown) => {
    if (value == null) return fallback;
    try {
      return JSON.parse(String(value));
    } catch {
      return fallback;
    }
  },
}));

vi.mock("../server/poll.js", () => ({
  recordChange: (...args: unknown[]) => recordChange(...args),
}));

const {
  insertNotification,
  listNotifications,
  countUnread,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  updateDeliveredChannels,
  addDeliveredChannel,
  claimNotificationDelivery,
  markNotificationDeliveryDispatching,
  markNotificationDeliveryUncertain,
  completeNotificationDelivery,
  listCompletedNotificationChannels,
  notificationIdForIdempotencyKey,
  releaseNotificationDelivery,
} = await import("./store.js");

const ALICE = "alice@example.com";
const BOB = "bob@example.com";

async function seedRow(opts: {
  id: string;
  owner: string;
  title: string;
  createdAt: number;
  readAt?: number | null;
}) {
  await pglite
    .prepare(
      `INSERT INTO notifications
        (id, owner, severity, title, body, metadata, delivered_channels, created_at, read_at)
       VALUES (?, ?, 'info', ?, NULL, NULL, '["inbox"]', ?, ?)`,
    )
    .run(opts.id, opts.owner, opts.title, opts.createdAt, opts.readAt ?? null);
}

beforeEach(async () => {
  pglite = await createTestPglite();
  await pglite.exec(`CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    metadata TEXT,
    delivered_channels TEXT NOT NULL DEFAULT '[]',
    created_at BIGINT NOT NULL,
    read_at BIGINT
  )`);
  await pglite.exec(`CREATE TABLE IF NOT EXISTS notification_delivery_state (
    notification_id TEXT NOT NULL,
    delivery_key TEXT NOT NULL,
    state TEXT NOT NULL,
    claim_token TEXT,
    lease_expires_at BIGINT NOT NULL,
    completed_at BIGINT,
    PRIMARY KEY (notification_id, delivery_key)
  )`);
});

afterEach(async () => {
  await pglite.close();
  vi.clearAllMocks();
});

describe("insertNotification", () => {
  it("returns the shaped notification, persists JSON metadata, and bumps poll", async () => {
    const n = await insertNotification({
      owner: ALICE,
      severity: "warning",
      title: "Disk low",
      body: "Only 2% free",
      metadata: { url: "/settings", code: 42 },
      deliveredChannels: ["inbox"],
    });

    expect(n).toMatchObject({
      owner: ALICE,
      severity: "warning",
      title: "Disk low",
      body: "Only 2% free",
      metadata: { url: "/settings", code: 42 },
      deliveredChannels: ["inbox"],
      readAt: null,
    });
    expect(n.id).toBeTruthy();
    expect(typeof n.createdAt).toBe("string");
    expect(recordChange).toHaveBeenCalledWith({
      source: "notifications",
      type: "change",
      key: ALICE,
    });

    const [listed] = await listNotifications(ALICE);
    expect(listed.metadata).toEqual({ url: "/settings", code: 42 });
    expect(listed.body).toBe("Only 2% free");
    expect(listed.deliveredChannels).toEqual(["inbox"]);
  });

  it("returns the existing inbox row for a repeated idempotency key", async () => {
    const first = await insertNotification({
      owner: ALICE,
      severity: "info",
      title: "Mail arrived",
      metadata: { messageId: "message-1" },
      idempotencyKey: "mail-rule:rule-1:mailbox@example.com:message-1",
    });
    const second = await insertNotification({
      owner: ALICE,
      severity: "info",
      title: "Mail arrived after retry",
      metadata: { messageId: "message-1" },
      idempotencyKey: "mail-rule:rule-1:mailbox@example.com:message-1",
    });

    expect(second).toEqual(first);
    expect(await listNotifications(ALICE)).toHaveLength(1);
    expect(recordChange).toHaveBeenCalledTimes(1);
  });

  it("stores null body/metadata cleanly and defaults delivered channels", async () => {
    const n = await insertNotification({
      owner: ALICE,
      severity: "info",
      title: "No extras",
    });
    expect(n.deliveredChannels).toEqual([]);

    const [listed] = await listNotifications(ALICE);
    expect(listed.body).toBeUndefined();
    expect(listed.metadata).toBeUndefined();
    expect(listed.deliveredChannels).toEqual([]);
  });
});

describe("listNotifications", () => {
  const T1 = 1_700_000_000_000;
  const T2 = T1 + 1000;
  const T3 = T1 + 2000;

  beforeEach(async () => {
    await seedRow({ id: "a1", owner: ALICE, title: "A1", createdAt: T1 });
    await seedRow({ id: "a2", owner: ALICE, title: "A2", createdAt: T2 });
    await seedRow({ id: "a3", owner: ALICE, title: "A3", createdAt: T3 });
    await seedRow({ id: "b1", owner: BOB, title: "B1", createdAt: T2 });
  });

  it("scopes to the owner and orders newest-first", async () => {
    const rows = await listNotifications(ALICE);
    expect(rows.map((r) => r.title)).toEqual(["A3", "A2", "A1"]);
    expect(rows.some((r) => r.title === "B1")).toBe(false);
  });

  it("unreadOnly excludes already-read notifications", async () => {
    await markNotificationRead("a2", ALICE);

    const unread = await listNotifications(ALICE, { unreadOnly: true });
    expect(unread.map((r) => r.title)).toEqual(["A3", "A1"]);
  });

  it("before cursor returns only notifications older than the cursor", async () => {
    const older = await listNotifications(ALICE, {
      before: new Date(T2).toISOString(),
    });
    expect(older.map((r) => r.title)).toEqual(["A1"]);
  });

  it("clamps an over-large limit to 200 and a non-positive limit to the default", async () => {
    await listNotifications(ALICE, { limit: 9999 });
    const big = rawClient.execute.mock.calls.at(-1)![0] as { args: unknown[] };
    expect(big.args.at(-1)).toBe(200);

    await listNotifications(ALICE, { limit: -3 });
    const neg = rawClient.execute.mock.calls.at(-1)![0] as { args: unknown[] };
    expect(neg.args.at(-1)).toBe(50);
  });
});

describe("countUnread", () => {
  it("counts only the owner's unread rows", async () => {
    await insertNotification({ owner: ALICE, severity: "info", title: "A1" });
    const a2 = await insertNotification({
      owner: ALICE,
      severity: "info",
      title: "A2",
    });
    await insertNotification({ owner: BOB, severity: "info", title: "B1" });

    await expect(countUnread(ALICE)).resolves.toBe(2);
    await markNotificationRead(a2.id, ALICE);
    await expect(countUnread(ALICE)).resolves.toBe(1);
    await expect(countUnread(BOB)).resolves.toBe(1);
  });
});

describe("markNotificationRead — owner scoping", () => {
  it("marks the owner's notification read once and is a no-op the second time", async () => {
    const n = await insertNotification({
      owner: ALICE,
      severity: "info",
      title: "A1",
    });
    recordChange.mockClear();

    await expect(markNotificationRead(n.id, ALICE)).resolves.toBe(true);
    expect(recordChange).toHaveBeenCalledTimes(1);

    recordChange.mockClear();
    await expect(markNotificationRead(n.id, ALICE)).resolves.toBe(false);
    expect(recordChange).not.toHaveBeenCalled();
  });

  it("refuses to mark another owner's notification read", async () => {
    const n = await insertNotification({
      owner: ALICE,
      severity: "info",
      title: "A1",
    });

    await expect(markNotificationRead(n.id, BOB)).resolves.toBe(false);
    await expect(countUnread(ALICE)).resolves.toBe(1);
  });
});

describe("markAllNotificationsRead — owner scoping", () => {
  it("marks only the caller's unread rows and returns the count", async () => {
    await insertNotification({ owner: ALICE, severity: "info", title: "A1" });
    await insertNotification({ owner: ALICE, severity: "info", title: "A2" });
    await insertNotification({ owner: BOB, severity: "info", title: "B1" });

    await expect(markAllNotificationsRead(ALICE)).resolves.toBe(2);
    await expect(countUnread(ALICE)).resolves.toBe(0);
    await expect(countUnread(BOB)).resolves.toBe(1);

    recordChange.mockClear();
    await expect(markAllNotificationsRead(ALICE)).resolves.toBe(0);
    expect(recordChange).not.toHaveBeenCalled();
  });
});

describe("deleteNotification — owner scoping", () => {
  it("deletes the owner's notification and reports success", async () => {
    const n = await insertNotification({
      owner: ALICE,
      severity: "info",
      title: "A1",
    });
    await expect(deleteNotification(n.id, ALICE)).resolves.toBe(true);
    await expect(listNotifications(ALICE)).resolves.toEqual([]);
  });

  it("refuses to delete another owner's notification", async () => {
    const n = await insertNotification({
      owner: ALICE,
      severity: "info",
      title: "A1",
    });
    await expect(deleteNotification(n.id, BOB)).resolves.toBe(false);
    await expect(listNotifications(ALICE)).resolves.toHaveLength(1);
  });
});

describe("updateDeliveredChannels", () => {
  it("overwrites the delivered-channel list as JSON", async () => {
    const n = await insertNotification({
      owner: ALICE,
      severity: "info",
      title: "A1",
      deliveredChannels: ["inbox"],
    });
    await updateDeliveredChannels(n.id, ["inbox", "webhook", "slack"]);
    const [listed] = await listNotifications(ALICE);
    expect(listed.deliveredChannels).toEqual(["inbox", "webhook", "slack"]);
  });
});

describe("notification delivery receipts", () => {
  it("allows only one live claimant and persists per-channel completion", async () => {
    const claims = await Promise.all([
      claimNotificationDelivery("n-1", "slack"),
      claimNotificationDelivery("n-1", "slack"),
    ]);
    const claim = claims.find((token) => token !== undefined);

    expect(claims.filter((token) => token !== undefined)).toHaveLength(1);
    expect(claim).toBeTruthy();

    await markNotificationDeliveryDispatching("n-1", "slack", claim!);
    await completeNotificationDelivery("n-1", "slack", claim!);
    await expect(claimNotificationDelivery("n-1", "slack")).resolves.toBe(
      undefined,
    );
    await expect(listCompletedNotificationChannels("n-1")).resolves.toEqual([
      "slack",
    ]);
  });

  it("releases an unsuccessful attempt so a later retry can claim it", async () => {
    const first = await claimNotificationDelivery("n-1", "webhook");
    await markNotificationDeliveryDispatching("n-1", "webhook", first!);
    await releaseNotificationDelivery("n-1", "webhook", first!);

    const retry = await claimNotificationDelivery("n-1", "webhook");
    expect(retry).toBeTruthy();
    expect(retry).not.toBe(first);
  });

  it("does not reclaim a dispatching delivery after its pending lease expires", async () => {
    const initialTime = 1_700_000_000_000;
    const now = vi.spyOn(Date, "now").mockReturnValue(initialTime);
    try {
      const claim = await claimNotificationDelivery("n-1", "slow-webhook");
      await markNotificationDeliveryDispatching("n-1", "slow-webhook", claim!);

      now.mockReturnValue(initialTime + 2 * 60 * 1000 + 1);
      await expect(
        claimNotificationDelivery("n-1", "slow-webhook"),
      ).resolves.toBeUndefined();

      const { rows } = await rawClient.execute({
        sql: `SELECT state FROM notification_delivery_state
          WHERE notification_id = ? AND delivery_key = ? LIMIT 1`,
        args: ["n-1", "channel:slow-webhook"],
      });
      expect(rows[0]?.state).toBe("dispatching");
    } finally {
      now.mockRestore();
    }
  });

  it("keeps an uncertain delivery suppressed on later retries", async () => {
    const claim = await claimNotificationDelivery("n-1", "ambiguous-webhook");
    await markNotificationDeliveryDispatching(
      "n-1",
      "ambiguous-webhook",
      claim!,
    );
    await markNotificationDeliveryUncertain("n-1", "ambiguous-webhook", claim!);

    await expect(
      claimNotificationDelivery("n-1", "ambiguous-webhook"),
    ).resolves.toBeUndefined();
  });

  it("tracks the sent event separately from channel completion", async () => {
    const claim = await claimNotificationDelivery(
      "n-1",
      "notification.sent",
      "event",
    );
    expect(claim).toBeTruthy();

    await markNotificationDeliveryDispatching(
      "n-1",
      "notification.sent",
      claim!,
      "event",
    );
    await completeNotificationDelivery(
      "n-1",
      "notification.sent",
      claim!,
      "event",
    );

    await expect(listCompletedNotificationChannels("n-1")).resolves.toEqual([]);
    await expect(
      claimNotificationDelivery("n-1", "notification.sent", "event"),
    ).resolves.toBeUndefined();
  });

  it("derives a stable private notification id from owner and idempotency key", () => {
    expect(
      notificationIdForIdempotencyKey(ALICE, "mail-rule:1:message-1"),
    ).toMatch(/^idem_[a-f0-9]{64}$/);
    expect(
      notificationIdForIdempotencyKey(ALICE, "mail-rule:1:message-1"),
    ).toBe(notificationIdForIdempotencyKey(ALICE, "mail-rule:1:message-1"));
    expect(
      notificationIdForIdempotencyKey(ALICE, "mail-rule:1:message-1"),
    ).not.toBe(notificationIdForIdempotencyKey(BOB, "mail-rule:1:message-1"));
  });

  it("adds a delivered channel without duplicating the stored list", async () => {
    const notification = await insertNotification({
      owner: ALICE,
      severity: "info",
      title: "A1",
      deliveredChannels: ["inbox"],
    });

    await addDeliveredChannel(notification.id, "slack");
    await addDeliveredChannel(notification.id, "slack");

    const [listed] = await listNotifications(ALICE);
    expect(listed.deliveredChannels).toEqual(["inbox", "slack"]);
  });
});
