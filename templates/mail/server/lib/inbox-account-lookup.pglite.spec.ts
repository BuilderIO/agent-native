import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The first PGlite boot can exceed the default hook timeout when the whole
// suite runs in parallel.
vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

type Stores = typeof import("./inbox-store.js");
type Exec = { execute: (q: { sql: string; args?: unknown[] }) => Promise<any> };

let stores: Stores;
let exec: Exec;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory");
  const [{ default: initializeMailDb }, core, storeModule] = await Promise.all([
    import("../plugins/db.js"),
    import("@agent-native/core/db"),
    import("./inbox-store.js"),
  ]);
  await initializeMailDb({});
  exec = core.getDbExec() as unknown as Exec;
  stores = storeModule;
});

afterEach(async () => {
  const { closeDbExec } = await import("@agent-native/core/db");
  await closeDbExec();
  Reflect.deleteProperty(globalThis as object, "__agentNativePgliteClients");
  Reflect.deleteProperty(
    globalThis as object,
    "__agentNativePgliteProcessLocks",
  );
  Reflect.deleteProperty(
    globalThis as object,
    "__agentNativePgliteProcessExitCleanupRegistered",
  );
  vi.unstubAllEnvs();
  vi.resetModules();
});

function thread(
  owner: string,
  account: string,
  threadId: string,
  messageIds: string[],
) {
  return {
    ownerEmail: owner,
    accountEmail: account,
    threadId,
    inInbox: true,
    isUnread: false,
    isStarred: false,
    isImportant: false,
    isAutomated: false,
    latestDate: 1_000,
    latestMessageId: messageIds[0],
    subject: "subject",
    snippet: "",
    fromName: "",
    fromEmail: "sender@example.com",
    to: [],
    labelIds: ["INBOX"],
    messageIds,
    messageCount: messageIds.length,
    unreadCount: 0,
    hasAttachments: false,
    syncedAt: 1_000,
  };
}

describe("findAccountsForTargets (PGlite)", () => {
  it("maps thread and message ids for a whole batch in one query, scoped to the owner", async () => {
    const owner = "owner@example.com";
    await stores.upsertInboxThreadRows([
      thread(owner, "a@example.com", "t-a", ["m-a1", "m-a2"]),
      thread(owner, "b@example.com", "t-b", ["m-b1"]),
      thread("other@example.com", "c@example.com", "t-c", ["m-c1"]),
    ]);
    const execute = vi.spyOn(exec, "execute");

    const found = await stores.findAccountsForTargets(owner, {
      threadIds: ["t-a", "t-c", "t-missing"],
      messageIds: ["m-b1", "m-a2", "m-c1", "m-missing"],
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect([...found.byThread]).toEqual([["t-a", "a@example.com"]]);
    expect(Object.fromEntries(found.byMessage)).toEqual({
      "m-a2": "a@example.com",
      "m-b1": "b@example.com",
    });
  });

  it("answers 50 targets with the same single query", async () => {
    const owner = "owner@example.com";
    const rows = Array.from({ length: 50 }, (_, i) =>
      thread(owner, i % 2 ? "b@example.com" : "a@example.com", `t${i}`, [
        `m${i}`,
      ]),
    );
    await stores.upsertInboxThreadRows(rows);
    const execute = vi.spyOn(exec, "execute");

    const found = await stores.findAccountsForTargets(owner, {
      threadIds: rows.map((row) => row.threadId),
      messageIds: [],
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(found.byThread.size).toBe(50);
    expect(found.byThread.get("t3")).toBe("b@example.com");
  });
});
