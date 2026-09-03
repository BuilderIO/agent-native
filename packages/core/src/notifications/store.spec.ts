import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Real in-memory sqlite behind the raw getDbExec client. This lets the
// owner-scoping invariants (you cannot mark/delete another owner's
// notification) be tested for real rather than by inspecting captured SQL.
let sqlite: Database.Database;

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      sqlite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = sqlite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql)) {
      return { rows: stmt.all(...args), rowsAffected: 0 };
    }
    const info = stmt.run(...args);
    return { rows: [], rowsAffected: info.changes };
  }),
};

const recordChange = vi.fn();

vi.mock("../db/client.js", () => ({
  getDbExec: () => rawClient,
  intType: () => "INTEGER",
  isPostgres: () => false,
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
} = await import("./store.js");

const ALICE = "alice@example.com";
const BOB = "bob@example.com";

// Seed a row with an explicit created_at so ordering/cursor tests are
// deterministic (the store stamps Date.now() which collides under fast loops).
function seedRow(opts: {
  id: string;
  owner: string;
  title: string;
  createdAt: number;
  readAt?: number | null;
}) {
  sqlite
    .prepare(
      `INSERT INTO notifications
        (id, owner, severity, title, body, metadata, delivered_channels, created_at, read_at)
       VALUES (?, ?, 'info', ?, NULL, NULL, '["inbox"]', ?, ?)`,
    )
    .run(opts.id, opts.owner, opts.title, opts.createdAt, opts.readAt ?? null);
}

beforeEach(() => {
  sqlite = new Database(":memory:");
  // The store caches CREATE TABLE in a module-level _initPromise; create the
  // table per fresh DB ourselves so each test starts clean.
  sqlite.exec(`CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    metadata TEXT,
    delivered_channels TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    read_at INTEGER
  )`);
});

afterEach(() => {
  sqlite.close();
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

    // Round-trips through list (metadata deserialized, createdAt ISO).
    const [listed] = await listNotifications(ALICE);
    expect(listed.metadata).toEqual({ url: "/settings", code: 42 });
    expect(listed.body).toBe("Only 2% free");
    expect(listed.deliveredChannels).toEqual(["inbox"]);
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

  beforeEach(() => {
    // Three Alice notifications at distinct timestamps; one Bob notification.
    seedRow({ id: "a1", owner: ALICE, title: "A1", createdAt: T1 });
    seedRow({ id: "a2", owner: ALICE, title: "A2", createdAt: T2 });
    seedRow({ id: "a3", owner: ALICE, title: "A3", createdAt: T3 });
    seedRow({ id: "b1", owner: BOB, title: "B1", createdAt: T2 });
  });

  it("scopes to the owner and orders newest-first", async () => {
    const rows = await listNotifications(ALICE);
    expect(rows.map((r) => r.title)).toEqual(["A3", "A2", "A1"]);
    // Bob's notification never appears in Alice's list.
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
    // Only A1 is strictly older than A2.
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
    // Bob's count is independent.
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

    // Already read → no rows affected, returns false, no extra poll bump.
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
    // Alice's notification is still unread.
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
    // Bob is untouched.
    await expect(countUnread(BOB)).resolves.toBe(1);

    // No unread left → returns 0 and does not bump poll.
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
    // Still present for Alice.
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
