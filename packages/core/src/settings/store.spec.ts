import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      await pglite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = await pglite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql)) {
      return { rows: await stmt.all(...args), rowsAffected: 0 };
    }
    const info = await stmt.run(...args);
    return { rows: [], rowsAffected: info.changes };
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => rawClient,
  isProductionServerlessFunctionRuntime: () => false,
}));

const {
  getSetting,
  getSettings,
  putSetting,
  deleteSetting,
  deleteSettingIfValue,
  mutateSetting,
} = await import("./store.js");
const { runWithRequestContext } = await import("../server/request-context.js");

beforeEach(async () => {
  pglite = await createTestPglite();
  await pglite.exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at BIGINT NOT NULL
  )`);
});

afterEach(async () => {
  await pglite.close();
  vi.clearAllMocks();
});

describe("settings store", () => {
  it("issues the poll-path index DDL on init", async () => {
    const seen: string[] = [];
    const orig = rawClient.execute.getMockImplementation()!;
    rawClient.execute.mockImplementation(
      async (input: string | { sql: string; args?: unknown[] }) => {
        const sql = typeof input === "string" ? input : input.sql;
        seen.push(sql);
        return orig(input);
      },
    );
    try {
      await putSetting("probe", { x: 1 });
    } finally {
      rawClient.execute.mockImplementation(orig);
    }
    expect(seen).toContain(
      "CREATE INDEX IF NOT EXISTS settings_updated_at_idx ON public.settings (updated_at)",
    );
  });

  it("round-trips a value via put/get", async () => {
    await putSetting("theme", { value: "dark" });
    const result = await getSetting("theme");
    expect(result).toEqual({ value: "dark" });
  });

  it("returns null for a missing key", async () => {
    const result = await getSetting("does-not-exist");
    expect(result).toBeNull();
  });

  it("throws for a corrupted (unparseable) stored value instead of reporting it missing", async () => {
    await pglite
      .prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`)
      .run("corrupt", "{not valid json", Date.now());

    await expect(getSetting("corrupt")).rejects.toThrow(SyntaxError);
  });

  it("throws for a corrupted value already sitting in the request cache", async () => {
    await runWithRequestContext({ userEmail: "a@b.com" }, async () => {
      await pglite
        .prepare(
          `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
        )
        .run("corrupt-cached", "{not valid json", Date.now());

      await getSettings(["corrupt-cached"]);
      rawClient.execute.mockClear();

      await expect(getSetting("corrupt-cached")).rejects.toThrow(SyntaxError);
      expect(rawClient.execute).not.toHaveBeenCalled();
    });
  });

  it("deletes an existing key and returns true", async () => {
    await putSetting("to-delete", { keep: false });
    const deleted = await deleteSetting("to-delete");
    expect(deleted).toBe(true);
    expect(await getSetting("to-delete")).toBeNull();
  });

  it("returns false when deleting a key that does not exist", async () => {
    const deleted = await deleteSetting("ghost");
    expect(deleted).toBe(false);
  });

  it("conditionally deletes only the inspected value", async () => {
    await putSetting("conditional", { value: "old" });

    expect(await deleteSettingIfValue("conditional", { value: "new" })).toBe(
      false,
    );
    expect(await getSetting("conditional")).toEqual({ value: "old" });
    expect(await deleteSettingIfValue("conditional", { value: "old" })).toBe(
      true,
    );
    expect(await getSetting("conditional")).toBeNull();
  });

  it("preserves every concurrent read-modify-write update", async () => {
    await putSetting("counter", { value: 0 });

    await Promise.all(
      Array.from({ length: 12 }, () =>
        mutateSetting("counter", async (current) => {
          await Promise.resolve();
          return { value: Number(current?.value ?? 0) + 1 };
        }),
      ),
    );

    expect(await getSetting("counter")).toEqual({ value: 12 });
  });

  it("serializes concurrent creation of a missing setting", async () => {
    await Promise.all(
      Array.from({ length: 8 }, () =>
        mutateSetting("new-counter", async (current) => {
          await Promise.resolve();
          return { value: Number(current?.value ?? 0) + 1 };
        }),
      ),
    );

    expect(await getSetting("new-counter")).toEqual({ value: 8 });
  });

  it("lists and isolates keys by prefix", async () => {
    await putSetting("builder-connect-pending:a", { expiresAt: 1 });
    await putSetting("builder-connect-pending:b", { expiresAt: 2 });
    await putSetting("other:c", { expiresAt: 3 });

    const { listSettingsByPrefix } = await import("./store.js");
    const rows = await listSettingsByPrefix("builder-connect-pending:");
    expect(rows.map((row) => row.key).sort()).toEqual([
      "builder-connect-pending:a",
      "builder-connect-pending:b",
    ]);
  });

  it("bounds and orders prefix reads when requested", async () => {
    await putSetting("dashboard:c", { id: "c" });
    await putSetting("dashboard:a", { id: "a" });
    await putSetting("dashboard:b", { id: "b" });

    const { listSettingsByPrefix } = await import("./store.js");
    const rows = await listSettingsByPrefix("dashboard:", { limit: 2 });

    expect(rows.map((row) => row.key)).toEqual(["dashboard:a", "dashboard:b"]);
    expect(rawClient.execute).toHaveBeenLastCalledWith({
      sql: expect.stringContaining("ORDER BY key ASC LIMIT ?"),
      args: ["dashboard:%", 2],
    });
  });
});

it("reads settings through a supplied transaction without another connection", async () => {
  const execute = vi.fn(async () => ({
    rows: [{ value: '{"enabled":true}' }],
    rowsAffected: 0,
  }));
  rawClient.execute.mockClear();
  expect(await getSetting("flag", { transaction: { execute } })).toEqual({
    enabled: true,
  });
  expect(execute).toHaveBeenCalledOnce();
  expect(rawClient.execute).not.toHaveBeenCalled();
});

describe("getSettings (batched read)", () => {
  it("reads N distinct keys in a single query", async () => {
    await runWithRequestContext({ userEmail: "a@b.com" }, async () => {
      await putSetting("k1", { v: 1 });
      await putSetting("k2", { v: 2 });
      rawClient.execute.mockClear();

      const values = await getSettings(["k1", "k2", "k3"]);

      expect(values).toEqual(
        new Map([
          ["k1", { v: 1 }],
          ["k2", { v: 2 }],
          ["k3", null],
        ]),
      );
      expect(rawClient.execute).toHaveBeenCalledTimes(1);
    });
  });

  it("seeds the request cache so a later getSetting costs no query, including for a missing key", async () => {
    await runWithRequestContext({ userEmail: "a@b.com" }, async () => {
      await putSetting("hit", { v: 1 });
      rawClient.execute.mockClear();

      await getSettings(["hit", "miss"]);
      rawClient.execute.mockClear();

      expect(await getSetting("hit")).toEqual({ v: 1 });
      expect(await getSetting("miss")).toBeNull();
      expect(rawClient.execute).not.toHaveBeenCalled();
    });
  });

  it("serves keys already in the request cache without re-querying", async () => {
    await runWithRequestContext({ userEmail: "a@b.com" }, async () => {
      await putSetting("cached", { v: 1 });
      await getSetting("cached");
      rawClient.execute.mockClear();

      const values = await getSettings(["cached"]);

      expect(values).toEqual(new Map([["cached", { v: 1 }]]));
      expect(rawClient.execute).not.toHaveBeenCalled();
    });
  });

  it("chunks an IN-list larger than the batch size into separate queries", async () => {
    await runWithRequestContext({ userEmail: "a@b.com" }, async () => {
      const keys = Array.from({ length: 501 }, (_, i) => `chunk-${i}`);
      rawClient.execute.mockClear();

      const values = await getSettings(keys);

      expect(values.size).toBe(501);
      expect([...values.values()].every((v) => v === null)).toBe(true);
      expect(rawClient.execute).toHaveBeenCalledTimes(2);
    });
  });

  it("returns an empty map for an empty key list without querying", async () => {
    rawClient.execute.mockClear();
    expect(await getSettings([])).toEqual(new Map());
    expect(rawClient.execute).not.toHaveBeenCalled();
  });

  it("isolates a corrupted key's JSON from the rest of the batch", async () => {
    await putSetting("good", { v: 1 });
    await pglite
      .prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`)
      .run("corrupt", "{not valid json", Date.now());

    const values = await getSettings(["good", "corrupt"]);

    expect(values).toEqual(
      new Map([
        ["good", { v: 1 }],
        ["corrupt", null],
      ]),
    );
  });

  it("bypasses and does not populate the request cache when bypassCache is set", async () => {
    await pglite
      .prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`)
      .run("k", JSON.stringify({ v: 1 }), Date.now());

    await runWithRequestContext({ userEmail: "a@b.com" }, async () => {
      rawClient.execute.mockClear();

      await getSettings(["k"], { bypassCache: true });
      rawClient.execute.mockClear();

      await getSetting("k");
      expect(rawClient.execute).toHaveBeenCalledTimes(1);
    });
  });
});
