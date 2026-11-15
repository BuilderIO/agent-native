/** Settings presence and guarded migration integration tests.
 * Each case uses distinct keys in one isolated database. */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let originalEnv: NodeJS.ProcessEnv;

type RawInput = string | { sql: string; args?: unknown[] };

const defaultExecute = async (input: RawInput) => {
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
};

const rawClient = {
  execute: vi.fn(defaultExecute),
};

vi.mock("../db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/client.js")>();
  return { ...actual, getDbExec: () => rawClient };
});

const { ensureTable } = await import("./store.js");
const { getUserSettingEntry, mutateUserSetting } = await import("./index.js");
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

async function remove(key: string): Promise<void> {
  await pglite.prepare("DELETE FROM settings WHERE key = ?").run(key);
}

interface StatementRecord {
  sql: string;
  args: unknown[];
}

function statementCalls(
  predicate: (sql: string, args: unknown[]) => boolean,
): StatementRecord[] {
  // raw-sql-ok: reads back recorded statements; nothing is executed
  return rawClient.execute.mock.calls
    .map((call) => call[0] as RawInput)
    .filter(
      (input): input is { sql: string; args?: unknown[] } =>
        typeof input !== "string",
    )
    .filter((input) => predicate(input.sql, input.args ?? []))
    .map((input) => ({ sql: input.sql, args: input.args ?? [] }));
}

function readsTouching(key: string): StatementRecord[] {
  return statementCalls(
    (sql, args) => /^\s*select/i.test(sql) && args.includes(key),
  );
}

function deletesTouching(key: string): StatementRecord[] {
  return statementCalls(
    (sql, args) => /^\s*delete/i.test(sql) && args.includes(key),
  );
}

function allStatementsTouching(key: string): StatementRecord[] {
  return statementCalls((_sql, args) => args.includes(key));
}

beforeAll(async () => {
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
  // Warm the store migrations once so no DDL leaks into per-case statements.
  await ensureTable();
});

afterEach(() => {
  rawClient.execute.mockImplementation(defaultExecute);
  vi.clearAllMocks();
});

afterAll(async () => {
  process.env = originalEnv;
  await pglite.close();
});

// Fixed case 1: the original array-shadow test called with lowercase, so the
// canonical and computed legacy keys were identical and the seeded Arr key was
// irrelevant. Call with mixed case and prove the legacy key is never read.
describe("fixed case 1: canonical array shadows a distinct legacy row", () => {
  it("returns the mixed-case canonical array and never SELECTs the legacy key", async () => {
    const email = "Arr@Example.test";
    const canonical = "u:arr@example.test:extra1";
    const legacy = "u:Arr@Example.test:extra1";
    await seed(canonical, JSON.stringify([1, 2]));
    await seed(legacy, JSON.stringify({ legacy: true }));

    rawClient.execute.mockClear();
    const entry = await getUserSettingEntry(email, "extra1");

    expect(entry).toEqual({ found: true, value: [1, 2] });
    expect(readsTouching(legacy)).toEqual([]);
    expect(allStatementsTouching(legacy)).toEqual([]);
    expect(await rawValue(legacy)).toBe(JSON.stringify({ legacy: true }));
  });
});

// Fixed case 2: canonical lowercase key holds raw JSON null; a distinct
// mixed-case legacy key holds a valid object. The presence getter must report
// the canonical null as found and must not read the legacy row.
describe("fixed case 2: canonical JSON null beats valid legacy object", () => {
  it("reports found:true/value:null and never reads the legacy key", async () => {
    const email = "Lower@Example.test";
    const canonical = "u:lower@example.test:extra2";
    const legacy = "u:Lower@Example.test:extra2";
    await seed(canonical, "null");
    await seed(legacy, JSON.stringify({ value: "legacy" }));

    rawClient.execute.mockClear();
    const entry = await getUserSettingEntry(email, "extra2");

    expect(entry).toEqual({ found: true, value: null });
    expect(readsTouching(legacy)).toEqual([]);
    expect(allStatementsTouching(legacy)).toEqual([]);
  });
});

