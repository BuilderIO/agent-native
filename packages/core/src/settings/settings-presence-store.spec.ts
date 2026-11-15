import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let originalEnv: NodeJS.ProcessEnv;

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

vi.mock("../db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/client.js")>();
  return { ...actual, getDbExec: () => rawClient };
});

const {
  getSetting,
  getSettingEntry,
  putSetting,
  mutateSetting,
  getSettingsEmitter,
} = await import("./store.js");
const { getUserSetting, getUserSettingEntry, mutateUserSetting } =
  await import("./index.js");
const { runWithRequestContext } = await import("../server/request-context.js");

async function rawValue(key: string): Promise<string | null> {
  const { rows } = await pglite.query(
    "SELECT value FROM settings WHERE key = ?",
    [key],
  );
  return rows.length === 0 ? null : (rows[0]!.value as string);
}

async function seed(key: string, raw: string): Promise<void> {
  await pglite
    .prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)")
    .run(key, raw, Date.now());
}

beforeEach(async () => {
  originalEnv = { ...process.env };
  process.env.NODE_ENV = "test";
  delete process.env.NETLIFY_FUNCTION_NAME;
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  delete process.env.LAMBDA_TASK_ROOT;
  delete process.env.VERCEL_FUNCTION_ID;
  delete process.env.VERCEL_REGION;
  pglite = await createTestPglite();
  await pglite.exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at BIGINT NOT NULL
  )`);
});

afterEach(async () => {
  process.env = originalEnv;
  await pglite.close();
  vi.clearAllMocks();
});

describe("settings presence: mutateSetting guard", () => {
  it("calls the validator with each present snapshot and rejects before the updater", async () => {
    await putSetting("guarded", { value: 1 });
    const order: string[] = [];
    const validator = vi.fn((value: unknown) => {
      order.push(`guard:${JSON.stringify(value)}`);
    });
    const updater = vi.fn(() => {
      order.push("updater");
      return { value: 2 };
    });

    await mutateSetting("guarded", updater, { validateStoredValue: validator });

    expect(order).toEqual(['guard:{"value":1}', "updater"]);
    expect(validator).toHaveBeenCalledWith({ value: 1 });
    expect(await getSetting("guarded")).toEqual({ value: 2 });
  });

  it("validates a present JSON null even though it parses to null", async () => {
    await seed("null-row", "null");
    const validator = vi.fn((value: unknown) => {
      if (value === null) throw new Error("reject null");
    });
    const updater = vi.fn(() => ({ value: 1 }));

    await expect(
      mutateSetting("null-row", updater, { validateStoredValue: validator }),
    ).rejects.toThrow("reject null");
    expect(validator).toHaveBeenCalledWith(null);
    expect(updater).not.toHaveBeenCalled();
    expect(await rawValue("null-row")).toBe("null");
  });

  it("validates a present snapshot even when the updater returns the stored value", async () => {
    await putSetting("steady-guard", { value: 1 });
    const validator = vi.fn();
    const updater = vi.fn((current: Record<string, unknown> | null) => ({
      ...current!,
    }));

    await mutateSetting("steady-guard", updater, {
      validateStoredValue: validator,
    });

    expect(validator).toHaveBeenCalledTimes(1);
    expect(validator).toHaveBeenCalledWith({ value: 1 });
  });

  it("does not run the validator for an absent row and keeps the absent-row fallback", async () => {
    const validator = vi.fn((value: unknown) => {
      if (value === null) throw new Error("reject null");
    });
    const updater = vi.fn(() => ({ value: 3 }));

    await mutateSetting("absent-row", updater, {
      validateStoredValue: validator,
    });

    expect(validator).not.toHaveBeenCalled();
    expect(updater).toHaveBeenCalledWith(null);
    expect(await getSetting("absent-row")).toEqual({ value: 3 });
  });

  it("rejects through an async validator before any write, cache publication or event", async () => {
    await putSetting("async-guarded", { value: 1 });
    const events: unknown[] = [];
    const listener = (event: unknown) => events.push(event);
    getSettingsEmitter().on("settings", listener);
    try {
      events.length = 0;
      const validator = vi.fn(async () => {
        throw new Error("async reject");
      });
      const updater = vi.fn(() => ({ value: 9 }));
      await expect(
        mutateSetting("async-guarded", updater, {
          validateStoredValue: validator,
        }),
      ).rejects.toThrow("async reject");
      expect(validator).toHaveBeenCalledWith({ value: 1 });
      expect(updater).not.toHaveBeenCalled();
      expect(events).toEqual([]);
      expect(await rawValue("async-guarded")).toBe(
        JSON.stringify({ value: 1 }),
      );
    } finally {
      getSettingsEmitter().off("settings", listener);
    }
  });

  it("awaits a resolving async validator before the updater", async () => {
    await putSetting("async-ordered", { value: 1 });
    const order: string[] = [];
    const validator = vi.fn(async () => {
      await Promise.resolve();
      order.push("guard");
    });

    await mutateSetting(
      "async-ordered",
      () => {
        order.push("updater");
        return { value: 2 };
      },
      { validateStoredValue: validator },
    );

    expect(order).toEqual(["guard", "updater"]);
  });
});

describe("settings presence: canonical null versus legacy migration", () => {
  it("rejects a present canonical JSON null before legacy read, updater, cleanup, write or event", async () => {
    const email = "Guard@Test.com";
    const canonical = "u:guard@test.com:pref";
    const legacy = "u:Guard@Test.com:pref";
    await seed(canonical, "null");
    await seed(legacy, JSON.stringify({ value: "legacy" }));
    const canonicalBefore = await rawValue(canonical);
    const legacyBefore = await rawValue(legacy);

    const events: unknown[] = [];
    const listener = (event: unknown) => events.push(event);
    getSettingsEmitter().on("settings", listener);
    const validator = vi.fn((value: unknown) => {
      if (value === null) throw new Error("reject canonical null");
    });
    const userUpdater = vi.fn(() => ({ value: "next" }));
    try {
      events.length = 0;
      await expect(
        mutateUserSetting(email, "pref", userUpdater, {
          validateStoredValue: validator,
        }),
      ).rejects.toThrow("reject canonical null");
      expect(validator).toHaveBeenCalledTimes(1);
      expect(validator).toHaveBeenCalledWith(null);
      expect(userUpdater).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    } finally {
      getSettingsEmitter().off("settings", listener);
    }

    expect(await rawValue(canonical)).toBe(canonicalBefore);
    expect(await rawValue(legacy)).toBe(legacyBefore);
  });

  it("rejects a competing canonical JSON null installed after the first snapshot", async () => {
    const canonical = "u:compete@example.test:pref";
    const legacy = "u:Compete@example.test:pref";
    await seed(legacy, JSON.stringify({ value: "legacy" }));

    const base = rawClient.execute.getMockImplementation()!;
    let wroteCompetitor = false;
    rawClient.execute.mockImplementation(async (input) => {
      if (
        !wroteCompetitor &&
        typeof input !== "string" &&
        /insert into/i.test(input.sql) &&
        input.args?.[0] === canonical
      ) {
        wroteCompetitor = true;
        await seed(canonical, "null");
        return { rows: [], rowsAffected: 0 };
      }
      return base(input);
    });

    const validator = vi.fn((value: unknown) => {
      if (value === null) throw new Error("reject null");
    });
    const userUpdater = vi.fn(() => ({ value: "next" }));
    const events: unknown[] = [];
    const listener = (event: unknown) => events.push(event);
    getSettingsEmitter().on("settings", listener);
    try {
      events.length = 0;
      await expect(
        mutateUserSetting("Compete@example.test", "pref", userUpdater, {
          validateStoredValue: validator,
        }),
      ).rejects.toThrow("reject null");

      expect(userUpdater).toHaveBeenCalledTimes(1);
      expect(validator).toHaveBeenCalledWith(null);
      expect(await rawValue(canonical)).toBe("null");
      expect(await rawValue(legacy)).toBe(JSON.stringify({ value: "legacy" }));
      expect(events).toEqual([]);
    } finally {
      getSettingsEmitter().off("settings", listener);
      rawClient.execute.mockImplementation(base);
    }
  });
});

describe("settings presence: getUserSettingEntry", () => {
  it("treats a canonical array as present and shadows the legacy row", async () => {
    await seed("u:arr@example.test:pref", JSON.stringify([1, 2]));
    await seed("u:Arr@example.test:pref", JSON.stringify({ legacy: true }));

    const entry = await getUserSettingEntry("arr@example.test", "pref");

    expect(entry).toEqual({ found: true, value: [1, 2] });
  });

  it("treats a canonical scalar as present and keeps legacy getUserSetting unchanged", async () => {
    await seed("u:scalar@example.test:pref", JSON.stringify(7));

    const entry = await getUserSettingEntry("scalar@example.test", "pref");

    expect(entry).toEqual({ found: true, value: 7 });
    expect(await getUserSetting("scalar@example.test", "pref")).toBe(7);
  });

  it("distinguishes a canonical JSON null from an absent row", async () => {
    await seed("u:null@example.test:pref", "null");

    expect(await getUserSettingEntry("null@example.test", "pref")).toEqual({
      found: true,
      value: null,
    });
    expect(await getUserSettingEntry("nobody@example.test", "pref")).toEqual({
      found: false,
    });
    // Legacy getUserSetting still reports null for both, unchanged.
    expect(await getUserSetting("null@example.test", "pref")).toBeNull();
  });

  it("returns absent for a mixed-case email when neither key is set", async () => {
    expect(await getUserSettingEntry("Mixed@Example.test", "pref")).toEqual({
      found: false,
    });
  });

  it("reads a fresh value with bypassCache after a cached absence", async () => {
    await runWithRequestContext(
      { userEmail: "cache@example.test" },
      async () => {
        expect(await getUserSettingEntry("cache@example.test", "pref")).toEqual(
          {
            found: false,
          },
        );
        await seed("u:cache@example.test:pref", JSON.stringify({ value: 5 }));
        expect(await getUserSettingEntry("cache@example.test", "pref")).toEqual(
          {
            found: false,
          },
        );
        expect(
          await getUserSettingEntry("cache@example.test", "pref", {
            bypassCache: true,
          }),
        ).toEqual({ found: true, value: { value: 5 } });
      },
    );
  });

  it("keeps getSettingEntry usable as the underlying presence primitive", async () => {
    await seed("plain-null", "null");
    expect(await getSettingEntry("plain-null")).toEqual({
      found: true,
      value: null,
    });
    expect(await getSettingEntry("plain-missing")).toEqual({ found: false });
  });
});
