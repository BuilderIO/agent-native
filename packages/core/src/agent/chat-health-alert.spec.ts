import { beforeEach, describe, expect, it, vi } from "vitest";

let turnRows: Array<Record<string, unknown>> = [];
let memberRows: Array<Record<string, unknown>> = [];
let turnQueryThrows = false;

const execute = vi.fn(async ({ sql }: { sql: string }) => {
  if (sql.includes("org_members")) return { rows: memberRows, rowsAffected: 0 };
  if (turnQueryThrows) throw new Error("ledger unreadable");
  return { rows: turnRows, rowsAffected: 0 };
});

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute }),
  isPostgres: () => false,
}));

const settings = new Map<string, Record<string, unknown>>();
let settingsReadThrows = false;
vi.mock("../settings/store.js", () => ({
  getSetting: vi.fn(async (key: string) => {
    if (settingsReadThrows) throw new Error("settings unreadable");
    return settings.get(key) ?? null;
  }),
  putSetting: vi.fn(async (key: string, value: Record<string, unknown>) => {
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
  memberRows = [{ email: "owner@example.com" }];
  turnQueryThrows = false;
  settings.clear();
  settingsReadThrows = false;
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
    memberRows = [{ email: "a@example.com" }, { email: "b@example.com" }];
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
});