// Fixed case 3: pin the permissive-guard compatibility accepted by the change.
describe("fixed case 3: permissive guard preserves migration semantics", () => {
  it("canonical null plus legacy object: guards each present snapshot in order, migrates, deletes only legacy", async () => {
    const email = "Perm@Example.test";
    const canonical = "u:perm@example.test:extra3a";
    const legacy = "u:Perm@Example.test:extra3a";
    const legacyValue = { value: "legacy" };
    const nextValue = { value: "next" };
    await seed(canonical, "null");
    await seed(legacy, JSON.stringify(legacyValue));

    const order: string[] = [];
    const validator = vi.fn((value: unknown) => {
      order.push(`guard:${JSON.stringify(value)}`);
    });
    const updater = vi.fn((current: Record<string, unknown> | null) => {
      order.push(`updater:${JSON.stringify(current)}`);
      return nextValue;
    });

    rawClient.execute.mockClear();
    const result = await mutateUserSetting(email, "extra3a", updater, {
      validateStoredValue: validator,
    });

    expect(result).toEqual(nextValue);
    expect(order).toEqual([
      "guard:null",
      `guard:${JSON.stringify(legacyValue)}`,
      `updater:${JSON.stringify(legacyValue)}`,
    ]);
    expect(validator).toHaveBeenCalledTimes(2);
    expect(validator).toHaveBeenNthCalledWith(1, null);
    expect(validator).toHaveBeenNthCalledWith(2, legacyValue);
    expect(updater).toHaveBeenCalledTimes(1);
    expect(updater).toHaveBeenCalledWith(legacyValue);
    expect(await rawValue(canonical)).toBe(JSON.stringify(nextValue));
    expect(await rawValue(legacy)).toBeNull();

    const legacyDeletes = deletesTouching(legacy);
    expect(legacyDeletes).toHaveLength(1);
    expect(legacyDeletes[0]!.args[1]).toBe(JSON.stringify(legacyValue));
    expect(deletesTouching(canonical)).toEqual([]);
  });

  it("absent canonical plus legacy JSON null: guards the legacy null once, writes canonical and keeps legacy", async () => {
    const email = "PermNull@Example.test";
    const canonical = "u:permnull@example.test:extra3b";
    const legacy = "u:PermNull@Example.test:extra3b";
    await seed(legacy, "null");

    const order: string[] = [];
    const validator = vi.fn((value: unknown) => {
      order.push(`guard:${JSON.stringify(value)}`);
    });
    const updater = vi.fn((current: Record<string, unknown> | null) => {
      order.push(`updater:${JSON.stringify(current)}`);
      return { value: "next" };
    });

    rawClient.execute.mockClear();
    const result = await mutateUserSetting(email, "extra3b", updater, {
      validateStoredValue: validator,
    });

    expect(result).toEqual({ value: "next" });
    expect(order).toEqual(["guard:null", "updater:null"]);
    expect(validator).toHaveBeenCalledTimes(1);
    expect(validator).toHaveBeenCalledWith(null);
    expect(updater).toHaveBeenCalledWith(null);
    expect(await rawValue(canonical)).toBe(JSON.stringify({ value: "next" }));
    expect(await rawValue(legacy)).toBe("null");
    expect(deletesTouching(legacy)).toEqual([]);
    expect(deletesTouching(canonical)).toEqual([]);
  });
});

