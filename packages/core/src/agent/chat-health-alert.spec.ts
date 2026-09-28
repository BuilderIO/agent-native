import { beforeEach, describe, expect, it, vi } from "vitest";

let turnRows: Array<Record<string, unknown>> = [];
let memberRows: Array<Record<string, unknown>> = [];
let staleA2aTasks = 0;
let a2aTableExists = true;
let turnQueryThrows = false;
let a2aQueryThrows = false;
let memberQueryThrows = false;
let deleteClaimThrows = false;
const ensureA2ATable = vi.hoisted(() => vi.fn(async () => {}));

const execute = vi.fn(async ({ sql }: { sql: string; args?: unknown[] }) => {
  if (sql.includes("org_members")) {
    if (memberQueryThrows) throw new Error("member lookup failed");
    const rows = sql.includes("role IN ('owner', 'admin')")
      ? memberRows.filter((row) => row.role === "owner" || row.role === "admin")
      : memberRows;
    return { rows, rowsAffected: 0 };
  }
  if (sql.includes("to_regclass('a2a_tasks')")) {
    return {
      rows: [{ relation: a2aTableExists ? "a2a_tasks" : null }],
      rowsAffected: 0,
    };
  }
  if (sql.includes("FROM a2a_tasks")) {
    if (a2aQueryThrows) throw new Error("A2A task ledger unreadable");
    return { rows: [{ stale_tasks: staleA2aTasks }], rowsAffected: 0 };
  }
  if (turnQueryThrows) throw new Error("ledger unreadable");
  return { rows: turnRows, rowsAffected: 0 };
});

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute }),
}));

vi.mock("../a2a/task-store.js", () => ({ ensureTable: ensureA2ATable }));

const settings = new Map<string, Record<string, unknown>>();
let settingsReadThrows = false;
let settingsWriteThrows = false;
const mutateSetting = vi.fn(
  async (
    key: string,
    updater: (
      current: Record<string, unknown> | null,
    ) => Record<string, unknown> | Promise<Record<string, unknown>>,
  ) => {
    if (settingsReadThrows) throw new Error("settings unreadable");
    const current = settings.get(key) ?? null;
    if (settingsWriteThrows && current?.claimId) {
      throw new Error("settings write failed");
    }
    const next = await updater(current);
    settings.set(key, next);
    return next;
  },
);
const deleteSettingIfValue = vi.fn(
  async (key: string, expected: Record<string, unknown>) => {
    if (deleteClaimThrows) throw new Error("claim release failed");
    const current = settings.get(key);
    if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
    settings.delete(key);
    return true;
  },
);
vi.mock("../settings/store.js", () => ({
  deleteSettingIfValue,
  mutateSetting,
}));

const notifyWithDelivery = vi.fn(async () => ({
  notification: undefined,
  deliveredChannels: ["slack"],
}));
vi.mock("../notifications/registry.js", () => ({ notifyWithDelivery }));

const { checkChatHealthAndAlert } = await import("./chat-health-alert.js");

const NOW = 1_800_000_000_000;

function turns(total: number, bad: number) {
  turnRows = [{ turns: total, bad }];
}

beforeEach(() => {
  turnRows = [];
  memberRows = [{ org_id: "org-1", email: "owner@example.com", role: "owner" }];
  staleA2aTasks = 0;
  a2aTableExists = true;
  turnQueryThrows = false;
  a2aQueryThrows = false;
  ensureA2ATable.mockClear();
  memberQueryThrows = false;
  deleteClaimThrows = false;
  settings.clear();
  settingsReadThrows = false;
  settingsWriteThrows = false;
  notifyWithDelivery.mockClear();
  execute.mockClear();
  mutateSetting.mockClear();
  deleteSettingIfValue.mockClear();
});

