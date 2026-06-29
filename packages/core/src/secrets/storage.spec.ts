import Database from "better-sqlite3";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// A stable encryption key so values round-trip deterministically and the
// crypto layer never falls through to the cwd-derived fallback (which would
// warn on every run).
beforeAll(() => {
  process.env.SECRETS_ENCRYPTION_KEY = "storage-spec-encryption-key";
});

/**
 * Wrap a real in-memory better-sqlite3 connection in the `DbExec` interface
 * that `storage.ts` expects (`execute(string | { sql, args })`). Using a real
 * DB lets us assert genuine behavior — encryption at rest, upsert id-stability,
 * scope isolation, not-found/delete semantics — rather than captured SQL.
 */
function createSqliteExec() {
  const sqlite = new Database(":memory:");
  return {
    sqlite,
    exec: {
      async execute(input: string | { sql: string; args?: any[] }) {
        const sql = typeof input === "string" ? input : input.sql;
        const args = typeof input === "string" ? [] : (input.args ?? []);
        const trimmed = sql.trim().toUpperCase();
        if (trimmed.startsWith("SELECT")) {
          const rows = sqlite.prepare(sql).all(...args);
          return { rows, rowsAffected: 0 };
        }
        const info = sqlite.prepare(sql).run(...args);
        return { rows: [], rowsAffected: info.changes };
      },
    },
  };
}

async function loadStorageWithSqlite() {
  const { sqlite, exec } = createSqliteExec();
  vi.doMock("../db/client.js", () => ({
    getDialect: () => "sqlite",
    getDbExec: () => exec,
    isPostgres: () => false,
  }));
  const mod = await import("./storage.js");
  return { sqlite, mod };
}

const userRef = {
  scope: "user" as const,
  scopeId: "alice@example.test",
  key: "OPENAI_API_KEY",
};

describe("secrets storage bootstrap", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("../db/client.js");
  });

  it("retries table bootstrap after a transient failure", async () => {
    const execute = vi.fn(async () => ({ rows: [] as unknown[] }));
    execute.mockRejectedValueOnce(new Error("transient DDL failure"));

    vi.doMock("../db/client.js", () => ({
      getDialect: () => "sqlite",
      getDbExec: () => ({ execute }),
      isPostgres: () => false,
    }));

    const { readAppSecret } = await import("./storage.js");
    const ref = {
      key: "BUILDER_PRIVATE_KEY",
      scope: "user" as const,
      scopeId: "steve@example.test",
    };

    await expect(readAppSecret(ref)).rejects.toThrow("transient DDL failure");
    await expect(readAppSecret(ref)).resolves.toBeNull();

    expect(String(execute.mock.calls[0]?.[0])).toContain(
      "CREATE TABLE IF NOT EXISTS app_secrets",
    );
    expect(String(execute.mock.calls[1]?.[0])).toContain(
      "CREATE TABLE IF NOT EXISTS app_secrets",
    );
  });

  it("rewrites INTEGER to BIGINT for Postgres so millisecond timestamps fit", async () => {
    const execute = vi.fn(async () => ({ rows: [] as unknown[] }));

    vi.doMock("../db/client.js", () => ({
      getDialect: () => "postgres",
      getDbExec: () => ({ execute }),
      isPostgres: () => true,
    }));

    const { readAppSecret } = await import("./storage.js");
    await readAppSecret(userRef);

    // On Postgres ensureTable now probes information_schema first (no lock) and
    // only issues DDL for what is missing. With an empty fake DB every probe
    // reports "missing", so the CREATE TABLE still runs — just not as call[0].
    // Existence probes are passed as { sql, args }; DDL as a raw string.
    const allSql = execute.mock.calls.map((c) => {
      const input = c[0] as string | { sql: string };
      return typeof input === "string" ? input : input.sql;
    });
    const createSql = allSql.find((s) =>
      s.includes("CREATE TABLE IF NOT EXISTS app_secrets"),
    );
    expect(createSql).toBeDefined();
    expect(createSql).toContain("BIGINT");
    expect(createSql).not.toMatch(/\bINTEGER\b/);

    // The first statement is the cheap existence probe, not DDL — proving the
    // hot path takes no ACCESS EXCLUSIVE lock when the schema already exists.
    expect(allSql[0]).toContain("information_schema.tables");
  });

  it("skips all DDL on Postgres when the table and columns already exist", async () => {
    // information_schema probes report the table and both additive columns as
    // present, so NO CREATE / ALTER should run (no ACCESS EXCLUSIVE lock).
    const execute = vi.fn(async (input: unknown) => {
      const sql = typeof input === "string" ? input : (input as any).sql;
      if (/information_schema/i.test(String(sql))) {
        return { rows: [{ "?column?": 1 }] as unknown[] };
      }
      return { rows: [] as unknown[] };
    });

    vi.doMock("../db/client.js", () => ({
      getDialect: () => "postgres",
      getDbExec: () => ({ execute }),
      isPostgres: () => true,
    }));

    const { readAppSecret } = await import("./storage.js");
    await readAppSecret(userRef);

    const allSql = execute.mock.calls.map((c) => {
      const input = c[0] as string | { sql: string };
      return typeof input === "string" ? input : input.sql;
    });
    expect(allSql.some((s) => /CREATE TABLE/i.test(s))).toBe(false);
    expect(allSql.some((s) => /ALTER TABLE/i.test(s))).toBe(false);
  });
});

