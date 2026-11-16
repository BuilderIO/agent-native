import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { rekeyIdentity, type IdentityRekeyDb } from "../identity/rekey.js";
import { runWithRequestContext } from "../server/request-context.js";
import {
  beginUserIntegrationGrant,
  completeUserIntegrationGrant,
  ensureUserIntegrationGrantsTable,
  getUserIntegrationGrant,
  resolveUserIntegrationGrant,
  UserIntegrationGrantUnavailableError,
} from "./user-grants-store.js";

const holder = vi.hoisted(() => ({ exec: null as any }));
vi.mock("../db/client.js", async (original) => ({
  ...(await original<typeof import("../db/client.js")>()),
  getDbExec: () => holder.exec,
}));

let pg: Awaited<ReturnType<typeof createTestPglite>>;
const owner = {
  authUserId: "vault-principal-a",
  userEmail: "vault-a@example.test",
};
const tuple = {
  provider: "example-chat",
  teamId: "TEAM_SYNTHETIC",
  apiAppId: "APP_SYNTHETIC",
  externalUserId: "USER_SYNTHETIC",
};
const bundle = {
  accessToken: "synthetic-vault-access",
  refreshToken: "synthetic-vault-refresh",
  tokenType: "user" as const,
  scopes: ["channels:read"],
};
const asOwner = <T>(fn: () => Promise<T>) => runWithRequestContext(owner, fn);