describe("checkChatHealthAndAlert", () => {
  it("does not page on a tiny sample, however bad the rate", async () => {
    turns(2, 2);
    const out = await checkChatHealthAndAlert(NOW);
    expect(out).toEqual({ status: "insufficient-data", turns: 2 });
    expect(notifyWithDelivery).not.toHaveBeenCalled();
  });

  it("stays quiet while the app is answering", async () => {
    turns(20, 2);
    const out = await checkChatHealthAndAlert(NOW);
    expect(out.status).toBe("healthy");
    expect(notifyWithDelivery).not.toHaveBeenCalled();
  });

  it("pages on stale delegated A2A work even without a large turn sample", async () => {
    staleA2aTasks = 2;
    const out = await checkChatHealthAndAlert(NOW);
    expect(out).toMatchObject({
      status: "alerted",
      turns: 0,
      staleA2ATasks: 2,
      recipients: 1,
    });

    const notification = notifyWithDelivery.mock.calls[0][0];
    expect(notification).toMatchObject({
      severity: "critical",
      title: "2 stale delegated A2A tasks",
      metadata: {
        staleA2ATasks: 2,
        windowMs: 60 * 60_000,
      },
    });
    expect(notification.body).toContain(
      "2 delegated A2A tasks are past the recovery window.",
    );

    const a2aQuery = execute.mock.calls
      .map(([input]) => input)
      .find((input) => input.sql.includes("FROM a2a_tasks"));
    expect(a2aQuery?.sql).toContain(
      "status_state IN ('submitted', 'working') AND created_at <= ?",
    );
    expect(a2aQuery?.sql).toContain("updated_at <= ? OR created_at <= ?");
    expect(a2aQuery?.sql).toContain(
      "status_state IN ('submitted', 'working', 'processing')",
    );
    expect(a2aQuery?.sql).not.toContain("strpos(");
    expect(a2aQuery?.args).toEqual([
      NOW - 3 * 60_000,
      NOW - 5 * 60_000,
      NOW - 30 * 60_000,
    ]);
    expect(ensureA2ATable).toHaveBeenCalledOnce();
  });

  it("uses the same configured recovery windows as A2A task recovery", async () => {
    vi.stubEnv("A2A_QUEUED_LIFETIME_MAX_MS", "120000");
    vi.stubEnv("A2A_PROCESSING_LIFETIME_MAX_MS", "2400000");
    try {
      staleA2aTasks = 1;
      await checkChatHealthAndAlert(NOW);

      const a2aQuery = execute.mock.calls
        .map(([input]) => input)
        .find((input) => input.sql.includes("FROM a2a_tasks"));
      expect(a2aQuery?.args).toEqual([
        NOW - 120_000,
        NOW - 5 * 60_000,
        NOW - 40 * 60_000,
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("treats an app with no A2A task table as having no stale tasks", async () => {
    a2aTableExists = false;
    turns(20, 2);
    const out = await checkChatHealthAndAlert(NOW);
    expect(out).toMatchObject({ status: "healthy", turns: 20 });
    expect(notifyWithDelivery).not.toHaveBeenCalled();
    expect(ensureA2ATable).not.toHaveBeenCalled();
  });

  it("pages Slack once when the app stops answering", async () => {
    memberRows = [
      { org_id: "org-1", email: "a@example.com", role: "owner" },
      { org_id: "org-1", email: "b@example.com", role: "admin" },
    ];
    turns(20, 15);
    const out = await checkChatHealthAndAlert(NOW);
    expect(out).toMatchObject({ status: "alerted", turns: 20, recipients: 1 });
    expect(notifyWithDelivery).toHaveBeenCalledTimes(1);
    expect(notifyWithDelivery.mock.calls[0][0]).toMatchObject({
      severity: "critical",
      channels: ["slack"],
    });
    expect(notifyWithDelivery.mock.calls[0][1]).toEqual({
      owner: "a@example.com",
    });
  });

  it("fails closed when owner scope spans multiple organizations", async () => {
    memberRows = [
      { org_id: "org-1", email: "a@example.com", role: "owner" },
      { org_id: "org-2", email: "b@example.com", role: "admin" },
    ];
    turns(20, 15);
    const out = await checkChatHealthAndAlert(NOW);
    expect(out).toEqual({
      status: "delivery-failed",
      reason:
        "No single owner/admin organization scope is available for Slack health alerts.",
    });
    expect(notifyWithDelivery).not.toHaveBeenCalled();
  });

  it("ignores regular members in other organizations", async () => {
    memberRows = [
      { org_id: "org-1", email: "a@example.com", role: "owner" },
      { org_id: "org-2", email: "member@example.com", role: "member" },
    ];
    turns(20, 15);
    const out = await checkChatHealthAndAlert(NOW);
    expect(out).toMatchObject({ status: "alerted", recipients: 1 });
    expect(notifyWithDelivery).toHaveBeenCalledTimes(1);
  });

  it("releases the claim when recipient lookup fails", async () => {
    turns(20, 15);
    memberQueryThrows = true;
    const first = await checkChatHealthAndAlert(NOW);
    expect(first.status).toBe("check-failed");

    memberQueryThrows = false;
    const second = await checkChatHealthAndAlert(NOW);
    expect(second.status).toBe("alerted");
    expect(notifyWithDelivery).toHaveBeenCalledTimes(1);
  });

  it("releases the claim when no recipient is available", async () => {
    turns(20, 15);
    memberRows = [];
    const first = await checkChatHealthAndAlert(NOW);
    expect(first.status).toBe("delivery-failed");

    memberRows = [
      { org_id: "org-1", email: "owner@example.com", role: "owner" },
    ];
    const second = await checkChatHealthAndAlert(NOW);
    expect(second.status).toBe("alerted");
    expect(notifyWithDelivery).toHaveBeenCalledTimes(1);
  });

  it("pages once per outage, not once per sweep", async () => {
    turns(20, 15);
    await checkChatHealthAndAlert(NOW);
    expect(notifyWithDelivery).toHaveBeenCalledTimes(1);

    const out = await checkChatHealthAndAlert(NOW + 60_000);
    expect(out.status).toBe("cooldown");
    expect(notifyWithDelivery).toHaveBeenCalledTimes(1);
  });

  it("allows only one overlapping sweep to page", async () => {
    turns(20, 15);
    let sendStarted!: () => void;
    let releaseSend!: () => void;
    const started = new Promise<void>((resolve) => {
      sendStarted = resolve;
    });
    const send = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    notifyWithDelivery.mockImplementation(async () => {
      sendStarted();
      await send;
      return { notification: undefined, deliveredChannels: ["slack"] };
    });

    const first = checkChatHealthAndAlert(NOW);
    await started;
    const second = await checkChatHealthAndAlert(NOW);
    releaseSend();
    const firstOut = await first;

    expect(second.status).toBe("cooldown");
    expect(firstOut.status).toBe("alerted");
    expect(notifyWithDelivery).toHaveBeenCalledTimes(1);
  });

  it("pages again once the cooldown has passed", async () => {
    turns(20, 15);
    await checkChatHealthAndAlert(NOW);
    const out = await checkChatHealthAndAlert(NOW + 60 * 60_000 + 1);
    expect(out.status).toBe("alerted");
    expect(notifyWithDelivery).toHaveBeenCalledTimes(2);
  });

  it("reports a failed check as its own outcome, never as healthy", async () => {
    turnQueryThrows = true;
    const out = await checkChatHealthAndAlert(NOW);
    expect(out.status).toBe("check-failed");
    expect(out.status).not.toBe("healthy");
    expect(notifyWithDelivery).not.toHaveBeenCalled();
  });

  it("reports an unreadable A2A task ledger as a failed check", async () => {
    a2aQueryThrows = true;
    const out = await checkChatHealthAndAlert(NOW);
    expect(out).toMatchObject({
      status: "check-failed",
      reason: "Error: A2A task ledger unreadable",
    });
    expect(notifyWithDelivery).not.toHaveBeenCalled();
  });

  it("does not page when the cooldown stamp cannot be read", async () => {
    turns(20, 15);
    settingsReadThrows = true;
    const out = await checkChatHealthAndAlert(NOW);
    expect(out.status).toBe("check-failed");
    expect(notifyWithDelivery).not.toHaveBeenCalled();
  });

  it("does not stamp cooldown when Slack is not delivered", async () => {
    turns(20, 15);
    notifyWithDelivery.mockResolvedValueOnce({
      notification: undefined,
      deliveredChannels: [],
    });
    const out = await checkChatHealthAndAlert(NOW);
    expect(out.status).toBe("delivery-failed");
    expect(settings).toEqual(new Map());
    expect(deleteSettingIfValue).toHaveBeenCalledTimes(1);

    await checkChatHealthAndAlert(NOW + 60_000);
    expect(notifyWithDelivery).toHaveBeenCalledTimes(2);
  });

  it("retries after a failed claim release once its short lease expires", async () => {
    turns(20, 15);
    deleteClaimThrows = true;
    notifyWithDelivery.mockResolvedValueOnce({
      notification: undefined,
      deliveredChannels: [],
    });
    const first = await checkChatHealthAndAlert(NOW);
    expect(first.status).toBe("delivery-failed");

    deleteClaimThrows = false;
    const second = await checkChatHealthAndAlert(NOW + 5 * 60_000 + 1);
    expect(second.status).toBe("alerted");
    expect(notifyWithDelivery).toHaveBeenCalledTimes(2);
  });

  it("reports when Slack delivered but cooldown persistence failed", async () => {
    turns(20, 15);
    settingsWriteThrows = true;
    const out = await checkChatHealthAndAlert(NOW);
    expect(out).toEqual({
      status: "persistence-failed",
      reason: "Slack delivered, but the alert cooldown could not be persisted.",
    });
    expect(notifyWithDelivery).toHaveBeenCalledTimes(1);
  });
});