describe("secrets storage CRUD (real sqlite)", () => {
  let sqlite: Database.Database;
  let mod: typeof import("./storage.js");

  beforeEach(async () => {
    const loaded = await loadStorageWithSqlite();
    sqlite = loaded.sqlite;
    mod = loaded.mod;
  });

  afterEach(() => {
    sqlite.close();
    vi.resetModules();
    vi.doUnmock("../db/client.js");
  });

  it("encrypts the value at rest and round-trips the plaintext", async () => {
    await mod.writeAppSecret({ ...userRef, value: "sk-live-abc12345" });

    // The raw column never contains the plaintext — it is v1:-tagged ciphertext.
    const row = sqlite
      .prepare(`SELECT encrypted_value FROM app_secrets`)
      .get() as { encrypted_value: string };
    expect(row.encrypted_value).toMatch(/^v1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(row.encrypted_value).not.toContain("sk-live-abc12345");

    const read = await mod.readAppSecret(userRef);
    expect(read).not.toBeNull();
    expect(read!.value).toBe("sk-live-abc12345");
    expect(read!.last4).toBe("••••2345");
    expect(read!.updatedAt).toBeGreaterThan(0);
  });

  it("rejects writes missing any required field without persisting", async () => {
    await expect(mod.writeAppSecret({ ...userRef, value: "" })).rejects.toThrow(
      /key, value, scope, and scopeId are all required/,
    );
    await expect(
      mod.writeAppSecret({ ...userRef, key: "", value: "x" }),
    ).rejects.toThrow(/all required/);
    await expect(
      mod.writeAppSecret({
        scope: "user",
        scopeId: "",
        key: "K",
        value: "x",
      }),
    ).rejects.toThrow(/all required/);

    const { count } = sqlite
      .prepare(`SELECT COUNT(*) as count FROM app_secrets`)
      .get() as { count: number };
    expect(count).toBe(0);
  });

  it("upserts in place: same id, new value/description/allowlist on overwrite", async () => {
    const firstId = await mod.writeAppSecret({
      ...userRef,
      value: "first-value",
      description: "initial",
    });
    const secondId = await mod.writeAppSecret({
      ...userRef,
      value: "second-value-9999",
      description: "updated",
      urlAllowlist: JSON.stringify(["https://api.openai.com"]),
    });

    // Reference stability: overwriting a key must not mint a new id.
    expect(secondId).toBe(firstId);

    const { count } = sqlite
      .prepare(`SELECT COUNT(*) as count FROM app_secrets`)
      .get() as { count: number };
    expect(count).toBe(1);

    const read = await mod.readAppSecret(userRef);
    expect(read!.value).toBe("second-value-9999");

    const meta = await mod.readAppSecretMeta(userRef);
    expect(meta!.description).toBe("updated");
    expect(meta!.urlAllowlist).toEqual(["https://api.openai.com"]);
  });

  it("isolates secrets by scope and scopeId (no cross-tenant leakage)", async () => {
    await mod.writeAppSecret({ ...userRef, value: "alice-secret" });
    await mod.writeAppSecret({
      scope: "user",
      scopeId: "bob@example.test",
      key: "OPENAI_API_KEY",
      value: "bob-secret",
    });
    await mod.writeAppSecret({
      scope: "workspace",
      scopeId: "org_42",
      key: "OPENAI_API_KEY",
      value: "workspace-secret",
    });

    // Same key name, three different owners — each read returns only its own.
    expect((await mod.readAppSecret(userRef))!.value).toBe("alice-secret");
    expect(
      (await mod.readAppSecret({
        scope: "user",
        scopeId: "bob@example.test",
        key: "OPENAI_API_KEY",
      }))!.value,
    ).toBe("bob-secret");
    expect(
      (await mod.readAppSecret({
        scope: "workspace",
        scopeId: "org_42",
        key: "OPENAI_API_KEY",
      }))!.value,
    ).toBe("workspace-secret");

    // A scope that was never written returns null, not another tenant's value.
    expect(
      await mod.readAppSecret({
        scope: "org",
        scopeId: "org_42",
        key: "OPENAI_API_KEY",
      }),
    ).toBeNull();
  });

  it("returns null when reading a secret that does not exist", async () => {
    expect(await mod.readAppSecret(userRef)).toBeNull();
    expect(await mod.getAppSecretMeta(userRef)).toBeNull();
    expect(await mod.readAppSecretMeta(userRef)).toBeNull();
  });

  it("returns null (never throws or leaks) when the stored ciphertext is corrupt", async () => {
    await mod.writeAppSecret({ ...userRef, value: "tamperable" });
    // Simulate a tampered / key-rotated row by overwriting the ciphertext with
    // a syntactically-encrypted-but-undecryptable value.
    sqlite
      .prepare(`UPDATE app_secrets SET encrypted_value = ?`)
      .run("v1:dead:beef:cafe");

    // readAppSecret swallows decryption errors and reports "missing" so the
    // ciphertext never escapes up the stack.
    await expect(mod.readAppSecret(userRef)).resolves.toBeNull();

    // readAppSecretMeta still returns metadata, but with an empty last4 — the
    // value is not exposed.
    const meta = await mod.readAppSecretMeta(userRef);
    expect(meta).not.toBeNull();
    expect(meta!.last4).toBe("");
  });

  it("getAppSecretMeta returns only last4 + updatedAt, never the value", async () => {
    await mod.writeAppSecret({ ...userRef, value: "sk-meta-7777" });
    const meta = await mod.getAppSecretMeta(userRef);
    expect(meta).toEqual({
      last4: "••••7777",
      updatedAt: expect.any(Number),
    });
    expect(JSON.stringify(meta)).not.toContain("sk-meta-7777");
  });

  it("readAppSecretMeta parses a valid allowlist and tolerates malformed JSON", async () => {
    await mod.writeAppSecret({
      ...userRef,
      value: "v",
      urlAllowlist: JSON.stringify(["https://a.test", "https://b.test"]),
    });
    expect((await mod.readAppSecretMeta(userRef))!.urlAllowlist).toEqual([
      "https://a.test",
      "https://b.test",
    ]);

    // A non-array / non-string-array / malformed allowlist degrades to null
    // rather than throwing or exposing junk.
    sqlite.prepare(`UPDATE app_secrets SET url_allowlist = ?`).run("{not json");
    expect((await mod.readAppSecretMeta(userRef))!.urlAllowlist).toBeNull();

    sqlite
      .prepare(`UPDATE app_secrets SET url_allowlist = ?`)
      .run(JSON.stringify([1, 2, 3]));
    expect((await mod.readAppSecretMeta(userRef))!.urlAllowlist).toBeNull();
  });

  it("lists only the requested scope's secrets as metadata (no values), newest first", async () => {
    await mod.writeAppSecret({
      ...userRef,
      key: "FIRST_KEY",
      value: "first-secret-1111",
    });
    await mod.writeAppSecret({
      ...userRef,
      key: "SECOND_KEY",
      value: "second-secret-2222",
      description: "second",
    });
    // A different scope must not appear in this scope's listing.
    await mod.writeAppSecret({
      scope: "user",
      scopeId: "bob@example.test",
      key: "BOB_KEY",
      value: "bob-secret",
    });

    // Both writes can land in the same millisecond; force a distinct, newer
    // updated_at on SECOND_KEY so the ORDER BY updated_at DESC contract is
    // exercised deterministically rather than depending on clock resolution.
    sqlite
      .prepare(
        `UPDATE app_secrets SET updated_at = ? WHERE scope_id = ? AND key = ?`,
      )
      .run(Date.now() + 10_000, "alice@example.test", "SECOND_KEY");

    const list = await mod.listAppSecretsForScope("user", "alice@example.test");
    expect(list.map((s) => s.key).sort()).toEqual(["FIRST_KEY", "SECOND_KEY"]);
    // Newest write comes first (ORDER BY updated_at DESC).
    expect(list[0].key).toBe("SECOND_KEY");
    expect(list[0].description).toBe("second");
    // Metadata only — plaintext never serialized into the list.
    const serialized = JSON.stringify(list);
    expect(serialized).not.toContain("first-secret-1111");
    expect(serialized).not.toContain("second-secret-2222");
    expect(serialized).not.toContain("bob-secret");
    // last4 preview is still surfaced for set keys.
    expect(list.find((s) => s.key === "FIRST_KEY")!.last4).toBe("••••1111");
  });

  it("deleteAppSecret reports whether a row was removed", async () => {
    await mod.writeAppSecret({ ...userRef, value: "to-delete" });
    expect(await mod.deleteAppSecret(userRef)).toBe(true);
    expect(await mod.readAppSecret(userRef)).toBeNull();
    // Deleting again is a no-op and reports false.
    expect(await mod.deleteAppSecret(userRef)).toBe(false);
  });
});

describe("last4 preview", () => {
  let mod: typeof import("./storage.js");
  beforeEach(async () => {
    ({ mod } = await loadStorageWithSqlite());
  });
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("../db/client.js");
  });

  it("masks all but the trailing 4 characters and never reveals short values", () => {
    expect(mod.last4("")).toBe("");
    // Values <= 4 chars reveal nothing — fully masked.
    expect(mod.last4("ab")).toBe("••••");
    expect(mod.last4("abcd")).toBe("••••");
    expect(mod.last4("abcde")).toBe("••••bcde");
    expect(mod.last4("sk-live-1234567890")).toBe("••••7890");
  });
});
