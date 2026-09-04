import { symmetricEncrypt } from "better-auth/crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import {
  healUndecryptableJwks,
  isJwksDecryptError,
  resetJwksSecretRotationStateForTests,
  withJwksRotationRecovery,
} from "./jwks-secret-rotation.js";

const OLD_SECRET = "old-secret-0123456789abcdef0123456789abcdef";
const NEW_SECRET = "new-secret-fedcba9876543210fedcba9876543210";

let db: Awaited<ReturnType<typeof createTestPglite>>;
let executeCalls: number;
let currentSecret: string;

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({
    execute: async (query: { sql: string; args: unknown[] }) => {
      executeCalls += 1;
      const statement = db.prepare(query.sql);
      if (/^\s*select/i.test(query.sql)) {
        return { rows: await statement.all(...query.args), rowsAffected: 0 };
      }
      const info = await statement.run(...query.args);
      return { rows: [], rowsAffected: info.changes };
    },
  }),
}));

vi.mock("./better-auth-instance.js", () => ({
  getAuthSecret: () => currentSecret,
}));

async function insertJwksRow(
  encryptionSecret: string,
  { expiresAt = null as number | null, id = "key-1" } = {},
): Promise<void> {
  // Better Auth stores the encrypted private key JSON-encoded (a quoted
  // ciphertext string) — mirror that shape exactly.
  const ciphertext = await symmetricEncrypt({
    key: encryptionSecret,
    data: JSON.stringify({ kty: "OKP", crv: "Ed25519", d: "fake-private" }),
  });
  await db
    .prepare(
      "INSERT INTO jwks (id, public_key, private_key, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      id,
      "{}",
      JSON.stringify(ciphertext),
      Date.now(),
      expiresAt ? new Date(expiresAt).toISOString() : null,
    );
}

async function activeKeyCount(): Promise<number> {
  const row = (await db
    .prepare(
      "SELECT COUNT(*) AS n FROM jwks WHERE expires_at IS NULL OR expires_at > ?",
    )
    .get(new Date().toISOString())) as { n: number };
  return Number(row.n);
}

beforeEach(async () => {
  db = await createTestPglite();
  await db.exec(
    `CREATE TABLE jwks (
       id TEXT PRIMARY KEY,
       public_key TEXT NOT NULL,
       private_key TEXT NOT NULL,
       created_at BIGINT NOT NULL,
       expires_at TIMESTAMPTZ
     )`,
  );
  executeCalls = 0;
  currentSecret = NEW_SECRET;
  resetJwksSecretRotationStateForTests();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(async () => {
  await db.close();
  vi.restoreAllMocks();
});

describe("healUndecryptableJwks", () => {
  it("expires the active keys when the newest one no longer decrypts", async () => {
    await insertJwksRow(OLD_SECRET);
    await expect(healUndecryptableJwks()).resolves.toBe(true);
    expect(await activeKeyCount()).toBe(0);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("cannot be decrypted"),
    );
  });

  it("leaves a key that decrypts with the current secret alone", async () => {
    await insertJwksRow(NEW_SECRET);
    await expect(healUndecryptableJwks()).resolves.toBe(false);
    expect(await activeKeyCount()).toBe(1);
  });

  it("checks the newest active key, ignoring already-expired rows", async () => {
    await insertJwksRow(OLD_SECRET, { id: "expired", expiresAt: 1 });
    await insertJwksRow(NEW_SECRET, { id: "active" });
    await expect(healUndecryptableJwks()).resolves.toBe(false);
    expect(await activeKeyCount()).toBe(1);
  });

  it("does nothing when no key exists", async () => {
    await expect(healUndecryptableJwks()).resolves.toBe(false);
  });

  it("does not expire envelope-encrypted keys (multi-version secrets)", async () => {
    await db
      .prepare(
        "INSERT INTO jwks (id, public_key, private_key, created_at, expires_at) VALUES (?, ?, ?, ?, NULL)",
      )
      .run("envelope", "{}", JSON.stringify("$ba$1$deadbeef"), Date.now());
    await expect(healUndecryptableJwks()).resolves.toBe(false);
    expect(await activeKeyCount()).toBe(1);
  });

  it("does not expire keys when private-key encryption is disabled", async () => {
    await db
      .prepare(
        "INSERT INTO jwks (id, public_key, private_key, created_at, expires_at) VALUES (?, ?, ?, ?, NULL)",
      )
      .run("plain", "{}", JSON.stringify({ kty: "OKP" }), Date.now());
    await expect(healUndecryptableJwks()).resolves.toBe(false);
    expect(await activeKeyCount()).toBe(1);
  });

  it("attempts at most once per cooldown window", async () => {
    await insertJwksRow(NEW_SECRET);
    await expect(healUndecryptableJwks()).resolves.toBe(false);
    const callsAfterFirst = executeCalls;
    await expect(healUndecryptableJwks()).resolves.toBe(false);
    expect(executeCalls).toBe(callsAfterFirst);
  });
});

describe("withJwksRotationRecovery", () => {
  const decryptError = new Error(
    "Failed to decrypt private key. Make sure the secret currently in use is the same as the one used to encrypt the private key.",
  );

  function wrapHook(handler: (context: unknown) => Promise<unknown>) {
    const plugin = {
      id: "jwt",
      hooks: {
        after: [{ matcher: () => true, handler }],
      },
    };
    return withJwksRotationRecovery(plugin).hooks!.after![0];
  }

  it("recognizes Better Auth's decrypt failure", () => {
    expect(isJwksDecryptError(decryptError)).toBe(true);
    expect(isJwksDecryptError(new Error("boom"))).toBe(false);
    expect(isJwksDecryptError("Failed to decrypt private key")).toBe(false);
  });

  it("heals and retries the hook once after a decrypt failure", async () => {
    await insertJwksRow(OLD_SECRET);
    const handler = vi
      .fn()
      .mockRejectedValueOnce(decryptError)
      .mockResolvedValueOnce("retried");
    await expect(wrapHook(handler).handler({})).resolves.toBe("retried");
    expect(handler).toHaveBeenCalledTimes(2);
    expect(await activeKeyCount()).toBe(0);
  });

  it("skips the optional header instead of failing when recovery cannot help", async () => {
    await insertJwksRow(NEW_SECRET);
    const handler = vi.fn().mockRejectedValue(decryptError);
    await expect(wrapHook(handler).handler({})).resolves.toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(await activeKeyCount()).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Skipping the set-auth-jwt"),
      decryptError,
    );
  });

  it("rethrows unrelated hook failures without touching the database", async () => {
    const unrelated = new Error("connection reset");
    const handler = vi.fn().mockRejectedValue(unrelated);
    await expect(wrapHook(handler).handler({})).rejects.toBe(unrelated);
    expect(executeCalls).toBe(0);
  });

  it("returns plugins without after-hooks unchanged", () => {
    const plugin = { id: "bare" };
    expect(withJwksRotationRecovery(plugin)).toBe(plugin);
  });
});
