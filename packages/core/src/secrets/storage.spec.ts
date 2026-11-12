import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { isStoreLedgerStatement } from "../db/store-ledger.test-helpers.js";
import { decryptSharedSecretValue } from "./crypto.js";

beforeAll(async () => {
  process.env.SECRETS_ENCRYPTION_KEY = "storage-spec-encryption-key";
});

async function createPgliteExec() {
  const pglite = await createTestPglite();
  return {
    pglite,
    exec: {
      async execute(input: string | { sql: string; args?: any[] }) {
        const sql = typeof input === "string" ? input : input.sql;
        const args = typeof input === "string" ? [] : (input.args ?? []);
        if (typeof input === "string") {
          await pglite.exec(sql);
          return { rows: [], rowsAffected: 0 };
        }
        const trimmed = sql.trim().toUpperCase();
        if (trimmed.startsWith("SELECT") || /\bRETURNING\b/i.test(sql)) {
          const rows = await pglite.prepare(sql).all(...args);
          return { rows, rowsAffected: 0 };
        }
        const info = await pglite.prepare(sql).run(...args);
        return { rows: [], rowsAffected: info.changes };
      },
      transaction: <T>(run: (tx: any) => Promise<T>) => pglite.transaction(run),
    },
  };
}

async function loadStorageWithPglite() {
  const { pglite, exec } = await createPgliteExec();
  vi.doMock("../db/client.js", () => ({
    getDbExec: () => exec,
    isProductionServerlessFunctionRuntime: () => false,
    isLocalDatabase: () => true,
  }));
  const mod = await import("./storage.js");
  return { pglite, exec, mod };
}

const userRef = {
  scope: "user" as const,
  scopeId: "alice@example.test",
  key: "OPENAI_API_KEY",
};

describe("secrets storage bootstrap", () => {
  afterEach(async () => {
    vi.resetModules();
    vi.doUnmock("../db/client.js");
  });

  it("reads on the hot path without schema probes or DDL", async () => {
    const execute = vi.fn(async () => ({ rows: [] as unknown[] }));

    vi.doMock("../db/client.js", () => ({
      getDbExec: () => ({ execute }),
      isProductionServerlessFunctionRuntime: () => false,
      isLocalDatabase: () => true,
    }));

    const { readAppSecret } = await import("./storage.js");
    const ref = {
      key: "BUILDER_PRIVATE_KEY",
      scope: "user" as const,
      scopeId: "steve@example.test",
    };

    await expect(readAppSecret(ref)).resolves.toBeNull();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      sql: expect.stringMatching(
        /^SELECT encrypted_value, shared_encrypted_value/,
      ),
    });
  });

  it("bootstraps and retries once when the app_secrets table is missing", async () => {
    const execute = vi.fn(async (input: string | { sql: string }) => {
      const sql = typeof input === "string" ? input : input.sql;
      if (sql.trim().startsWith("SELECT") && execute.mock.calls.length === 1) {
        throw Object.assign(
          new Error('relation "app_secrets" does not exist'),
          {
            code: "DB_ERROR",
          },
        );
      }
      return { rows: [] as unknown[] };
    });

    vi.doMock("../db/client.js", () => ({
      getDbExec: () => ({ execute }),
      isProductionServerlessFunctionRuntime: () => false,
      isLocalDatabase: () => true,
    }));

    const { readAppSecret } = await import("./storage.js");
    await expect(readAppSecret(userRef)).resolves.toBeNull();

    const allSql = execute.mock.calls.map(([input]) =>
      typeof input === "string" ? input : input.sql,
    );
    expect(allSql[0]).toMatch(
      /^SELECT encrypted_value, shared_encrypted_value/,
    );
    expect(allSql).toContainEqual(
      expect.stringContaining("CREATE TABLE IF NOT EXISTS app_secrets"),
    );
    expect(allSql.at(-1)).toMatch(
      /^SELECT encrypted_value, shared_encrypted_value/,
    );
  });

  it("does not bootstrap for unrelated database failures", async () => {
    const execute = vi.fn(async () => {
      throw Object.assign(new Error("connection timed out"), {
        code: "ETIMEDOUT",
      });
    });

    vi.doMock("../db/client.js", () => ({
      getDbExec: () => ({ execute }),
      isProductionServerlessFunctionRuntime: () => false,
      isLocalDatabase: () => true,
    }));

    const { readAppSecret } = await import("./storage.js");
    await expect(readAppSecret(userRef)).rejects.toThrow(
      "connection timed out",
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rewrites BIGINT to BIGINT for Postgres so millisecond timestamps fit", async () => {
    const execute = vi.fn(async () => ({ rows: [] as unknown[] }));

    vi.doMock("../db/client.js", () => ({
      getDbExec: () => ({ execute }),
      isProductionServerlessFunctionRuntime: () => false,
      isLocalDatabase: () => true,
    }));

    const { writeAppSecret } = await import("./storage.js");
    await writeAppSecret({ ...userRef, value: "example-secret" });

    const allSql = execute.mock.calls
      .map((c) => {
        const input = c[0] as string | { sql: string };
        return typeof input === "string" ? input : input.sql;
      })
      .filter((sql) => !isStoreLedgerStatement(sql));
    const createSql = allSql.find((s) =>
      s.includes("CREATE TABLE IF NOT EXISTS app_secrets"),
    );
    expect(createSql).toBeDefined();
    expect(createSql).toContain("BIGINT");
    expect(createSql).not.toMatch(/\bINTEGER\b/);

    expect(allSql[0]).toMatch(/information_schema|pg_indexes/);
    expect(allSql[0]).not.toMatch(/CREATE|ALTER|DROP/i);
  });

  it("skips all DDL on Postgres when the table and columns already exist", async () => {
    const execute = vi.fn(async (input: unknown) => {
      const sql = typeof input === "string" ? input : (input as any).sql;
      if (/information_schema/i.test(String(sql))) {
        return { rows: [{ "?column?": 1 }] as unknown[] };
      }
      return { rows: [] as unknown[] };
    });

    vi.doMock("../db/client.js", () => ({
      getDbExec: () => ({ execute }),
      isProductionServerlessFunctionRuntime: () => false,
      isLocalDatabase: () => true,
    }));

    const { writeAppSecret } = await import("./storage.js");
    await writeAppSecret({ ...userRef, value: "example-secret" });

    const allSql = execute.mock.calls
      .map((c) => {
        const input = c[0] as string | { sql: string };
        return typeof input === "string" ? input : input.sql;
      })
      .filter((sql) => !isStoreLedgerStatement(sql));
    expect(allSql.some((s) => /CREATE TABLE/i.test(s))).toBe(false);
    expect(allSql.some((s) => /ALTER TABLE/i.test(s))).toBe(false);
  });
});

