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

const notify = vi.fn(async () => undefined);
vi.mock("../notifications/registry.js", () => ({ notify }));

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
  notify.mockClear();
  execute.mockClear();
});

describe("checkChatHealthAndAlert", () => {
  it("does not page on a tiny sample, however bad the rate", async () => {
    turns(2, 2);
    const out = await checkChatHealthAndAlert(NOW);
    expect(out).toEqual({ status: "insufficient-data", turns: 2 });
    expect(notify).not.toHaveBeenCalled();
  });

  it("stays quiet while the app is answering", async () => {
    turns(20, 2);
    const out = await checkChatHealthAndAlert(NOW);
    expect(out.status).toBe("healthy");
    expect(notify).not.toHaveBeenCalled();
  });

  it("pages every owner and admin once the app stops answering", async () => {
    memberRows = [{ email: "a@example.com" }, { email: "b@example.com" }];
    turns(20, 15);
    const out = await checkChatHealthAndAlert(NOW);
    expect(out).toMatchObject({ status: "alerted", turns: 20, recipients: 2 });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[0][0]).toMatchObject({ severity: "critical" });
    expect(notify.mock.calls[0][1]).toEqual({ owner: "a@example.com" });
  });

  it("pages once per outage, not once per sweep", async () => {
    turns(20, 15);
    await checkChatHealthAndAlert(NOW);
    expect(notify).toHaveBeenCalledTimes(1);

    const out = await checkChatHealthAndAlert(NOW + 60_000);
    expect(out.status).toBe("cooldown");
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("pages again once the cooldown has passed", async () => {
    turns(20, 15);
    await checkChatHealthAndAlert(NOW);
    const out = await checkChatHealthAndAlert(NOW + 60 * 60_000 + 1);
    expect(out.status).toBe("alerted");
    expect(notify).toHaveBeenCalledTimes(2);
  });

  // The whole point of the module: a monitor that cannot read the ledger has
  // NOT found the app healthy. Collapsing these is how an outage gets an
  // all-clear.
  it("reports a failed check as its own outcome, never as healthy", async () => {
    turnQueryThrows = true;
    const out = await checkChatHealthAndAlert(NOW);
    expect(out.status).toBe("check-failed");
    expect(out.status).not.toBe("healthy");
    expect(notify).not.toHaveBeenCalled();
  });

  // An unreadable cooldown stamp is not an absent one. Treating it as absent
  // pages on every sweep for as long as settings stay unreadable.
  it("does not page when the cooldown stamp cannot be read", async () => {
    turns(20, 15);
    settingsReadThrows = true;
    const out = await checkChatHealthAndAlert(NOW);
    expect(out.status).toBe("check-failed");
    expect(notify).not.toHaveBeenCalled();
  });

  it("an undeliverable recipient does not suppress the others", async () => {
    memberRows = [{ email: "a@example.com" }, { email: "b@example.com" }];
    turns(20, 15);
    notify.mockRejectedValueOnce(new Error("channel down"));
    const out = await checkChatHealthAndAlert(NOW);
    expect(out.status).toBe("alerted");
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
