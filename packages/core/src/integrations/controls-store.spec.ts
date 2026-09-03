import Database from "better-sqlite3";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

let sqlite: Database.Database;

async function executeSqlite(
  input: string | { sql: string; args?: unknown[] },
) {
  if (typeof input === "string") {
    sqlite.exec(input);
    return { rows: [], rowsAffected: 0 };
  }
  const statement = sqlite.prepare(input.sql);
  const args = input.args ?? [];
  if (statement.reader) {
    return { rows: statement.all(...args), rowsAffected: 0 };
  }
  const result = statement.run(...args);
  return { rows: [], rowsAffected: result.changes };
}

const db = {
  execute: vi.fn(executeSqlite),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => db,
  intType: () => "INTEGER",
  isPostgres: () => false,
}));

vi.mock("../db/migrations.js", () => ({
  isDuplicateColumnError: (error: unknown) =>
    /duplicate column name|column .* already exists/i.test(
      String((error as { message?: unknown })?.message ?? ""),
    ),
}));

const controls = await import("./controls-store.js");

const incoming = {
  platform: "slack",
  externalThreadId: "A123:T123:C123:111.222",
  text: "deploy",
  senderId: "U123",
  tenantId: "T123",
  timestamp: 1,
  platformContext: {
    apiAppId: "A123",
    channelId: "C123",
    threadTs: "111.222",
  },
};

beforeAll(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE integration_controls (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    org_id TEXT,
    requester_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_ts TEXT NOT NULL,
    run_id TEXT,
    approval_key TEXT,
    incoming_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    claimed_at INTEGER
  )`);
});

beforeEach(() => {
  controls._resetIntegrationControlsStoreForTests();
  db.execute.mockReset();
  db.execute.mockImplementation(executeSqlite);
  sqlite.exec("DELETE FROM integration_controls");
});

afterAll(() => {
  sqlite.close();
});

describe("integration action controls", () => {
  it("adds the api_app_id column to a legacy SQLite table", async () => {
    await controls.createIntegrationControl({
      action: "approve",
      ownerEmail: "owner@example.com",
      requesterId: "U123",
      teamId: "T123",
      apiAppId: "A123",
      channelId: "C123",
      messageTs: "999.000",
      incoming,
    });

    const columns = sqlite
      .prepare("PRAGMA table_info(integration_controls)")
      .all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain("api_app_id");
  });

  it("ignores only an already-existing api_app_id column", async () => {
    await expect(
      controls.createIntegrationControl({
        action: "approve",
        ownerEmail: "owner@example.com",
        requesterId: "U123",
        teamId: "T123",
        channelId: "C123",
        messageTs: "999.000",
        incoming,
      }),
    ).resolves.toMatch(/^ctl_/);
  });

  it("rethrows SQLite migration failures unrelated to duplicate columns", async () => {
    const migrationError = new Error("database is locked");
    db.execute.mockImplementation(async (input) => {
      const sql = typeof input === "string" ? input : input.sql;
      if (sql.includes("ALTER TABLE integration_controls ADD COLUMN")) {
        throw migrationError;
      }
      return executeSqlite(input);
    });

    await expect(
      controls.createIntegrationControl({
        action: "approve",
        ownerEmail: "owner@example.com",
        requesterId: "U123",
        teamId: "T123",
        channelId: "C123",
        messageTs: "999.000",
        incoming,
      }),
    ).rejects.toThrow("database is locked");
  });

  it("creates an opaque value and atomically rejects replay", async () => {
    const id = await controls.createIntegrationControl({
      action: "approve",
      ownerEmail: "OWNER@example.com",
      orgId: "org-1",
      requesterId: "U123",
      teamId: "T123",
      channelId: "C123",
      messageTs: "999.000",
      runId: "run-1",
      approvalKey: "approval-secret",
      incoming,
    });

    expect(id).toMatch(/^ctl_[a-f0-9]{32}$/);
    expect(id).not.toContain("approval-secret");
    expect(id).not.toContain("U123");

    const claimed = await controls.claimIntegrationControl({
      id,
      action: "approve",
      requesterId: "U123",
      teamId: "T123",
      channelId: "C123",
      messageTs: "999.000",
    });
    expect(claimed).toMatchObject({
      id,
      status: "claimed",
      ownerEmail: "owner@example.com",
      runId: "run-1",
      approvalKey: "approval-secret",
      incoming,
    });

    await expect(
      controls.claimIntegrationControl({
        id,
        action: "approve",
        requesterId: "U123",
        teamId: "T123",
        channelId: "C123",
        messageTs: "999.000",
      }),
    ).resolves.toBeNull();
  });

  it("binds a control to its action, requester, workspace, channel, and message", async () => {
    const id = await controls.createIntegrationControl({
      action: "cancel",
      ownerEmail: "owner@example.com",
      requesterId: "U123",
      teamId: "T123",
      channelId: "C123",
      messageTs: "999.000",
      runId: "run-1",
      incoming,
    });

    for (const mismatch of [
      { action: "approve" },
      { requesterId: "U999" },
      { teamId: "T999" },
      { channelId: "C999" },
      { messageTs: "888.000" },
    ] as const) {
      await expect(
        controls.claimIntegrationControl({
          id,
          action: "cancel",
          requesterId: "U123",
          teamId: "T123",
          channelId: "C123",
          messageTs: "999.000",
          ...mismatch,
        }),
      ).resolves.toBeNull();
    }

    await expect(
      controls.claimIntegrationControl({
        id,
        action: "cancel",
        requesterId: "U123",
        teamId: "T123",
        channelId: "C123",
        messageTs: "999.000",
      }),
    ).resolves.toMatchObject({ id, action: "cancel" });
  });

  it("fails closed after the control expires", async () => {
    const id = await controls.createIntegrationControl({
      action: "deny",
      ownerEmail: "owner@example.com",
      requesterId: "U123",
      teamId: "T123",
      channelId: "C123",
      messageTs: "999.000",
      incoming,
      ttlMs: -1,
    });

    await expect(
      controls.claimIntegrationControl({
        id,
        action: "deny",
        requesterId: "U123",
        teamId: "T123",
        channelId: "C123",
        messageTs: "999.000",
      }),
    ).resolves.toBeNull();
  });
});