// Fixed case 4: real-store cleanup-race behavior, not wrapper branching.
describe("fixed case 4: real-store cleanup race and CAS retry", () => {
  it("leaves actual newer canonical data installed before the cleanup compare untouched", async () => {
    const email = "Race@Example.test";
    const canonical = "u:race@example.test:extra4a";
    const legacy = "u:Race@Example.test:extra4a";
    const legacyValue = { value: "captured" };
    const newer = { value: "newer" };
    await seed(legacy, JSON.stringify(legacyValue));

    const base = rawClient.execute.getMockImplementation()!;
    let injected = false;
    rawClient.execute.mockClear();
    rawClient.execute.mockImplementation(async (input) => {
      const outcome = await base(input);
      if (
        !injected &&
        typeof input !== "string" &&
        /insert into/i.test(input.sql) &&
        input.args?.[0] === canonical
      ) {
        injected = true;
        // A concurrent writer removes the legacy row and installs a newer
        // canonical value before our cleanup compare runs.
        await remove(legacy);
        await pglite
          .prepare("UPDATE settings SET value = ? WHERE key = ?")
          .run(JSON.stringify(newer), canonical);
      }
      return outcome;
    });

    try {
      const result = await mutateUserSetting(
        email,
        "extra4a",
        () => legacyValue,
        { validateStoredValue: vi.fn() },
      );

      expect(result).toEqual(legacyValue);
      // The compare-and-delete for our own canonical write found a newer value
      // and removed nothing; it did not throw away the newer writer's data.
      const canonicalDeletes = deletesTouching(canonical);
      expect(canonicalDeletes).toHaveLength(1);
      expect(canonicalDeletes[0]!.args[1]).toBe(JSON.stringify(legacyValue));
      expect(await rawValue(canonical)).toBe(JSON.stringify(newer));
      expect(await rawValue(legacy)).toBeNull();
    } finally {
      rawClient.execute.mockImplementation(base);
    }
  });

  it("force CAS legacy->canonical retry resets migration tracking and runs no DELETE", async () => {
    const email = "Retry@Example.test";
    const canonical = "u:retry@example.test:extra4b";
    const legacy = "u:Retry@Example.test:extra4b";
    const legacyValue = { value: "legacy" };
    const canonicalValue = { value: "canonical" };
    await seed(legacy, JSON.stringify(legacyValue));

    const base = rawClient.execute.getMockImplementation()!;
    let injected = false;
    rawClient.execute.mockClear();
    rawClient.execute.mockImplementation(async (input) => {
      if (
        !injected &&
        typeof input !== "string" &&
        /insert into/i.test(input.sql) &&
        input.args?.[0] === canonical
      ) {
        injected = true;
        // A concurrent writer lands canonical before our conditional insert, so
        // ON CONFLICT DO NOTHING affects no rows and mutateSetting retries CAS.
        await seed(canonical, JSON.stringify(canonicalValue));
      }
      return base(input);
    });

    const validator = vi.fn();
    const updater = vi.fn(
      (current: Record<string, unknown> | null) => current ?? legacyValue,
    );

    try {
      const result = await mutateUserSetting(email, "extra4b", updater, {
        validateStoredValue: validator,
      });

      expect(result).toEqual(canonicalValue);
      expect(updater).toHaveBeenNthCalledWith(1, legacyValue);
      expect(updater).toHaveBeenNthCalledWith(2, canonicalValue);
      // The retry re-read the winning canonical snapshot and guarded it.
      expect(validator).toHaveBeenNthCalledWith(1, legacyValue);
      expect(validator).toHaveBeenNthCalledWith(2, canonicalValue);
      expect(await rawValue(canonical)).toBe(JSON.stringify(canonicalValue));
      expect(await rawValue(legacy)).toBe(JSON.stringify(legacyValue));
      expect(deletesTouching(legacy)).toEqual([]);
      expect(deletesTouching(canonical)).toEqual([]);
    } finally {
      rawClient.execute.mockImplementation(base);
    }
  });

  it("guarded legacy deletion-wins migrates and removes only the legacy row", async () => {
    const email = "Win@Example.test";
    const canonical = "u:win@example.test:extra4c";
    const legacy = "u:Win@Example.test:extra4c";
    const legacyValue = { value: "legacy" };
    await seed(legacy, JSON.stringify(legacyValue));

    const validator = vi.fn();
    rawClient.execute.mockClear();
    const result = await mutateUserSetting(
      email,
      "extra4c",
      () => legacyValue,
      { validateStoredValue: validator },
    );

    expect(result).toEqual(legacyValue);
    expect(validator).toHaveBeenCalledWith(legacyValue);
    expect(await rawValue(canonical)).toBe(JSON.stringify(legacyValue));
    expect(await rawValue(legacy)).toBeNull();
    const legacyDeletes = deletesTouching(legacy);
    expect(legacyDeletes).toHaveLength(1);
    expect(legacyDeletes[0]!.args[1]).toBe(JSON.stringify(legacyValue));
    expect(deletesTouching(canonical)).toEqual([]);
  });
});

