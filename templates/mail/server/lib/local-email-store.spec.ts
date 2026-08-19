import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: new Map<string, string>(),
  forceMailboxConflictOnce: false,
  failDeleteOnce: false,
  execute: vi.fn(),
  emit: vi.fn(),
  getUserSetting: vi.fn(),
}));

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute: mocks.execute }),
  isPostgres: () => false,
}));

vi.mock("@agent-native/core/settings", () => ({
  getSettingsEmitter: () => ({ emit: mocks.emit }),
  getUserSetting: mocks.getUserSetting,
}));

import {
  readLocalEmails,
  withLocalEmailMutationLock,
  writeLocalEmails,
} from "./local-email-store.js";

function installSettingsRowCas() {
  mocks.execute.mockImplementation(async ({ sql, args }) => {
    if (/^SELECT value FROM/.test(sql)) {
      const raw = mocks.rows.get(args[0]) ?? null;
      return {
        rows: raw === null ? [] : [{ value: raw }],
        rowsAffected: 0,
      };
    }
    if (/^INSERT OR IGNORE/.test(sql)) {
      if (mocks.rows.has(args[0])) return { rows: [], rowsAffected: 0 };
      mocks.rows.set(args[0], args[1]);
      return { rows: [], rowsAffected: 1 };
    }
    if (/^UPDATE/.test(sql)) {
      const key = args[2];
      if (key.endsWith(":local-emails") && mocks.forceMailboxConflictOnce) {
        mocks.forceMailboxConflictOnce = false;
        const current = JSON.parse(mocks.rows.get(key) ?? '{"emails":[]}');
        current.emails.push({ id: "concurrent" });
        mocks.rows.set(key, JSON.stringify(current));
        return { rows: [], rowsAffected: 0 };
      }
      if (mocks.rows.get(key) !== args[3]) return { rows: [], rowsAffected: 0 };
      mocks.rows.set(key, args[0]);
      return { rows: [], rowsAffected: 1 };
    }
    if (/^DELETE/.test(sql)) {
      if (mocks.failDeleteOnce) {
        mocks.failDeleteOnce = false;
        throw new Error("release unavailable");
      }
      if (mocks.rows.get(args[0]) !== args[1])
        return { rows: [], rowsAffected: 0 };
      mocks.rows.delete(args[0]);
      return { rows: [], rowsAffected: 1 };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
}

describe("withLocalEmailMutationLock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows.clear();
    mocks.forceMailboxConflictOnce = false;
    mocks.failDeleteOnce = false;
    mocks.getUserSetting.mockResolvedValue(null);
    installSettingsRowCas();
  });

  it("claims and conditionally releases a database-backed owner lease", async () => {
    const result = await withLocalEmailMutationLock(
      "Owner@Example.com",
      async () => "done",
    );

    expect(result).toBe("done");
    expect(mocks.rows.size).toBe(0);
    expect(
      mocks.execute.mock.calls.some(([query]) =>
        /^INSERT OR IGNORE/.test(query.sql),
      ),
    ).toBe(true);
    expect(
      mocks.execute.mock.calls.some(([query]) =>
        /^DELETE FROM settings WHERE key = \? AND value = \?/.test(query.sql),
      ),
    ).toBe(true);
  });

  it("takes over an expired lease with a compare-and-swap update", async () => {
    mocks.rows.set(
      "u:owner@example.com:local-emails-mutation-lock",
      JSON.stringify({
        token: "expired-owner",
        expiresAt: Date.now() - 1,
      }),
    );

    await withLocalEmailMutationLock("owner@example.com", async () => {});

    expect(
      mocks.execute.mock.calls.some(([query]) =>
        /^UPDATE settings SET value = \?, updated_at = \? WHERE key = \? AND value = \?/.test(
          query.sql,
        ),
      ),
    ).toBe(true);
    expect(mocks.rows.size).toBe(0);
  });

  it("releases the database lease when the mutation throws", async () => {
    await expect(
      withLocalEmailMutationLock("owner@example.com", async () => {
        throw new Error("mutation failed");
      }),
    ).rejects.toThrow("mutation failed");

    expect(mocks.rows.size).toBe(0);
  });

  it("retries a transient release failure without blocking the next mutation", async () => {
    const mailboxKey = "u:owner@example.com:local-emails";
    mocks.rows.set(mailboxKey, JSON.stringify({ emails: [{ id: "base" }] }));
    mocks.failDeleteOnce = true;

    const result = await withLocalEmailMutationLock(
      "owner@example.com",
      async () => {
        const emails = await readLocalEmails("owner@example.com");
        emails.push({ id: "ours" } as any);
        await writeLocalEmails("owner@example.com", emails);
        return "done";
      },
    );

    expect(result).toBe("done");
    expect(JSON.parse(mocks.rows.get(mailboxKey)!).emails).toEqual([
      { id: "base" },
      { id: "ours" },
    ]);

    await withLocalEmailMutationLock("owner@example.com", async () => {
      const emails = await readLocalEmails("owner@example.com");
      emails.push({ id: "next" } as any);
      await writeLocalEmails("owner@example.com", emails);
    });

    expect(JSON.parse(mocks.rows.get(mailboxKey)!).emails).toEqual([
      { id: "base" },
      { id: "ours" },
      { id: "next" },
    ]);
  });

  it("retries from the latest mailbox snapshot after a CAS conflict", async () => {
    const mailboxKey = "u:owner@example.com:local-emails";
    mocks.rows.set(mailboxKey, JSON.stringify({ emails: [{ id: "base" }] }));
    mocks.forceMailboxConflictOnce = true;
    let attempts = 0;

    await withLocalEmailMutationLock("owner@example.com", async () => {
      attempts += 1;
      const emails = await readLocalEmails("owner@example.com");
      emails.push({ id: "ours" } as any);
      await writeLocalEmails("owner@example.com", emails);
    });

    expect(attempts).toBe(2);
    expect(JSON.parse(mocks.rows.get(mailboxKey)!).emails).toEqual([
      { id: "base" },
      { id: "concurrent" },
      { id: "ours" },
    ]);
    expect(mocks.emit).toHaveBeenCalledTimes(1);
  });
});
