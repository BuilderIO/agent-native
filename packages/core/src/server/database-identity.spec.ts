import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `mutateSetting`/`getSetting` are faked against one shared in-memory row
 * rather than mocked as pass-through stubs — the behavior under test is
 * "does the updater we hand `mutateSetting` actually preserve an existing
 * record", and a stub that always calls the updater fresh (ignoring what a
 * prior call stored) would validate nothing.
 */
const mocks = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    rows,
    getAppConfig: vi.fn(() => ({ app: {} as { slug?: string; id?: string } })),
    mutateSetting: vi.fn(
      async (
        key: string,
        updater: (
          current: Record<string, unknown> | null,
        ) => Record<string, unknown> | Promise<Record<string, unknown>>,
      ) => {
        const current = rows.has(key) ? rows.get(key)! : null;
        const next = await updater(current);
        rows.set(key, next);
        return next;
      },
    ),
    getSetting: vi.fn(async (key: string) =>
      rows.has(key) ? rows.get(key)! : null,
    ),
  };
});

vi.mock("../app-config/index.js", () => ({ getAppConfig: mocks.getAppConfig }));
vi.mock("../settings/store.js", () => ({
  mutateSetting: mocks.mutateSetting,
  getSetting: mocks.getSetting,
}));

import {
  DATABASE_IDENTITY_SETTING_KEY,
  readDatabaseIdentity,
  recordDatabaseIdentity,
  resolveRunningAppIdentity,
} from "./database-identity.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows.clear();
  mocks.getAppConfig.mockReturnValue({ app: {} });
});

describe("resolveRunningAppIdentity", () => {
  it("prefers the app slug over the app id", () => {
    mocks.getAppConfig.mockReturnValue({ app: { slug: "chat", id: "app_1" } });
    expect(resolveRunningAppIdentity()).toBe("chat");
  });

  it("falls back to the app id when no slug is derived", () => {
    mocks.getAppConfig.mockReturnValue({ app: { id: "app_1" } });
    expect(resolveRunningAppIdentity()).toBe("app_1");
  });

  it("is null when neither is configured", () => {
    mocks.getAppConfig.mockReturnValue({ app: {} });
    expect(resolveRunningAppIdentity()).toBeNull();
  });
});

describe("recordDatabaseIdentity", () => {
  it("writes app + recordedAt on first call", async () => {
    mocks.getAppConfig.mockReturnValue({ app: { slug: "chat" } });

    const result = await recordDatabaseIdentity();

    expect(result).toEqual({
      state: "recorded",
      app: "chat",
      recordedAt: expect.any(String),
    });
    expect(mocks.rows.get(DATABASE_IDENTITY_SETTING_KEY)).toEqual({
      app: "chat",
      recordedAt: expect.any(String),
    });
  });

  // The exact incident this exists to catch: chat's real database already
  // belongs to factory, and a second app must never repoint that record to
  // itself just because it also happened to boot against it.
  it("never overwrites a database already recorded for a different app", async () => {
    mocks.getAppConfig.mockReturnValue({ app: { slug: "factory" } });
    const first = await recordDatabaseIdentity();
    expect(first).toMatchObject({ state: "recorded", app: "factory" });

    mocks.getAppConfig.mockReturnValue({ app: { slug: "chat" } });
    const second = await recordDatabaseIdentity();

    // Reports the database's actual (winning) owner, not the caller's own app.
    expect(second).toMatchObject({ state: "recorded", app: "factory" });
    expect(second.state === "recorded" && second.recordedAt).toBe(
      first.state === "recorded" && first.recordedAt,
    );
    expect(mocks.rows.get(DATABASE_IDENTITY_SETTING_KEY)?.app).toBe("factory");
  });

  it("skips without writing when no app slug or id is configured", async () => {
    mocks.getAppConfig.mockReturnValue({ app: {} });

    const result = await recordDatabaseIdentity();

    expect(result).toEqual({ state: "skipped", reason: "no-app-identity" });
    expect(mocks.mutateSetting).not.toHaveBeenCalled();
  });

  it("propagates a write failure instead of reporting a false skip or success", async () => {
    mocks.getAppConfig.mockReturnValue({ app: { slug: "chat" } });
    mocks.mutateSetting.mockRejectedValueOnce(new Error("db unreachable"));

    await expect(recordDatabaseIdentity()).rejects.toThrow("db unreachable");
  });
});

describe("readDatabaseIdentity", () => {
  it("reports unrecorded when no row exists yet", async () => {
    await expect(readDatabaseIdentity()).resolves.toEqual({
      state: "unrecorded",
    });
  });

  it("reports the recorded app once written", async () => {
    mocks.rows.set(DATABASE_IDENTITY_SETTING_KEY, {
      app: "factory",
      recordedAt: "2026-08-19T00:00:00.000Z",
    });

    await expect(readDatabaseIdentity()).resolves.toEqual({
      state: "recorded",
      app: "factory",
      recordedAt: "2026-08-19T00:00:00.000Z",
    });
  });

  // "checked, nothing there" and "the check itself failed" must never
  // collapse into the same state — a monitor reading a failed check as
  // "unrecorded" would page for the wrong reason, or not at all.
  it("distinguishes an unreadable store from a genuinely unrecorded one", async () => {
    mocks.getSetting.mockRejectedValueOnce(new Error("connection refused"));

    const result = await readDatabaseIdentity();

    expect(result.state).toBe("unreadable");
    expect(result).not.toEqual({ state: "unrecorded" });
    expect((result as { error: string }).error).toContain("connection refused");
  });

  it("reports unreadable for a malformed stored value instead of pretending it's unrecorded", async () => {
    mocks.rows.set(DATABASE_IDENTITY_SETTING_KEY, { app: 42 });

    const result = await readDatabaseIdentity();

    expect(result.state).toBe("unreadable");
  });

  it("reads through a caller-supplied exec instead of opening its own client", async () => {
    const exec = {
      execute: vi.fn(async () => ({
        rows: [{ value: JSON.stringify({ app: "chat", recordedAt: "t" }) }],
        rowsAffected: 0,
      })),
    };

    const result = await readDatabaseIdentity(exec as any);

    expect(result).toEqual({ state: "recorded", app: "chat", recordedAt: "t" });
    expect(mocks.getSetting).not.toHaveBeenCalled();
    expect(exec.execute).toHaveBeenCalledWith({
      sql: "SELECT value FROM settings WHERE key = ?",
      args: [DATABASE_IDENTITY_SETTING_KEY],
    });
  });

  it("reports unreadable, not unrecorded, when the supplied exec fails", async () => {
    const exec = {
      execute: vi.fn(async () => {
        throw new Error("connection refused");
      }),
    };

    const result = await readDatabaseIdentity(exec as any);

    expect(result.state).toBe("unreadable");
  });
});
