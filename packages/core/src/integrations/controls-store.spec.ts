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

const db = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
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
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => db,
  intType: () => "INTEGER",
  isPostgres: () => false,
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
  db.execute.mockClear();
  sqlite.exec("DELETE FROM integration_controls");
});

afterAll(() => {
  sqlite.close();
});

describe("integration action controls", () => {
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
