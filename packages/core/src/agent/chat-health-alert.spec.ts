import { beforeEach, describe, expect, it, vi } from "vitest";

let turnRows: Array<Record<string, unknown>> = [];
let memberRows: Array<Record<string, unknown>> = [];
let turnQueryThrows = false;

const execute = vi.fn(async ({ sql }: { sql: string }) => {
  if (sql.includes("org_members")) {
    const rows = sql.includes("role IN ('owner', 'admin')")
      ? memberRows.filter((row) => row.role === "owner" || row.role === "admin")
      : memberRows;
    return { rows, rowsAffected: 0 };
  }
  if (turnQueryThrows) throw new Error("ledger unreadable");
  return { rows: turnRows, rowsAffected: 0 };
});

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute }),
  isPostgres: () => false,
}));

const settings = new Map<string, Record<string, unknown>>();
let settingsReadThrows = false;
let settingsWriteThrows = false;
vi.mock("../settings/store.js", () => ({
  getSetting: vi.fn(async (key: string) => {
    if (settingsReadThrows) throw new Error("settings unreadable");
    return settings.get(key) ?? null;
  }),
  putSetting: vi.fn(async (key: string, value: Record<string, unknown>) => {
    if (settingsWriteThrows) throw new Error("settings write failed");
    settings.set(key, value);
  }),
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
  turnQueryThrows = false;
  settings.clear();
  settingsReadThrows = false;
  settingsWriteThrows = false;
  notifyWithDelivery.mockClear();
  execute.mockClear();
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

  it("pages once per outage, not once per sweep", async () => {
    turns(20, 15);
    await checkChatHealthAndAlert(NOW);
    expect(notifyWithDelivery).toHaveBeenCalledTimes(1);

    const out = await checkChatHealthAndAlert(NOW + 60_000);
    expect(out.status).toBe("cooldown");
    expect(notifyWithDelivery).toHaveBeenCalledTimes(1);
  });

  it("pages again once the cooldown has passed", async () => {
    turns(20, 15);
    await checkChatHealthAndAlert(NOW);
    const out = await checkChatHealthAndAlert(NOW + 60 * 60_000 + 1);
    expect(out.status).toBe("alerted");
    expect(notifyWithDelivery).toHaveBeenCalledTimes(2);
  });

  // The whole point of the module: a monitor that cannot read the ledger has
  // NOT found the app healthy. Collapsing these is how an outage gets an
  // all-clear.
  it("reports a failed check as its own outcome, never as healthy", async () => {
    turnQueryThrows = true;
    const out = await checkChatHealthAndAlert(NOW);
    expect(out.status).toBe("check-failed");
    expect(out.status).not.toBe("healthy");
    expect(notifyWithDelivery).not.toHaveBeenCalled();
  });

  // An unreadable cooldown stamp is not an absent one. Treating it as absent
  // pages on every sweep for as long as settings stay unreadable.
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

    await checkChatHealthAndAlert(NOW + 60_000);
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