describe("secrets storage CRUD (real pglite)", () => {
  let pglite: Awaited<ReturnType<typeof createTestPglite>>;
  let exec: Awaited<ReturnType<typeof createPgliteExec>>["exec"];
  let mod: typeof import("./storage.js");

  beforeEach(async () => {
    const loaded = await loadStorageWithPglite();
    pglite = loaded.pglite;
    exec = loaded.exec;
    mod = loaded.mod;
  });

  afterEach(async () => {
    await pglite.close();
    vi.resetModules();
    vi.doUnmock("../db/client.js");
  });

  it("encrypts the value at rest and round-trips the plaintext", async () => {
    await mod.writeAppSecret({ ...userRef, value: "sk-live-abc12345" });

    const row = (await pglite
      .prepare(`SELECT encrypted_value FROM app_secrets`)
      .get()) as { encrypted_value: string };
    expect(row.encrypted_value).toMatch(/^v1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(row.encrypted_value).not.toContain("sk-live-abc12345");

    const read = await mod.readAppSecret(userRef);
    expect(read).not.toBeNull();
    expect(read!.value).toBe("sk-live-abc12345");
    expect(read!.last4).toBe("••••2345");
    expect(read!.updatedAt).toBeGreaterThan(0);
  });

  it("round-trips workspace secrets across app-scoped deployments", async () => {
    const originalAppName = process.env.APP_NAME; // guard:allow-env-credential — test configures deploy-level app scope.
    const originalDispatchKey = process.env.DISPATCH_SECRETS_ENCRYPTION_KEY; // guard:allow-env-credential — test configures deploy-level app encryption material.
    const originalCoachKey = process.env.COACH_SECRETS_ENCRYPTION_KEY; // guard:allow-env-credential — test configures deploy-level app encryption material.
    const originalSharedKey = process.env.SECRETS_ENCRYPTION_KEY;

    try {
      process.env.SECRETS_ENCRYPTION_KEY = "workspace-shared-material";
      process.env.DISPATCH_SECRETS_ENCRYPTION_KEY = "dispatch-only-material"; // guard:allow-env-credential — test configures deploy-level app encryption material.
      process.env.COACH_SECRETS_ENCRYPTION_KEY = "coach-only-material"; // guard:allow-env-credential — test configures deploy-level app encryption material.

      process.env.APP_NAME = "dispatch"; // guard:allow-env-credential — test switches between deploy-level app scopes.
      await mod.writeAppSecret({
        scope: "org",
        scopeId: "org_42",
        key: "ACADEMY_CONVEX_SITE_URL",
        value: "https://academy.example.test",
      });

      process.env.APP_NAME = "coach"; // guard:allow-env-credential — test switches between deploy-level app scopes.
      await expect(
        mod.readAppSecret({
          scope: "org",
          scopeId: "org_42",
          key: "ACADEMY_CONVEX_SITE_URL",
        }),
      ).resolves.toMatchObject({
        value: "https://academy.example.test",
      });
    } finally {
      if (originalAppName === undefined)
        delete process.env.APP_NAME; // guard:allow-env-credential — test restores deploy-level app scope.
      else process.env.APP_NAME = originalAppName; // guard:allow-env-credential — test restores deploy-level app scope.
      if (originalDispatchKey === undefined)
        delete process.env.DISPATCH_SECRETS_ENCRYPTION_KEY; // guard:allow-env-credential — test restores deploy-level app encryption material.
      else process.env.DISPATCH_SECRETS_ENCRYPTION_KEY = originalDispatchKey; // guard:allow-env-credential — test restores deploy-level app encryption material.
      if (originalCoachKey === undefined)
        delete process.env.COACH_SECRETS_ENCRYPTION_KEY; // guard:allow-env-credential — test restores deploy-level app encryption material.
      else process.env.COACH_SECRETS_ENCRYPTION_KEY = originalCoachKey; // guard:allow-env-credential — test restores deploy-level app encryption material.
      if (originalSharedKey === undefined)
        delete process.env.SECRETS_ENCRYPTION_KEY;
      else process.env.SECRETS_ENCRYPTION_KEY = originalSharedKey;
    }
  });

  it("round-trips workspace secrets across sibling apps on a hosted workspace deploy (A2A_SECRET-derived material)", async () => {
    const originalAppName = process.env.APP_NAME; // guard:allow-env-credential — test configures deploy-level app scope.
    const originalDispatchKey = process.env.DISPATCH_SECRETS_ENCRYPTION_KEY; // guard:allow-env-credential — test configures deploy-level app encryption material.
    const originalCoachKey = process.env.COACH_SECRETS_ENCRYPTION_KEY; // guard:allow-env-credential — test configures deploy-level app encryption material.
    const originalSharedKey = process.env.SECRETS_ENCRYPTION_KEY;
    const originalAuthSecret = process.env.BETTER_AUTH_SECRET;
    const originalWorkspace = process.env.AGENT_NATIVE_WORKSPACE;
    const originalA2ASecret = process.env.A2A_SECRET;

    try {
      delete process.env.SECRETS_ENCRYPTION_KEY;
      delete process.env.BETTER_AUTH_SECRET;
      delete process.env.AGENT_NATIVE_WORKSPACE;
      process.env.A2A_SECRET = "workspace-root";
      process.env.DISPATCH_SECRETS_ENCRYPTION_KEY = "dispatch-only-material"; // guard:allow-env-credential — test configures deploy-level app encryption material.
      process.env.COACH_SECRETS_ENCRYPTION_KEY = "coach-only-material"; // guard:allow-env-credential — test configures deploy-level app encryption material.

      process.env.APP_NAME = "dispatch"; // guard:allow-env-credential — test switches between deploy-level app scopes.
      await mod.writeAppSecret({
        scope: "org",
        scopeId: "org_42",
        key: "ACADEMY_CONVEX_SITE_URL",
        value: "https://academy.example.test",
      });

      process.env.APP_NAME = "coach"; // guard:allow-env-credential — test switches between deploy-level app scopes.
      await expect(
        mod.readAppSecret({
          scope: "org",
          scopeId: "org_42",
          key: "ACADEMY_CONVEX_SITE_URL",
        }),
      ).resolves.toMatchObject({
        value: "https://academy.example.test",
      });
    } finally {
      if (originalAppName === undefined)
        delete process.env.APP_NAME; // guard:allow-env-credential — test restores deploy-level app scope.
      else process.env.APP_NAME = originalAppName; // guard:allow-env-credential — test restores deploy-level app scope.
      if (originalDispatchKey === undefined)
        delete process.env.DISPATCH_SECRETS_ENCRYPTION_KEY; // guard:allow-env-credential — test restores deploy-level app encryption material.
      else process.env.DISPATCH_SECRETS_ENCRYPTION_KEY = originalDispatchKey; // guard:allow-env-credential — test restores deploy-level app encryption material.
      if (originalCoachKey === undefined)
        delete process.env.COACH_SECRETS_ENCRYPTION_KEY; // guard:allow-env-credential — test restores deploy-level app encryption material.
      else process.env.COACH_SECRETS_ENCRYPTION_KEY = originalCoachKey; // guard:allow-env-credential — test restores deploy-level app encryption material.
      if (originalSharedKey === undefined)
        delete process.env.SECRETS_ENCRYPTION_KEY;
      else process.env.SECRETS_ENCRYPTION_KEY = originalSharedKey;
      if (originalAuthSecret === undefined)
        delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = originalAuthSecret;
      if (originalWorkspace === undefined)
        delete process.env.AGENT_NATIVE_WORKSPACE;
      else process.env.AGENT_NATIVE_WORKSPACE = originalWorkspace;
      if (originalA2ASecret === undefined) delete process.env.A2A_SECRET;
      else process.env.A2A_SECRET = originalA2ASecret;
    }
  });

  it("migrates legacy auth-secret shared ciphertext to the A2A-derived workspace key", async () => {
    const originalAppName = process.env.APP_NAME; // guard:allow-env-credential — test configures deploy-level app scope.
    const originalSharedKey = process.env.SECRETS_ENCRYPTION_KEY;
    const originalAuthSecret = process.env.BETTER_AUTH_SECRET;
    const originalWorkspace = process.env.AGENT_NATIVE_WORKSPACE;
    const originalA2ASecret = process.env.A2A_SECRET;

    try {
      delete process.env.SECRETS_ENCRYPTION_KEY;
      delete process.env.AGENT_NATIVE_WORKSPACE;
      delete process.env.A2A_SECRET;
      delete process.env.APP_NAME; // guard:allow-env-credential — test isolates deploy-level app scope.
      process.env.BETTER_AUTH_SECRET = "dispatch-auth-secret";

      await mod.writeAppSecret({
        scope: "org",
        scopeId: "org_builder",
        key: "BUILDER_PRIVATE_KEY",
        value: "builder-private-example",
      });
      const before = (await pglite
        .prepare(
          `SELECT shared_encrypted_value, updated_at FROM app_secrets LIMIT 1`,
        )
        .get()) as {
        shared_encrypted_value: string;
        updated_at: number;
      };

      process.env.AGENT_NATIVE_WORKSPACE = "1";
      process.env.A2A_SECRET = "workspace-root-secret";
      await expect(
        mod.readAppSecret({
          scope: "org",
          scopeId: "org_builder",
          key: "BUILDER_PRIVATE_KEY",
        }),
      ).resolves.toMatchObject({ value: "builder-private-example" });

      const after = (await pglite
        .prepare(
          `SELECT shared_encrypted_value, updated_at FROM app_secrets LIMIT 1`,
        )
        .get()) as {
        shared_encrypted_value: string;
        updated_at: number;
      };
      expect(after.shared_encrypted_value).not.toBe(
        before.shared_encrypted_value,
      );
      expect(after.updated_at).toBe(before.updated_at);

      // A sibling with a different auth secret can now decrypt the migrated
      // shared column because the workspace A2A-derived key owns it.
      process.env.APP_NAME = "slides"; // guard:allow-env-credential — test switches deploy-level app scope.
      process.env.BETTER_AUTH_SECRET = "slides-auth-secret";
      await expect(
        mod.readAppSecret({
          scope: "org",
          scopeId: "org_builder",
          key: "BUILDER_PRIVATE_KEY",
        }),
      ).resolves.toMatchObject({ value: "builder-private-example" });
    } finally {
      if (originalAppName === undefined)
        delete process.env.APP_NAME; // guard:allow-env-credential — test restores deploy-level app scope.
      else process.env.APP_NAME = originalAppName; // guard:allow-env-credential — test restores deploy-level app scope.
      if (originalSharedKey === undefined)
        delete process.env.SECRETS_ENCRYPTION_KEY;
      else process.env.SECRETS_ENCRYPTION_KEY = originalSharedKey;
      if (originalAuthSecret === undefined)
        delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = originalAuthSecret;
      if (originalWorkspace === undefined)
        delete process.env.AGENT_NATIVE_WORKSPACE;
      else process.env.AGENT_NATIVE_WORKSPACE = originalWorkspace;
      if (originalA2ASecret === undefined) delete process.env.A2A_SECRET;
      else process.env.A2A_SECRET = originalA2ASecret;
    }
  });

  it("keeps app-scoped-only production deployments writable", async () => {
    const originalAppName = process.env.APP_NAME; // guard:allow-env-credential — test configures deploy-level app scope.
    const originalAppKey = process.env.ANALYTICS_SECRETS_ENCRYPTION_KEY; // guard:allow-env-credential — test configures deploy-level app encryption material.
    const originalSharedKey = process.env.SECRETS_ENCRYPTION_KEY;
    const originalWorkspaceSharedKey =
      process.env.WORKSPACE_SECRETS_ENCRYPTION_KEY;
    const originalAuthSecret = process.env.BETTER_AUTH_SECRET;
    const originalNodeEnv = process.env.NODE_ENV;

    try {
      process.env.NODE_ENV = "production";
      process.env.APP_NAME = "analytics"; // guard:allow-env-credential — test configures deploy-level app scope.
      process.env.ANALYTICS_SECRETS_ENCRYPTION_KEY = "analytics-only-material"; // guard:allow-env-credential — test configures deploy-level app encryption material.
      delete process.env.SECRETS_ENCRYPTION_KEY;
      delete process.env.WORKSPACE_SECRETS_ENCRYPTION_KEY;
      delete process.env.BETTER_AUTH_SECRET;

      await mod.writeAppSecret({
        ...userRef,
        value: "legacy-deployment-secret",
      });
      await expect(mod.readAppSecret(userRef)).resolves.toMatchObject({
        value: "legacy-deployment-secret",
      });

      const beforeMigration = (await pglite
        .prepare(
          `SELECT encrypted_value, shared_encrypted_value, updated_at FROM app_secrets`,
        )
        .get()) as {
        encrypted_value: string;
        shared_encrypted_value: string | null;
        updated_at: number;
      };
      process.env.WORKSPACE_SECRETS_ENCRYPTION_KEY =
        "new-workspace-shared-material";
      await expect(mod.readAppSecret(userRef)).resolves.toMatchObject({
        value: "legacy-deployment-secret",
      });
      const afterMigration = (await pglite
        .prepare(
          `SELECT encrypted_value, shared_encrypted_value, updated_at FROM app_secrets`,
        )
        .get()) as {
        encrypted_value: string;
        shared_encrypted_value: string | null;
        updated_at: number;
      };
      expect(afterMigration.encrypted_value).toBe(
        beforeMigration.encrypted_value,
      );
      expect(afterMigration.shared_encrypted_value).not.toBeNull();
      expect(afterMigration.updated_at).toBe(beforeMigration.updated_at);
      expect(
        decryptSharedSecretValue(afterMigration.shared_encrypted_value!),
      ).toBe("legacy-deployment-secret");

      delete process.env.WORKSPACE_SECRETS_ENCRYPTION_KEY;
      await mod.writeAppSecret({
        ...userRef,
        value: "updated-by-legacy-app",
      });
      const afterLegacyWrite = (await pglite
        .prepare(`SELECT shared_encrypted_value FROM app_secrets`)
        .get()) as { shared_encrypted_value: string | null };
      expect(afterLegacyWrite.shared_encrypted_value).toBeNull();
    } finally {
      if (originalAppName === undefined)
        delete process.env.APP_NAME; // guard:allow-env-credential — test restores deploy-level app scope.
      else process.env.APP_NAME = originalAppName; // guard:allow-env-credential — test restores deploy-level app scope.
      if (originalAppKey === undefined)
        delete process.env.ANALYTICS_SECRETS_ENCRYPTION_KEY; // guard:allow-env-credential — test restores deploy-level app encryption material.
      else process.env.ANALYTICS_SECRETS_ENCRYPTION_KEY = originalAppKey; // guard:allow-env-credential — test restores deploy-level app encryption material.
      if (originalSharedKey === undefined)
        delete process.env.SECRETS_ENCRYPTION_KEY;
      else process.env.SECRETS_ENCRYPTION_KEY = originalSharedKey;
      if (originalWorkspaceSharedKey === undefined) {
        delete process.env.WORKSPACE_SECRETS_ENCRYPTION_KEY;
      } else {
        process.env.WORKSPACE_SECRETS_ENCRYPTION_KEY =
          originalWorkspaceSharedKey;
      }
      if (originalAuthSecret === undefined)
        delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = originalAuthSecret;
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("stops serving stale shared ciphertext after a material-less update (post-rotation)", async () => {
    const originalAppName = process.env.APP_NAME; // guard:allow-env-credential — test configures deploy-level app scope.
    const originalAppKey = process.env.ROTATION_SECRETS_ENCRYPTION_KEY; // guard:allow-env-credential — test configures deploy-level app encryption material.
    const originalSharedKey = process.env.SECRETS_ENCRYPTION_KEY;
    const originalAuthSecret = process.env.BETTER_AUTH_SECRET;

    try {
      process.env.APP_NAME = "rotation"; // guard:allow-env-credential — test configures deploy-level app scope.
      // guard:allow-env-credential — test configures deploy-level app encryption material.
      process.env.ROTATION_SECRETS_ENCRYPTION_KEY = "rotation-app-material";

      process.env.SECRETS_ENCRYPTION_KEY = "rotation-shared-material";
      await mod.writeAppSecret({ ...userRef, value: "original-secret-value" });
      const original = (await pglite
        .prepare(`SELECT shared_encrypted_value FROM app_secrets`)
        .get()) as { shared_encrypted_value: string | null };
      expect(original.shared_encrypted_value).not.toBeNull();

      delete process.env.SECRETS_ENCRYPTION_KEY;
      delete process.env.BETTER_AUTH_SECRET;
      await mod.writeAppSecret({ ...userRef, value: "rotated-secret-value" });
      const afterRotationWrite = (await pglite
        .prepare(`SELECT shared_encrypted_value FROM app_secrets`)
        .get()) as { shared_encrypted_value: string | null };
      expect(afterRotationWrite.shared_encrypted_value).toBeNull();

      process.env.SECRETS_ENCRYPTION_KEY = "rotation-shared-material";
      const read = await mod.readAppSecret(userRef);
      expect(read).not.toBeNull();
      expect(read!.value).not.toBe("original-secret-value");
      expect(read!.value).toBe("rotated-secret-value");
    } finally {
      if (originalAppName === undefined)
        delete process.env.APP_NAME; // guard:allow-env-credential — test restores deploy-level app scope.
      else process.env.APP_NAME = originalAppName; // guard:allow-env-credential — test restores deploy-level app scope.
      if (originalAppKey === undefined)
        delete process.env.ROTATION_SECRETS_ENCRYPTION_KEY; // guard:allow-env-credential — test restores deploy-level app encryption material.
      else process.env.ROTATION_SECRETS_ENCRYPTION_KEY = originalAppKey; // guard:allow-env-credential — test restores deploy-level app encryption material.
      if (originalSharedKey === undefined)
        delete process.env.SECRETS_ENCRYPTION_KEY;
      else process.env.SECRETS_ENCRYPTION_KEY = originalSharedKey;
      if (originalAuthSecret === undefined)
        delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = originalAuthSecret;
    }
  });

  it("reads several scoped secrets in one projected query", async () => {
    await mod.writeAppSecret({ ...userRef, value: "openai-example" });
    await mod.writeAppSecret({
      ...userRef,
      key: "BUILDER_PRIVATE_KEY",
      value: "builder-private-example",
    });
    await mod.writeAppSecret({
      ...userRef,
      scopeId: "bob@example.test",
      value: "other-user-example",
    });

    const secrets = await mod.readAppSecrets({
      keys: ["OPENAI_API_KEY", "BUILDER_PRIVATE_KEY", "MISSING_KEY"],
      scope: "user",
      scopeId: userRef.scopeId,
    });

    expect([...secrets.keys()].sort()).toEqual([
      "BUILDER_PRIVATE_KEY",
      "OPENAI_API_KEY",
    ]);
    expect(secrets.get("OPENAI_API_KEY")?.value).toBe("openai-example");
    expect(secrets.get("BUILDER_PRIVATE_KEY")?.value).toBe(
      "builder-private-example",
    );
    expect(secrets.has("MISSING_KEY")).toBe(false);
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

    const { count } = (await pglite
      .prepare(`SELECT COUNT(*) as count FROM app_secrets`)
      .get()) as { count: number };
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

    expect(secondId).toBe(firstId);

    const { count } = (await pglite
      .prepare(`SELECT COUNT(*) as count FROM app_secrets`)
      .get()) as { count: number };
    expect(count).toBe(1);

    const read = await mod.readAppSecret(userRef);
    expect(read!.value).toBe("second-value-9999");

    const meta = await mod.readAppSecretMeta(userRef);
    expect(meta!.description).toBe("updated");
    expect(meta!.urlAllowlist).toEqual(["https://api.openai.com"]);

    await mod.writeAppSecret({ ...userRef, value: "rotated-value" });
    expect((await mod.readAppSecretMeta(userRef))!.urlAllowlist).toEqual([
      "https://api.openai.com",
    ]);
  });

  it("approves origins without changing either ciphertext or the saved scope", async () => {
    await mod.writeAppSecret({
      ...userRef,
      value: "fake-value",
      urlAllowlist: "[]",
    });
    const { validateUrlAllowlist } = await import("./substitution.js");
    expect(
      validateUrlAllowlist(
        "https://api.example.test/data",
        (await mod.readAppSecretMeta(userRef))?.urlAllowlist ?? null,
      ),
    ).toBe(false);
    const before = await pglite
      .prepare(
        `SELECT scope, scope_id, encrypted_value, shared_encrypted_value FROM app_secrets WHERE key = ?`,
      )
      .get(userRef.key);

    expect(
      await mod.updateAppSecretUrlAllowlist(userRef, [
        "https://api.example.test",
      ]),
    ).toBe(true);
    const after = await pglite
      .prepare(
        `SELECT scope, scope_id, encrypted_value, shared_encrypted_value, url_allowlist FROM app_secrets WHERE key = ?`,
      )
      .get(userRef.key);
    expect(after).toMatchObject({
      ...before,
      url_allowlist: '["https://api.example.test"]',
    });
    expect(
      validateUrlAllowlist(
        "https://api.example.test/data",
        (await mod.readAppSecretMeta(userRef))?.urlAllowlist ?? null,
      ),
    ).toBe(true);
    expect(
      validateUrlAllowlist(
        "https://other.example.test/data",
        (await mod.readAppSecretMeta(userRef))?.urlAllowlist ?? null,
      ),
    ).toBe(false);
    expect(
      await mod.updateAppSecretUrlAllowlist(
        { ...userRef, scopeId: "other@example.test" },
        [],
      ),
    ).toBe(false);
    expect((await mod.readAppSecret(userRef))?.value).toBe("fake-value");
  });

  it("handles concurrent writes to the same key without throwing (atomic upsert)", async () => {
    // Regression test for the SELECT-then-branch race: two writers for the
    // same (scope, scope_id, key) used to both see "no row" and both
    // attempt INSERT, and the loser threw a raw UNIQUE constraint
    // violation. The atomic `INSERT ... ON CONFLICT DO UPDATE` closes that
    // window — both calls must resolve without throwing and settle to a
    // single row that keeps a stable id.
    const [firstId, secondId] = await Promise.all([
      mod.writeAppSecret({ ...userRef, value: "concurrent-value-aaaa" }),
      mod.writeAppSecret({ ...userRef, value: "concurrent-value-bbbb" }),
    ]);
    expect(firstId).toBe(secondId);

    const { count } = (await pglite
      .prepare(`SELECT COUNT(*) as count FROM app_secrets`)
      .get()) as { count: number };
    expect(count).toBe(1);

    const read = await mod.readAppSecret(userRef);
    expect(read).not.toBeNull();
    expect(["concurrent-value-aaaa", "concurrent-value-bbbb"]).toContain(
      read!.value,
    );
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

  it("keeps an undecryptable row distinct from an absent secret and doesn't cache it as missing", async () => {
    await mod.writeAppSecret({ ...userRef, value: "tamperable" });
    await pglite
      .prepare(
        `UPDATE app_secrets SET encrypted_value = ?, shared_encrypted_value = ?`,
      )
      .run("v1:dead:beef:cafe", "v1:dead:beef:cafe");

    const { runWithRequestContext } =
      await import("../server/request-context.js");
    await runWithRequestContext({}, async () => {
      const batchRead = () =>
        mod.readAppSecrets({
          keys: [userRef.key],
          scope: userRef.scope,
          scopeId: userRef.scopeId,
        });
      await expect(batchRead()).rejects.toMatchObject({
        name: "AppSecretDecryptionError",
        errorCode: "app_secret_unreadable",
        scope: userRef.scope,
        scopeId: userRef.scopeId,
      });
      await expect(mod.readAppSecret(userRef)).rejects.toMatchObject({
        name: "AppSecretDecryptionError",
        errorCode: "app_secret_unreadable",
        scope: userRef.scope,
        scopeId: userRef.scopeId,
      });
    });

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

  it("readAppSecretMeta parses a valid allowlist and rejects malformed policy", async () => {
    await mod.writeAppSecret({
      ...userRef,
      value: "v",
      urlAllowlist: JSON.stringify(["https://a.test", "https://b.test"]),
    });
    expect((await mod.readAppSecretMeta(userRef))!.urlAllowlist).toEqual([
      "https://a.test",
      "https://b.test",
    ]);

    await pglite
      .prepare(`UPDATE app_secrets SET url_allowlist = ?`)
      .run("{not json");
    await expect(mod.readAppSecretMeta(userRef)).rejects.toThrow(
      "Stored secret URL policy is unreadable",
    );

    await pglite
      .prepare(`UPDATE app_secrets SET url_allowlist = ?`)
      .run(JSON.stringify([1, 2, 3]));
    await expect(mod.readAppSecretMeta(userRef)).rejects.toThrow(
      "Stored secret URL policy is invalid",
    );
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

    await pglite
      .prepare(
        `UPDATE app_secrets SET updated_at = ? WHERE scope_id = ? AND key = ?`,
      )
      .run(Date.now() + 10_000, "alice@example.test", "SECOND_KEY");

    const list = await mod.listAppSecretsForScope("user", "alice@example.test");
    expect(list.map((s) => s.key).sort()).toEqual(["FIRST_KEY", "SECOND_KEY"]);
    expect(list[0].key).toBe("SECOND_KEY");
    expect(list[0].description).toBe("second");
    const serialized = JSON.stringify(list);
    expect(serialized).not.toContain("first-secret-1111");
    expect(serialized).not.toContain("second-secret-2222");
    expect(serialized).not.toContain("bob-secret");
    expect(list.find((s) => s.key === "FIRST_KEY")!.last4).toBe("••••1111");
  });

  it("deleteAppSecret reports whether a row was removed", async () => {
    await mod.writeAppSecret({ ...userRef, value: "to-delete" });
    expect(await mod.deleteAppSecret(userRef)).toBe(true);
    expect(await mod.readAppSecret(userRef)).toBeNull();
    expect(await mod.deleteAppSecret(userRef)).toBe(false);
  });

  it("deletes a secret only while its ciphertext version is unchanged", async () => {
    await mod.writeAppSecret({ ...userRef, value: "original-value" });
    const originalVersion = await mod.readAppSecretVersion(userRef);
    expect(originalVersion).toBeTruthy();

    await mod.writeAppSecret({ ...userRef, value: "rotated-value" });
    await expect(
      mod.deleteAppSecretIfVersion(userRef, originalVersion!),
    ).resolves.toBe(false);
    await expect(mod.readAppSecret(userRef)).resolves.toMatchObject({
      value: "rotated-value",
    });

    const currentVersion = await mod.readAppSecretVersion(userRef);
    expect(currentVersion).toBeTruthy();
    await expect(
      mod.deleteAppSecretIfVersion(userRef, currentVersion!),
    ).resolves.toBe(true);
    await expect(mod.readAppSecret(userRef)).resolves.toBeNull();
  });

  it("rolls back a batch when a later confirmed secret changes during deletion", async () => {
    const secondRef = { ...userRef, key: "SLACK_BOT_TOKEN" };
    await mod.writeAppSecret({ ...userRef, value: "original-first" });
    await mod.writeAppSecret({ ...secondRef, value: "original-second" });
    const firstVersion = await mod.readAppSecretVersion(userRef);
    const secondVersion = await mod.readAppSecretVersion(secondRef);
    expect(firstVersion).toBeTruthy();
    expect(secondVersion).toBeTruthy();

    exec.transaction = (run) =>
      pglite.transaction(async (tx) => {
        let deleteCount = 0;
        return run({
          execute: async (input: string | { sql: string; args?: any[] }) => {
            const sql = typeof input === "string" ? input : input.sql;
            if (sql.startsWith("DELETE FROM app_secrets")) {
              deleteCount += 1;
              if (deleteCount === 2) return { rows: [], rowsAffected: 0 };
            }
            return tx.execute(input);
          },
        });
      });

    await expect(
      mod.deleteAppSecretsIfVersions([
        { ref: userRef, expectedVersion: firstVersion! },
        { ref: secondRef, expectedVersion: secondVersion! },
      ]),
    ).resolves.toBe(false);
    const remaining = await pglite.query(
      "SELECT key FROM app_secrets WHERE scope = ? AND scope_id = ? ORDER BY key",
      [userRef.scope, userRef.scopeId],
    );
    expect(remaining.rows.map((row) => row.key)).toEqual([
      "OPENAI_API_KEY",
      "SLACK_BOT_TOKEN",
    ]);
  });

  it("keeps a confirmed batch intact when one secret has rotated", async () => {
    const first = { ...userRef, key: "FIRST_KEY" };
    const second = { ...userRef, key: "SECOND_KEY" };
    await mod.writeAppSecret({ ...first, value: "first-original-value" });
    await mod.writeAppSecret({ ...second, value: "second-original-value" });
    const firstVersion = await mod.readAppSecretVersion(first);
    const secondVersion = await mod.readAppSecretVersion(second);
    expect(firstVersion).toBeTruthy();
    expect(secondVersion).toBeTruthy();

    await mod.writeAppSecret({ ...second, value: "second-rotated-value" });
    await expect(
      mod.deleteAppSecretsIfVersions([
        { ref: first, expectedVersion: firstVersion! },
        { ref: second, expectedVersion: secondVersion! },
      ]),
    ).resolves.toBe(false);
    await expect(mod.readAppSecret(first)).resolves.toMatchObject({
      value: "first-original-value",
    });
    await expect(mod.readAppSecret(second)).resolves.toMatchObject({
      value: "second-rotated-value",
    });

    const currentSecondVersion = await mod.readAppSecretVersion(second);
    await expect(
      mod.deleteAppSecretsIfVersions([
        { ref: first, expectedVersion: firstVersion! },
        { ref: second, expectedVersion: currentSecondVersion! },
      ]),
    ).resolves.toBe(true);
    await expect(mod.readAppSecret(first)).resolves.toBeNull();
    await expect(mod.readAppSecret(second)).resolves.toBeNull();
  });
});

describe("last4 preview", () => {
  let mod: typeof import("./storage.js");
  beforeEach(async () => {
    ({ mod } = await loadStorageWithPglite());
  });
  afterEach(async () => {
    vi.resetModules();
    vi.doUnmock("../db/client.js");
  });

  it("masks all but the trailing 4 characters and never reveals short values", () => {
    expect(mod.last4("")).toBe("");
    expect(mod.last4("ab")).toBe("••••");
    expect(mod.last4("abcd")).toBe("••••");
    expect(mod.last4("abcde")).toBe("••••bcde");
    expect(mod.last4("sk-live-1234567890")).toBe("••••7890");
  });
});

describe("per-request read memo", () => {
  let mod: typeof import("./storage.js");
  let selects: string[];
  let runWithRequestContext: typeof import("../server/request-context.js").runWithRequestContext;

  beforeEach(async () => {
    const { pglite } = await createPgliteExec();
    selects = [];
    vi.doMock("../db/client.js", () => ({
      isProductionServerlessFunctionRuntime: () => false,
      isLocalDatabase: () => true,
      getDbExec: () => ({
        async execute(input: string | { sql: string; args?: any[] }) {
          const sql = typeof input === "string" ? input : input.sql;
          const args = typeof input === "string" ? [] : (input.args ?? []);
          if (typeof input === "string") {
            await pglite.exec(sql);
            return { rows: [], rowsAffected: 0 };
          }
          if (sql.trim().toUpperCase().startsWith("SELECT")) {
            selects.push(sql);
            return {
              rows: await pglite.prepare(sql).all(...args),
              rowsAffected: 0,
            };
          }
          const info = await pglite.prepare(sql).run(...args);
          return { rows: [], rowsAffected: info.changes };
        },
      }),
    }));
    mod = await import("./storage.js");
    ({ runWithRequestContext } = await import("../server/request-context.js"));
  });

  afterEach(async () => {
    vi.resetModules();
    vi.doUnmock("../db/client.js");
  });

  it("reads a secret once per request and re-reads in the next request", async () => {
    await runWithRequestContext({ userEmail: "alice@example.test" }, () =>
      mod.writeAppSecret({ ...userRef, key: "API_KEY", value: "sk-live-1111" }),
    );

    const first = await runWithRequestContext(
      { userEmail: "alice@example.test" },
      async () => {
        selects.length = 0;
        const a = await mod.readAppSecret({ ...userRef, key: "API_KEY" });
        const b = await mod.readAppSecret({ ...userRef, key: "API_KEY" });
        return { a, b, reads: selects.length };
      },
    );
    expect(first.a?.value).toBe("sk-live-1111");
    expect(first.b?.value).toBe("sk-live-1111");
    expect(first.reads).toBe(1);

    const second = await runWithRequestContext(
      { userEmail: "alice@example.test" },
      async () => {
        selects.length = 0;
        await mod.readAppSecret({ ...userRef, key: "API_KEY" });
        return selects.length;
      },
    );
    expect(second).toBe(1);
  });

  it("keys the memo on scope and scopeId so one caller never answers for another", async () => {
    await mod.writeAppSecret({
      scope: "user",
      scopeId: "alice@example.test",
      key: "API_KEY",
      value: "alice-secret",
    });
    await mod.writeAppSecret({
      scope: "user",
      scopeId: "bob@example.test",
      key: "API_KEY",
      value: "bob-secret",
    });

    await runWithRequestContext({}, async () => {
      const alice = await mod.readAppSecret({
        scope: "user",
        scopeId: "alice@example.test",
        key: "API_KEY",
      });
      const bob = await mod.readAppSecret({
        scope: "user",
        scopeId: "bob@example.test",
        key: "API_KEY",
      });
      expect(alice?.value).toBe("alice-secret");
      expect(bob?.value).toBe("bob-secret");
    });
  });

  it("writes and deletes in the same request are visible to later reads", async () => {
    await runWithRequestContext({}, async () => {
      expect(
        await mod.readAppSecret({ ...userRef, key: "ROTATED" }),
      ).toBeNull();
      await mod.writeAppSecret({
        ...userRef,
        key: "ROTATED",
        value: "v1-abcd",
      });
      expect(
        (await mod.readAppSecret({ ...userRef, key: "ROTATED" }))?.value,
      ).toBe("v1-abcd");
      await mod.writeAppSecret({
        ...userRef,
        key: "ROTATED",
        value: "v2-wxyz",
      });
      expect(
        (await mod.readAppSecret({ ...userRef, key: "ROTATED" }))?.value,
      ).toBe("v2-wxyz");
      await mod.deleteAppSecret({ ...userRef, key: "ROTATED" });
      expect(
        await mod.readAppSecret({ ...userRef, key: "ROTATED" }),
      ).toBeNull();
    });
  });

  it("lets a batch read prime single-key reads, including known-absent keys", async () => {
    await mod.writeAppSecret({
      ...userRef,
      key: "PRESENT",
      value: "here-1234",
    });

    const reads = await runWithRequestContext({}, async () => {
      await mod.readAppSecrets({
        keys: ["PRESENT", "ABSENT"],
        scope: userRef.scope,
        scopeId: userRef.scopeId,
      });
      selects.length = 0;
      const present = await mod.readAppSecret({ ...userRef, key: "PRESENT" });
      const absent = await mod.readAppSecret({ ...userRef, key: "ABSENT" });
      expect(present?.value).toBe("here-1234");
      expect(absent).toBeNull();
      return selects.length;
    });
    expect(reads).toBe(0);
  });
});

describe("development process on a shared database", () => {
  let pglite: Awaited<ReturnType<typeof createTestPglite>>;
  let mod: typeof import("./storage.js");
  let localDatabase: boolean;
  let databaseUrl: string;

  const orgRef = {
    scope: "org" as const,
    scopeId: "org_shared",
    key: "ANTHROPIC_API_KEY",
  };

  function useDeploymentKeys() {
    vi.stubEnv("WORKSPACE_SECRETS_ENCRYPTION_KEY", "deployment-workspace-key");
    vi.stubEnv("SECRETS_ENCRYPTION_KEY", "deployment-app-key");
  }

  function useDevelopmentKeys() {
    vi.stubEnv("WORKSPACE_SECRETS_ENCRYPTION_KEY", undefined);
    vi.stubEnv("SECRETS_ENCRYPTION_KEY", "development-app-key");
  }

  async function storedRow() {
    return (await pglite
      .prepare(
        `SELECT encrypted_value, shared_encrypted_value FROM app_secrets WHERE key = ?`,
      )
      .get(orgRef.key)) as {
      encrypted_value: string;
      shared_encrypted_value: string | null;
    };
  }

  beforeEach(async () => {
    localDatabase = false;
    databaseUrl = "postgres://app@db.example.test:5432/shared";
    for (const marker of [
      "NETLIFY_FUNCTION_NAME",
      "AWS_LAMBDA_FUNCTION_NAME",
      "LAMBDA_TASK_ROOT",
      "AWS_EXECUTION_ENV",
      "VERCEL_FUNCTION_ID",
      "VERCEL_REGION",
    ]) {
      vi.stubEnv(marker, undefined);
    }
    const { pglite: db, exec } = await createPgliteExec();
    pglite = db;
    vi.doMock("../db/client.js", () => ({
      getDbExec: () => exec,
      getRuntimeDatabaseUrl: () => databaseUrl,
      isProductionServerlessFunctionRuntime: () => false,
      isLocalDatabase: () => localDatabase,
    }));
    mod = await import("./storage.js");
  });

  afterEach(async () => {
    await pglite.close();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("../db/client.js");
  });

  it("refuses to overwrite a row encrypted with key material it does not have", async () => {
    useDeploymentKeys();
    await mod.writeAppSecret({ ...orgRef, value: "deployment-value" });
    const before = await storedRow();

    useDevelopmentKeys();
    await expect(
      mod.writeAppSecret({ ...orgRef, value: "development-value" }),
    ).rejects.toBeInstanceOf(mod.AppSecretKeyMismatchError);

    expect(await storedRow()).toEqual(before);
    useDeploymentKeys();
    await expect(mod.readAppSecret(orgRef)).resolves.toMatchObject({
      value: "deployment-value",
    });
  });

  it("refuses a new key when the scope's secrets use other key material", async () => {
    useDeploymentKeys();
    await mod.writeAppSecret({ ...orgRef, value: "deployment-value" });

    useDevelopmentKeys();
    await expect(
      mod.writeAppSecret({
        ...orgRef,
        key: "OPENAI_API_KEY",
        value: "development-value",
      }),
    ).rejects.toBeInstanceOf(mod.AppSecretKeyMismatchError);
  });

  it("refuses when stored secrets only decrypt with a fallback key", async () => {
    useDeploymentKeys();
    await mod.writeAppSecret({ ...orgRef, value: "deployment-value" });

    vi.stubEnv("WORKSPACE_SECRETS_ENCRYPTION_KEY", "development-workspace-key");
    vi.stubEnv(
      "WORKSPACE_SECRETS_ENCRYPTION_KEY_PREVIOUS",
      "deployment-workspace-key",
    );
    await expect(
      mod.writeAppSecret({ ...orgRef, value: "development-value" }),
    ).rejects.toBeInstanceOf(mod.AppSecretKeyMismatchError);
  });

  describe("rows without shared ciphertext", () => {
    function useAppScopedKeyOnly(appName: string, key: string) {
      for (const name of [
        "WORKSPACE_SECRETS_ENCRYPTION_KEY",
        "SECRETS_ENCRYPTION_KEY",
        "BETTER_AUTH_SECRET",
        "A2A_SECRET",
        "AGENT_NATIVE_WORKSPACE",
      ]) {
        vi.stubEnv(name, undefined);
      }
      vi.stubEnv("APP_NAME", appName);
      vi.stubEnv(`${appName.toUpperCase()}_SECRETS_ENCRYPTION_KEY`, key);
    }

    beforeEach(async () => {
      useAppScopedKeyOnly("deployed", "deployment-app-scoped-key");
      await mod.writeAppSecret({ ...orgRef, value: "deployment-value" });
      expect((await storedRow()).shared_encrypted_value).toBeNull();
      useAppScopedKeyOnly("local", "development-app-scoped-key");
    });

    it("refuses to overwrite one written with another app key", async () => {
      await expect(
        mod.writeAppSecret({ ...orgRef, value: "development-value" }),
      ).rejects.toBeInstanceOf(mod.AppSecretKeyMismatchError);
    });

    it("checks a new key against them", async () => {
      await expect(
        mod.writeAppSecret({
          ...orgRef,
          key: "OPENAI_API_KEY",
          value: "development-value",
        }),
      ).rejects.toBeInstanceOf(mod.AppSecretKeyMismatchError);
    });
  });

  it("refuses a new key when any secret in the scope uses other key material", async () => {
    useDevelopmentKeys();
    await mod.writeAppSecret({ ...orgRef, value: "development-value" });

    useDeploymentKeys();
    vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "deployed-function");
    await mod.writeAppSecret({
      ...orgRef,
      key: "OPENAI_API_KEY",
      value: "deployment-value",
    });

    useDevelopmentKeys();
    vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", undefined);
    await expect(
      mod.writeAppSecret({
        ...orgRef,
        key: "BUILDER_PRIVATE_KEY",
        value: "development-value",
      }),
    ).rejects.toBeInstanceOf(mod.AppSecretKeyMismatchError);
  });

  it("writes when the scope's secrets use its preferred key", async () => {
    useDevelopmentKeys();
    await mod.writeAppSecret({ ...orgRef, value: "first-value" });
    await mod.writeAppSecret({ ...orgRef, value: "second-value" });
    await mod.writeAppSecret({
      ...orgRef,
      key: "OPENAI_API_KEY",
      value: "other-value",
    });

    await expect(mod.readAppSecret(orgRef)).resolves.toMatchObject({
      value: "second-value",
    });
  });

  it("lets a deployment repair rows a mismatched process wrote", async () => {
    useDevelopmentKeys();
    await mod.writeAppSecret({ ...orgRef, value: "stranded-value" });

    useDeploymentKeys();
    vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "deployed-function");
    await mod.writeAppSecret({ ...orgRef, value: "repaired-value" });

    await expect(mod.readAppSecret(orgRef)).resolves.toMatchObject({
      value: "repaired-value",
    });
  });

  it.each([
    ["PGlite", true, "pglite:./data/pglite"],
    ["loopback Postgres", false, "postgres://app@localhost:5432/dev"],
  ])(
    "allows overwrites against a local %s database",
    async (_label, isPglite, url) => {
      localDatabase = isPglite;
      databaseUrl = url;
      useDeploymentKeys();
      await mod.writeAppSecret({ ...orgRef, value: "old-local-value" });

      useDevelopmentKeys();
      await mod.writeAppSecret({ ...orgRef, value: "new-local-value" });

      await expect(mod.readAppSecret(orgRef)).resolves.toMatchObject({
        value: "new-local-value",
      });
    },
  );

  it("does not re-encrypt shared ciphertext after a fallback read", async () => {
    vi.stubEnv("WORKSPACE_SECRETS_ENCRYPTION_KEY", undefined);
    vi.stubEnv("SECRETS_ENCRYPTION_KEY", "shared-fallback-key");
    await mod.writeAppSecret({ ...orgRef, value: "fallback-value" });
    const before = await storedRow();

    vi.stubEnv("WORKSPACE_SECRETS_ENCRYPTION_KEY", "development-workspace-key");
    await expect(mod.readAppSecret(orgRef)).resolves.toMatchObject({
      value: "fallback-value",
    });

    expect(await storedRow()).toEqual(before);
  });

  it("warns once, without the value, when a stored secret cannot be decrypted", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    useDeploymentKeys();
    await mod.writeAppSecret({ ...orgRef, value: "deployment-value" });

    useDevelopmentKeys();
    await expect(mod.readAppSecret(orgRef)).rejects.toMatchObject({
      name: "AppSecretDecryptionError",
      errorCode: "app_secret_unreadable",
      scope: orgRef.scope,
      scopeId: orgRef.scopeId,
    });
    await expect(
      mod.readAppSecrets({
        keys: [orgRef.key],
        scope: orgRef.scope,
        scopeId: orgRef.scopeId,
      }),
    ).rejects.toMatchObject({
      name: "AppSecretDecryptionError",
      errorCode: "app_secret_unreadable",
      scope: orgRef.scope,
      scopeId: orgRef.scopeId,
    });

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain(orgRef.key);
    expect(message).not.toContain("deployment-value");
    expect(message).not.toContain(orgRef.scopeId);
  });

  it("remembers, for the request, keys it couldn't decrypt", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runWithRequestContext } =
      await import("../server/request-context.js");
    useDeploymentKeys();
    await mod.writeAppSecret({ ...orgRef, value: "deployment-value" });

    useDevelopmentKeys();
    const seen = await runWithRequestContext(
      { userEmail: "alice@example.test" },
      async () => {
        await expect(
          mod.readAppSecrets({
            keys: [orgRef.key],
            scope: orgRef.scope,
            scopeId: orgRef.scopeId,
          }),
        ).rejects.toMatchObject({ name: "AppSecretDecryptionError" });
        return [...mod.undecryptableSecretKeysForRequest()];
      },
    );
    expect(seen).toEqual([orgRef.key]);
    await expect(
      runWithRequestContext({ userEmail: "alice@example.test" }, async () => [
        ...mod.undecryptableSecretKeysForRequest(),
      ]),
    ).resolves.toEqual([]);
  });
});

describe("Vault metadata on app_secrets (real pglite)", () => {
  let pglite: Awaited<ReturnType<typeof createTestPglite>>;
  let mod: typeof import("./storage.js");

  const orgScope = { scope: "org" as const, scopeId: "org_vault" };
  const otherOrgScope = { scope: "org" as const, scopeId: "org_other" };
  const keyRef = (key: string) => ({ ...orgScope, key });
  const ciphertextOf = async (key: string) =>
    pglite
      .prepare(
        `SELECT encrypted_value, shared_encrypted_value FROM app_secrets WHERE scope_id = ? AND key = ?`,
      )
      .get(orgScope.scopeId, key);

  beforeEach(async () => {
    const loaded = await loadStorageWithPglite();
    pglite = loaded.pglite;
    mod = loaded.mod;
  });

  afterEach(async () => {
    await pglite.close();
    vi.resetModules();
    vi.doUnmock("../db/client.js");
  });

  it("stores the label, provider and creator beside the encrypted value", async () => {
    const id = await mod.writeAppSecret({
      ...keyRef("FAKE_PROVIDER_KEY"),
      value: "fake-value-1111",
      label: "Fake provider key",
      provider: "other",
      createdBy: "admin@example.test",
    });

    expect(
      await mod.readAppSecretMeta(keyRef("FAKE_PROVIDER_KEY")),
    ).toMatchObject({
      id,
      label: "Fake provider key",
      provider: "other",
      createdBy: "admin@example.test",
      last4: "••••1111",
    });
    const row = await pglite.prepare(`SELECT * FROM app_secrets`).get();
    expect(JSON.stringify(row)).not.toContain("fake-value-1111");
  });

  it("leaves metadata alone for a writer that passes none, and keeps the first creator", async () => {
    await mod.writeAppSecret({
      ...keyRef("FAKE_PROVIDER_KEY"),
      value: "fake-value-1111",
      label: "Fake provider key",
      provider: "other",
      createdBy: "first@example.test",
    });

    await mod.writeAppSecret({
      ...keyRef("FAKE_PROVIDER_KEY"),
      value: "fake-value-2222",
    });
    expect(
      await mod.readAppSecretMeta(keyRef("FAKE_PROVIDER_KEY")),
    ).toMatchObject({
      label: "Fake provider key",
      provider: "other",
      createdBy: "first@example.test",
      last4: "••••2222",
    });

    await mod.writeAppSecret({
      ...keyRef("FAKE_PROVIDER_KEY"),
      value: "fake-value-3333",
      label: "Renamed label",
      createdBy: "second@example.test",
    });
    expect(
      await mod.readAppSecretMeta(keyRef("FAKE_PROVIDER_KEY")),
    ).toMatchObject({
      label: "Renamed label",
      provider: "other",
      createdBy: "first@example.test",
    });
  });

  it("gives an app-registered key no creator", async () => {
    await mod.writeAppSecret({ ...keyRef("APP_KEY"), value: "fake-value" });

    expect(await mod.readAppSecretMeta(keyRef("APP_KEY"))).toMatchObject({
      label: null,
      provider: null,
      createdBy: null,
    });
  });

  it("lists a scope's keys without decrypting any of them", async () => {
    await mod.writeAppSecret({
      ...keyRef("READABLE_KEY"),
      value: "fake-value",
      label: "Readable",
    });
    await mod.writeAppSecret({ ...keyRef("BROKEN_KEY"), value: "fake-value" });
    await mod.writeAppSecret({
      ...otherOrgScope,
      key: "OTHER_ORG_KEY",
      value: "fake-value",
    });
    await pglite
      .prepare(
        `UPDATE app_secrets SET encrypted_value = 'not-a-ciphertext', shared_encrypted_value = NULL WHERE key = ?`,
      )
      .run("BROKEN_KEY");

    const summaries = await mod.listAppSecretSummaries(
      orgScope.scope,
      orgScope.scopeId,
    );

    expect(summaries.map((row) => row.key).sort()).toEqual([
      "BROKEN_KEY",
      "READABLE_KEY",
    ]);
    expect(summaries.find((row) => row.key === "READABLE_KEY")).toMatchObject({
      label: "Readable",
      scope: "org",
      scopeId: "org_vault",
    });
    expect(JSON.stringify(summaries)).not.toContain("encrypted");
    const withPreviews = await mod.listAppSecretsForScope(
      orgScope.scope,
      orgScope.scopeId,
    );
    expect(withPreviews.find((row) => row.key === "BROKEN_KEY")?.last4).toBe(
      "",
    );
  });

  it("reads a key by id only inside the scope that holds it", async () => {
    const id = await mod.writeAppSecret({
      ...keyRef("FAKE_PROVIDER_KEY"),
      value: "fake-value-1111",
    });

    expect(await mod.readAppSecretMetaById({ id, ...orgScope })).toMatchObject({
      key: "FAKE_PROVIDER_KEY",
      last4: "••••1111",
    });
    expect(
      await mod.readAppSecretMetaById({ id, ...otherOrgScope }),
    ).toBeNull();
    expect(
      await mod.readAppSecretMetaById({ id: "missing", ...orgScope }),
    ).toBeNull();
  });

  describe("updateAppSecretById", () => {
    const seed = async () =>
      mod.writeAppSecret({
        ...keyRef("OLD_KEY"),
        value: "fake-value-1111",
        label: "Old label",
        provider: "other",
        description: "Old description",
        createdBy: "creator@example.test",
      });

    it("renames a key in place, keeping its id, ciphertext and creator", async () => {
      const id = await seed();
      const before = await ciphertextOf("OLD_KEY");

      const result = await mod.updateAppSecretById(
        { id, ...orgScope },
        { key: "NEW_KEY", adoptedBy: "editor@example.test" },
      );

      expect(result).toEqual({ key: "NEW_KEY", previousKey: "OLD_KEY" });
      expect(await ciphertextOf("NEW_KEY")).toEqual(before);
      expect(await mod.readAppSecret(keyRef("OLD_KEY"))).toBeNull();
      expect((await mod.readAppSecret(keyRef("NEW_KEY")))?.value).toBe(
        "fake-value-1111",
      );
      expect(await mod.readAppSecretMeta(keyRef("NEW_KEY"))).toMatchObject({
        id,
        label: "Old label",
        provider: "other",
        description: "Old description",
        createdBy: "creator@example.test",
      });
    });

    it("refuses to rename onto another key and changes nothing", async () => {
      const id = await seed();
      await mod.writeAppSecret({
        ...keyRef("TAKEN_KEY"),
        value: "fake-taken-9999",
      });
      const before = await ciphertextOf("OLD_KEY");

      await expect(
        mod.updateAppSecretById({ id, ...orgScope }, { key: "TAKEN_KEY" }),
      ).rejects.toBeInstanceOf(mod.AppSecretKeyConflictError);

      expect(await ciphertextOf("OLD_KEY")).toEqual(before);
      expect((await mod.readAppSecret(keyRef("TAKEN_KEY")))?.value).toBe(
        "fake-taken-9999",
      );
    });

    it("edits display fields without touching the ciphertext, and clears one with null", async () => {
      const id = await seed();
      const before = await ciphertextOf("OLD_KEY");

      await mod.updateAppSecretById(
        { id, ...orgScope },
        { label: "New label", provider: null },
      );

      expect(await ciphertextOf("OLD_KEY")).toEqual(before);
      expect(await mod.readAppSecretMeta(keyRef("OLD_KEY"))).toMatchObject({
        label: "New label",
        provider: null,
        description: "Old description",
      });
    });

    it("replaces the value and nothing else when only a value is given", async () => {
      const id = await seed();
      const before = await ciphertextOf("OLD_KEY");

      await mod.updateAppSecretById(
        { id, ...orgScope },
        { value: "fake-value-2222" },
      );

      expect(await ciphertextOf("OLD_KEY")).not.toEqual(before);
      expect(await mod.readAppSecret(keyRef("OLD_KEY"))).toMatchObject({
        value: "fake-value-2222",
        last4: "••••2222",
      });
      expect(await mod.readAppSecretMeta(keyRef("OLD_KEY"))).toMatchObject({
        label: "Old label",
        provider: "other",
        description: "Old description",
      });
      const row = await pglite.prepare(`SELECT * FROM app_secrets`).get();
      expect(JSON.stringify(row)).not.toContain("fake-value-2222");
    });

    it("rejects an empty value and an empty key", async () => {
      const id = await seed();

      await expect(
        mod.updateAppSecretById({ id, ...orgScope }, { value: "" }),
      ).rejects.toThrow("value cannot be empty");
      await expect(
        mod.updateAppSecretById({ id, ...orgScope }, { key: "" }),
      ).rejects.toThrow("key cannot be empty");
      expect((await mod.readAppSecret(keyRef("OLD_KEY")))?.value).toBe(
        "fake-value-1111",
      );
    });

    it("finds nothing under another scope or an unknown id", async () => {
      const id = await seed();

      expect(
        await mod.updateAppSecretById(
          { id, ...otherOrgScope },
          { label: "Hijacked" },
        ),
      ).toBeNull();
      expect(
        await mod.updateAppSecretById(
          { id: "missing", ...orgScope },
          { label: "Hijacked" },
        ),
      ).toBeNull();
      expect((await mod.readAppSecretMeta(keyRef("OLD_KEY")))?.label).toBe(
        "Old label",
      );
    });

    it("records the editor as creator only when the key has none", async () => {
      const appId = await mod.writeAppSecret({
        ...keyRef("APP_KEY"),
        value: "fake-value",
      });
      const vaultId = await seed();

      await mod.updateAppSecretById(
        { id: appId, ...orgScope },
        { adoptedBy: "editor@example.test" },
      );
      await mod.updateAppSecretById(
        { id: vaultId, ...orgScope },
        { adoptedBy: "editor@example.test" },
      );

      expect((await mod.readAppSecretMeta(keyRef("APP_KEY")))?.createdBy).toBe(
        "editor@example.test",
      );
      expect((await mod.readAppSecretMeta(keyRef("OLD_KEY")))?.createdBy).toBe(
        "creator@example.test",
      );
    });

    it("drops a stale per-request read after a rename", async () => {
      const { runWithRequestContext } =
        await import("../server/request-context.js");
      const id = await seed();

      await runWithRequestContext(
        { userEmail: "admin@example.test" },
        async () => {
          expect((await mod.readAppSecret(keyRef("OLD_KEY")))?.value).toBe(
            "fake-value-1111",
          );
          await mod.updateAppSecretById(
            { id, ...orgScope },
            { key: "NEW_KEY" },
          );
          expect(await mod.readAppSecret(keyRef("OLD_KEY"))).toBeNull();
          expect((await mod.readAppSecret(keyRef("NEW_KEY")))?.value).toBe(
            "fake-value-1111",
          );
        },
      );
    });
  });

  it("refuses to change the origin policy of a key created through the Vault", async () => {
    await mod.writeAppSecret({
      ...keyRef("VAULT_KEY"),
      value: "fake-value",
      createdBy: "creator@example.test",
    });
    await mod.writeAppSecret({ ...keyRef("APP_KEY"), value: "fake-value" });

    expect(
      await mod.updateAppSecretUrlAllowlist(keyRef("VAULT_KEY"), [
        "https://api.example.test",
      ]),
    ).toBe(false);
    expect(
      await mod.updateAppSecretUrlAllowlist(keyRef("APP_KEY"), [
        "https://api.example.test",
      ]),
    ).toBe(true);
  });
});