describe("guarded migration with concurrent legacy deletion", () => {
  it("rejects when a concurrent legacy delete wins before cleanup", async () => {
    const email = "Gone@Example.test";
    const canonical = "u:gone@example.test:concurrent-delete";
    const legacy = "u:Gone@Example.test:concurrent-delete";
    const previous = { value: "legacy" };
    const next = { value: "updated" };
    await seed(legacy, JSON.stringify(previous));
    const base = rawClient.execute.getMockImplementation()!;
    let injected = false;
    rawClient.execute.mockImplementation(async (input) => {
      if (
        !injected &&
        typeof input !== "string" &&
        /^\s*delete/i.test(input.sql) &&
        input.args?.[0] === legacy
      ) {
        injected = true;
        await remove(legacy);
      }
      return base(input);
    });
    const validator = vi.fn();
    const updater = vi.fn(() => next);
    try {
      await expect(
        mutateUserSetting(email, "concurrent-delete", updater, {
          validateStoredValue: validator,
        }),
      ).rejects.toThrow(
        "User setting was deleted while migrating its legacy key",
      );
      expect(injected).toBe(true);
      expect(validator).toHaveBeenCalledExactlyOnceWith(previous);
      expect(updater).toHaveBeenCalledExactlyOnceWith(previous);
      expect(await rawValue(legacy)).toBeNull();
      expect(await rawValue(canonical)).toBeNull();
      expect(deletesTouching(legacy)).toHaveLength(1);
      const canonicalDeletes = deletesTouching(canonical);
      expect(canonicalDeletes).toHaveLength(1);
      expect(canonicalDeletes[0]!.args[1]).toBe(JSON.stringify(next));
    } finally {
      rawClient.execute.mockImplementation(base);
    }
  });
});

// Fixed case 5: async guard invocation count, statement spies on the
// no-legacy-read/no-delete promise, and the request-cache observation.
describe("fixed case 5: async guard count, spies and request cache", () => {
  it("async guard rejects a canonical JSON null once with no legacy read/delete and no cache publication", async () => {
    const email = "Async@Example.test";
    const canonical = "u:async@example.test:extra5";
    const legacy = "u:Async@Example.test:extra5";
    const legacyValue = { value: "legacy" };
    await seed(canonical, "null");
    await seed(legacy, JSON.stringify(legacyValue));

    const validator = vi.fn(async (value: unknown) => {
      await Promise.resolve();
      if (value === null) throw new Error("reject canonical null");
    });
    const updater = vi.fn(() => ({ value: "next" }));

    await runWithRequestContext(
      { userEmail: "async@example.test" },
      async () => {
        // Prime the per-request cache with the present canonical null.
        expect(
          await getUserSettingEntry("async@example.test", "extra5"),
        ).toEqual({ found: true, value: null });

        rawClient.execute.mockClear();
        await expect(
          mutateUserSetting(email, "extra5", updater, {
            validateStoredValue: validator,
          }),
        ).rejects.toThrow("reject canonical null");

        expect(validator).toHaveBeenCalledTimes(1);
        expect(validator).toHaveBeenCalledWith(null);
        expect(updater).not.toHaveBeenCalled();
        expect(readsTouching(legacy)).toEqual([]);
        expect(deletesTouching(legacy)).toEqual([]);
        expect(deletesTouching(canonical)).toEqual([]);
        expect(await rawValue(canonical)).toBe("null");
        expect(await rawValue(legacy)).toBe(JSON.stringify(legacyValue));

        // The rejected mutation published nothing: the same request context
        // still serves the primed canonical null from cache (no new SELECT).
        rawClient.execute.mockClear();
        expect(
          await getUserSettingEntry("async@example.test", "extra5"),
        ).toEqual({ found: true, value: null });
        expect(readsTouching(canonical)).toEqual([]);
      },
    );
  });

  it("competing canonical null rejects with no legacy read and no DELETE on either key", async () => {
    const email = "Compete@Example.test";
    const canonical = "u:compete@example.test:extra5b";
    const legacy = "u:Compete@Example.test:extra5b";
    const legacyValue = { value: "legacy" };
    await seed(legacy, JSON.stringify(legacyValue));

    const base = rawClient.execute.getMockImplementation()!;
    let wroteCompetitor = false;
    rawClient.execute.mockClear();
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
    const updater = vi.fn(() => ({ value: "next" }));

    try {
      await expect(
        mutateUserSetting(email, "extra5b", updater, {
          validateStoredValue: validator,
        }),
      ).rejects.toThrow("reject null");

      expect(updater).toHaveBeenCalledTimes(1);
      expect(updater).toHaveBeenCalledWith(legacyValue);
      expect(validator).toHaveBeenNthCalledWith(1, legacyValue);
      expect(validator).toHaveBeenNthCalledWith(2, null);
      expect(readsTouching(legacy)).not.toEqual([]);
      expect(deletesTouching(legacy)).toEqual([]);
      expect(deletesTouching(canonical)).toEqual([]);
      expect(await rawValue(canonical)).toBe("null");
      expect(await rawValue(legacy)).toBe(JSON.stringify(legacyValue));
    } finally {
      rawClient.execute.mockImplementation(base);
    }
  });
});
