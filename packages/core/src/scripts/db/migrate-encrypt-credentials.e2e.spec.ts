import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient, type Client } from "@libsql/client";
/**
 * End-to-end test for the `db-migrate-encrypt-credentials` script against a
 * REAL (temp-file) SQLite database. Validates the command we tell operators to
 * run in production: it encrypts plaintext credential rows in place, leaves
 * already-encrypted and non-credential rows alone, is idempotent, and refuses
 * to run without an encryption key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  encryptSecretValue,
  decryptSecretValue,
  isEncryptedSecretValue,
} from "../../secrets/crypto.js";

const KEY = "migrate-encrypt-spec-key";

describe("db-migrate-encrypt-credentials (e2e, real sqlite)", () => {
  let dir: string;
  let dbFile: string;
  let url: string;

  async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const c = createClient({ url });
    try {
      return await fn(c);
    } finally {
      c.close();
    }
  }

  async function rawValue(key: string): Promise<string> {
    return withClient(async (c) => {
      const r = await c.execute({
        sql: `SELECT value FROM settings WHERE key = ?`,
        args: [key],
      });
      const stored = JSON.parse(r.rows[0].value as string);
      return stored.value as string;
    });
  }

  async function runMigrate(extraArgs: string[] = []): Promise<void> {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { default: migrate } =
        await import("./migrate-encrypt-credentials.js");
      await migrate(["--db", dbFile, ...extraArgs]);
    } finally {
      vi.restoreAllMocks();
    }
  }

  beforeEach(async () => {
    vi.stubEnv("SECRETS_ENCRYPTION_KEY", KEY);
    dir = await mkdtemp(path.join(os.tmpdir(), "an-migrate-"));
    dbFile = path.join(dir, "app.db");
    url = "file:" + dbFile;
    await withClient(async (c) => {
      await c.execute(
        `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
      );
      const rows: [string, unknown][] = [
        ["u:a@x.com:credential:OPENAI_API_KEY", { value: "sk-plain-AAA" }],
        ["o:org1:credential:STRIPE_KEY", { value: "sk_live_plain" }],
        // Already encrypted — must be left untouched (idempotent).
        ["u:b@x.com:credential:K", { value: encryptSecretValue("already") }],
        // Non-credential setting — must never be touched.
        ["u:a@x.com:pref:theme", { value: "dark" }],
      ];
      for (const [key, value] of rows) {
        await c.execute({
          sql: `INSERT INTO settings VALUES (?, ?, ?)`,
          args: [key, JSON.stringify(value), 1],
        });
      }
    });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("--dry-run reports rows without writing anything", async () => {
    await runMigrate(["--dry-run"]);
    expect(await rawValue("u:a@x.com:credential:OPENAI_API_KEY")).toBe(
      "sk-plain-AAA",
    );
  });

  it("encrypts plaintext credential rows in place (decrypts to the original)", async () => {
    await runMigrate();
    const userVal = await rawValue("u:a@x.com:credential:OPENAI_API_KEY");
    const orgVal = await rawValue("o:org1:credential:STRIPE_KEY");
    expect(isEncryptedSecretValue(userVal)).toBe(true);
    expect(isEncryptedSecretValue(orgVal)).toBe(true);
    expect(decryptSecretValue(userVal)).toBe("sk-plain-AAA");
    expect(decryptSecretValue(orgVal)).toBe("sk_live_plain");
  });

  it("leaves already-encrypted and non-credential rows untouched", async () => {
    const beforeEnc = await rawValue("u:b@x.com:credential:K");
    await runMigrate();
    expect(await rawValue("u:b@x.com:credential:K")).toBe(beforeEnc); // byte-identical
    expect(await rawValue("u:a@x.com:pref:theme")).toBe("dark"); // plaintext pref
  });

  it("is idempotent — a second run encrypts nothing new", async () => {
    await runMigrate();
    const after1 = await rawValue("u:a@x.com:credential:OPENAI_API_KEY");
    await runMigrate();
    const after2 = await rawValue("u:a@x.com:credential:OPENAI_API_KEY");
    expect(after2).toBe(after1); // not double-encrypted
    expect(decryptSecretValue(after2)).toBe("sk-plain-AAA");
  });

  it("refuses to run without an encryption key", async () => {
    vi.stubEnv("SECRETS_ENCRYPTION_KEY", "");
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    await expect(runMigrate()).rejects.toThrow(/encryption key/i);
    // Nothing was modified.
    expect(await rawValue("u:a@x.com:credential:OPENAI_API_KEY")).toBe(
      "sk-plain-AAA",
    );
  });
});
