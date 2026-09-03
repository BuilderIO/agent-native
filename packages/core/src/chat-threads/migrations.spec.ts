import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("../db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/client.js")>();
  return {
    ...actual,
    isPostgres: vi.fn(() => false),
    getDialect: vi.fn(() => "sqlite" as const),
    getMigrationDatabaseUrl: vi.fn(() => ""),
    retrySqliteBusy: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    getDbExec: vi.fn(),
    createDbExec: vi.fn(),
    isServerlessRuntime: vi.fn(() => false),
  };
});

vi.mock("./store.js", () => ({
  repairLegacyChatThreadMessageCounts: vi.fn(async () => ({
    scanned: 0,
    updated: 0,
  })),
}));

import { getDbExec } from "../db/client.js";
import { runMigrations } from "../db/migrations.js";
import {
  CHAT_THREADS_MIGRATIONS,
  CHAT_THREADS_MIGRATIONS_TABLE,
  CHAT_THREADS_REPAIR_MESSAGE_COUNTS_MIGRATION,
  runChatThreadDataMigrations,
} from "./migrations.js";
import { repairLegacyChatThreadMessageCounts } from "./store.js";

/** Exec double that reports which migration names are already recorded. */
function makeExec(appliedNames: string[]) {
  const insertedNames: string[] = [];
  return {
    insertedNames,
    execute: vi.fn(async (sql: string | { sql: string; args?: unknown[] }) => {
      const s = typeof sql === "string" ? sql : sql.sql;
      const args = typeof sql === "string" ? [] : (sql.args ?? []);
      if (/SELECT MAX/i.test(s))
        return { rows: [{ v: null }], rowsAffected: 0 };
      if (/SELECT name FROM/i.test(s)) {
        return {
          rows: appliedNames.map((name) => ({ name })),
          rowsAffected: 0,
        };
      }
      if (/INSERT.*INTO \S*_named/is.test(s)) {
        insertedNames.push(String(args[0]));
        return { rows: [], rowsAffected: 1 };
      }
      return { rows: [], rowsAffected: 0 };
    }),
    close: vi.fn(async () => {}),
  };
}

describe("chat-threads migrations", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("repairs legacy message counts on a database that has not recorded it", async () => {
    const exec = makeExec([]);
    vi.mocked(getDbExec).mockReturnValue(exec);

    const migrate = runMigrations(CHAT_THREADS_MIGRATIONS, {
      table: CHAT_THREADS_MIGRATIONS_TABLE,
    });
    await migrate(null);

    expect(repairLegacyChatThreadMessageCounts).toHaveBeenCalledTimes(1);
    expect(exec.insertedNames).toContain(
      CHAT_THREADS_REPAIR_MESSAGE_COUNTS_MIGRATION,
    );
  });

  it("does not rescan once the repair is recorded for this database", async () => {
    const exec = makeExec([CHAT_THREADS_REPAIR_MESSAGE_COUNTS_MIGRATION]);
    vi.mocked(getDbExec).mockReturnValue(exec);

    const migrate = runMigrations(CHAT_THREADS_MIGRATIONS, {
      table: CHAT_THREADS_MIGRATIONS_TABLE,
    });
    await migrate(null);

    expect(repairLegacyChatThreadMessageCounts).not.toHaveBeenCalled();
  });

  it("leaves the migration unrecorded when the repair throws", async () => {
    const exec = makeExec([]);
    vi.mocked(getDbExec).mockReturnValue(exec);
    vi.mocked(repairLegacyChatThreadMessageCounts).mockRejectedValueOnce(
      new Error("scan failed"),
    );
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as () => never);

    const migrate = runMigrations(CHAT_THREADS_MIGRATIONS, {
      table: CHAT_THREADS_MIGRATIONS_TABLE,
    });
    await migrate(null);

    expect(exec.insertedNames).not.toContain(
      CHAT_THREADS_REPAIR_MESSAGE_COUNTS_MIGRATION,
    );
    exitSpy.mockRestore();
  });

  it("never launches the blob repair from a serverless cold start", async () => {
    const { isServerlessRuntime } = await import("../db/client.js");
    vi.mocked(isServerlessRuntime).mockReturnValueOnce(true);

    await expect(runChatThreadDataMigrations(null)).resolves.toBe(
      "skipped-serverless",
    );

    expect(repairLegacyChatThreadMessageCounts).not.toHaveBeenCalled();
  });

  it("applies the name-tracked repair in a long-lived process", async () => {
    const { isServerlessRuntime } = await import("../db/client.js");
    vi.mocked(isServerlessRuntime).mockReturnValueOnce(false);
    const exec = makeExec([]);
    vi.mocked(getDbExec).mockReturnValue(exec);

    await expect(runChatThreadDataMigrations(null)).resolves.toBe("applied");

    expect(repairLegacyChatThreadMessageCounts).toHaveBeenCalledTimes(1);
    expect(exec.insertedNames).toContain(
      CHAT_THREADS_REPAIR_MESSAGE_COUNTS_MIGRATION,
    );
  });
});