beforeAll(async () => {
  // Only this isolated test process uses these synthetic encryption keys and in-memory DB.
  vi.stubEnv("DATABASE_URL", "pglite:memory://user-grants-vault"); // guard:allow-env-mutation
  vi.stubEnv(
    "WORKSPACE_SECRETS_ENCRYPTION_KEY",
    "synthetic-vault-test-encryption-material-only",
  ); // guard:allow-env-mutation
  vi.stubEnv(
    "SECRETS_ENCRYPTION_KEY",
    "synthetic-vault-test-encryption-material-only",
  ); // guard:allow-env-mutation
  pg = await createTestPglite();
  holder.exec = {
    async execute(input: string | { sql: string; args?: unknown[] }) {
      if (typeof input === "string") {
        await pg.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      const r = await pg.query(input.sql, input.args ?? []);
      return { rows: r.rows, rowsAffected: r.affectedRows ?? 0 };
    },
  };
  await ensureUserIntegrationGrantsTable();
  await pg.exec(
    'CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT NOT NULL)',
  );
  await pg.query('INSERT INTO "user" (id, email) VALUES (?, ?)', [
    owner.authUserId,
    owner.userEmail,
  ]);
}, 30_000);

afterAll(async () => {
  await pg?.close();
  holder.exec = null;
  vi.unstubAllEnvs();
});

describe("personal grant encrypted-vault lifecycle", () => {
  let grantId: string;
  it("resolves through the real vault while SQL and safe metadata contain no token plaintext", async () => {
    const result = await asOwner(async () => {
      const attempt = await beginUserIntegrationGrant({
        ...tuple,
        operationId: "vault-encryption-op-01",
      });
      const meta = await completeUserIntegrationGrant(attempt, bundle);
      return {
        attempt,
        meta,
        resolved: await resolveUserIntegrationGrant(attempt.grantId),
      };
    });
    grantId = result.attempt.grantId;
    expect(result.resolved).toEqual(bundle);
    const ciphertexts = await pg.query(
      "SELECT encrypted_value, shared_encrypted_value FROM app_secrets",
    );
    expect(ciphertexts.rows.length).toBeGreaterThan(0);
    for (const row of ciphertexts.rows) {
      expect(typeof row.encrypted_value).toBe("string");
      expect(JSON.stringify(row)).not.toContain(bundle.accessToken);
      expect(JSON.stringify(row)).not.toContain(bundle.refreshToken);
    }
    const metadata = await pg.query("SELECT * FROM integration_user_grants");
    expect(JSON.stringify(metadata.rows)).not.toContain(bundle.accessToken);
    expect(JSON.stringify(metadata.rows)).not.toContain(bundle.refreshToken);
    expect(JSON.stringify(result.meta)).not.toContain(
      "integration-user-grant:",
    );
    expect(
      await runWithRequestContext(
        { authUserId: "vault-principal-b", userEmail: owner.userEmail },
        () => resolveUserIntegrationGrant(grantId),
      ),
    ).toBeNull();
  });

  it("moves the grant and real vault scope through the actual transactional identity rekey service", async () => {
    const newEmail = "vault-rekeyed@example.test";
    await pg.db.transaction(async (tx) => {
      const db: IdentityRekeyDb = {
        async unsafe(sql, args = []) {
          const result = await tx.query<Record<string, unknown>>(sql, args);
          return Object.assign(result.rows, {
            count: result.affectedRows ?? result.rows.length,
          });
        },
      };
      const changed = await rekeyIdentity(db, owner.userEmail, newEmail, {
        actorEmail: owner.userEmail,
        caller: "cli",
      });
      expect(changed.counts["integration_user_grants.owner_email"]).toBe(1);
    });
    const newIdentity = { authUserId: owner.authUserId, userEmail: newEmail };
    const result = await runWithRequestContext(newIdentity, async () => ({
      meta: await getUserIntegrationGrant(grantId),
      resolved: await resolveUserIntegrationGrant(grantId),
    }));
    expect(result.meta?.id).toBe(grantId);
    expect(result.resolved).toEqual(bundle);
    expect(
      (
        await pg.query("SELECT scope_id FROM app_secrets WHERE scope = 'user'")
      ).rows.every((row) => row.scope_id === newEmail),
    ).toBe(true);
    expect(
      await runWithRequestContext(
        { authUserId: "recreated-principal", userEmail: newEmail },
        () => resolveUserIntegrationGrant(grantId),
      ),
    ).toBeNull();
  });

  it("fails closed on corrupted metadata instead of resolving a token or fabricating an empty grant", async () => {
    const identity = {
      authUserId: owner.authUserId,
      userEmail: "vault-rekeyed@example.test",
    };
    await runWithRequestContext(identity, async () => {
      const attempt = await beginUserIntegrationGrant({
        ...tuple,
        externalUserId: "CORRUPTION_SYNTHETIC",
        operationId: "corruption-operation-01",
      });
      await completeUserIntegrationGrant(attempt, bundle);
      const original = (
        await pg.query<Record<string, unknown>>(
          "SELECT * FROM integration_user_grants WHERE id = ?",
          [attempt.grantId],
        )
      ).rows[0];
      const corruptions: Array<[string, unknown]> = [
        ["owner_email", "not-an-email"],
        ["operations_json", "[]"],
        ["token_secret_key", "integration-user-grant:another-grant:opaque"],
        ["scopes_json", JSON.stringify(["channels:read", "channels:read"])],
        ["operation_id", "untracked-operation-01"],
        ["generation", 99],
      ];
      for (const [column, value] of corruptions) {
        // Column names come only from this fixed test fixture, never caller input.
        await pg.query(
          `UPDATE integration_user_grants SET ${column} = ? WHERE id = ?`,
          [value, attempt.grantId],
        );
        await expect(
          getUserIntegrationGrant(attempt.grantId),
        ).rejects.toBeInstanceOf(UserIntegrationGrantUnavailableError);
        await expect(
          resolveUserIntegrationGrant(attempt.grantId),
        ).rejects.toBeInstanceOf(UserIntegrationGrantUnavailableError);
        await pg.query(
          `UPDATE integration_user_grants SET ${column} = ? WHERE id = ?`,
          [original[column], attempt.grantId],
        );
      }
      expect(await resolveUserIntegrationGrant(attempt.grantId)).toEqual(
        bundle,
      );
    });
  });
});
