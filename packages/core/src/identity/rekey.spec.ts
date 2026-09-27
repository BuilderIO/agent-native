import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import {
  decryptSecretValue,
  encryptSecretValue,
  isEncryptedSecretValue,
} from "../secrets/crypto.js";
import {
  IDENTITY_REKEY_COLUMNS,
  rekeyIdentity,
  rekeyIdentityAfterEmailVerification,
} from "./rekey.js";

function dbAdapter(db: {
  query: (sql: string, args?: unknown[]) => Promise<any>;
}) {
  return {
    async unsafe(sql: string, args: unknown[] = []) {
      const result = await db.query(sql, args);
      const rows = result.rows as Array<Record<string, unknown>> & {
        count?: number;
      };
      rows.count = result.affectedRows ?? result.rowCount ?? 0;
      return rows;
    },
  };
}

async function seed(db: Awaited<ReturnType<typeof createTestPglite>>) {
  await db.exec(`
    CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT UNIQUE);
    CREATE TABLE "session" (id TEXT PRIMARY KEY, "userId" TEXT);
    CREATE TABLE org_members (id TEXT PRIMARY KEY, email TEXT);
    CREATE TABLE org_invitations (id TEXT PRIMARY KEY, email TEXT, invited_by TEXT);
    CREATE TABLE app_member_roles (id TEXT PRIMARY KEY, email TEXT, updated_by TEXT);
    CREATE TABLE app_permission_overrides (id TEXT PRIMARY KEY, updated_by TEXT);
    CREATE TABLE workspace_connections (id TEXT PRIMARY KEY, owner_email TEXT);
    CREATE TABLE workspace_connection_grants (id TEXT PRIMARY KEY, owner_email TEXT, granted_by_email TEXT);
    CREATE TABLE usage_alert_rules (id TEXT PRIMARY KEY, owner_email TEXT);
    CREATE TABLE tools (id TEXT PRIMARY KEY, owner_email TEXT);
    CREATE TABLE tool_data (id TEXT PRIMARY KEY, owner_email TEXT, scope_key TEXT);
    CREATE TABLE tool_hidden_extensions (id TEXT PRIMARY KEY, owner_email TEXT);
    CREATE TABLE tool_consents (viewer_email TEXT, tool_id TEXT, content_hash TEXT, PRIMARY KEY(viewer_email, tool_id, content_hash));
    CREATE TABLE tool_history (id TEXT PRIMARY KEY, actor_email TEXT, owner_email TEXT);
    CREATE TABLE integration_identity_links (id TEXT PRIMARY KEY, user_email TEXT);
    CREATE TABLE agent_trace_spans (id TEXT PRIMARY KEY, user_id TEXT);
    CREATE TABLE agent_trace_summaries (run_id TEXT PRIMARY KEY, user_id TEXT);
    CREATE TABLE agent_feedback (id TEXT PRIMARY KEY, user_id TEXT);
    CREATE TABLE agent_human_review_summaries (run_id TEXT PRIMARY KEY, created_by TEXT);
    CREATE TABLE agent_satisfaction_scores (id TEXT PRIMARY KEY, user_id TEXT);
    CREATE TABLE agent_evals (id TEXT PRIMARY KEY, user_id TEXT);
    CREATE TABLE agent_experiment_assignments (experiment_id TEXT, user_id TEXT, PRIMARY KEY(experiment_id, user_id));
    CREATE TABLE agent_experiments (id TEXT PRIMARY KEY, owner_email TEXT);
    CREATE TABLE workspace_user_groups (id TEXT PRIMARY KEY, member_emails_json TEXT);
    CREATE TABLE workspace_app_shares (id TEXT PRIMARY KEY, resource_id TEXT, principal_type TEXT, principal_id TEXT, created_by TEXT);
    CREATE TABLE tool_shares (id TEXT PRIMARY KEY, resource_id TEXT, principal_type TEXT, principal_id TEXT, created_by TEXT);
    CREATE TABLE app_secrets (id TEXT, scope TEXT, scope_id TEXT, key TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE application_state (session_id TEXT, key TEXT, value TEXT, PRIMARY KEY(session_id, key));
    CREATE TABLE oauth_tokens (provider TEXT, account_id TEXT, owner TEXT, tokens TEXT, revision BIGINT, updated_at BIGINT, PRIMARY KEY(provider, account_id));
    CREATE TABLE agent_audit_log (
      id TEXT PRIMARY KEY, created_at BIGINT, action TEXT, caller TEXT, actor_kind TEXT,
      actor_email TEXT, target_type TEXT, target_id TEXT, status TEXT, summary TEXT,
      input TEXT, owner_email TEXT, visibility TEXT
    );
    INSERT INTO "user" VALUES ('u1', 'old@example.test');
    INSERT INTO "session" VALUES ('s1', 'u1');
    INSERT INTO org_members VALUES ('m1', 'OLD@example.test');
    INSERT INTO org_invitations VALUES ('i1', 'old@example.test', 'old@example.test');
    INSERT INTO app_member_roles VALUES ('r1', 'old@example.test', 'old@example.test');
    INSERT INTO app_permission_overrides VALUES ('p1', 'old@example.test');
    INSERT INTO workspace_connections VALUES ('c1', 'old@example.test');
    INSERT INTO workspace_connection_grants VALUES ('g1', 'old@example.test', 'old@example.test');
    INSERT INTO usage_alert_rules VALUES ('a1', 'old@example.test');
    INSERT INTO tools VALUES ('t1', 'old@example.test');
    INSERT INTO tool_data VALUES ('d1', 'old@example.test', 'old@example.test');
    INSERT INTO tool_hidden_extensions VALUES ('h1', 'old@example.test');
    INSERT INTO tool_consents VALUES ('OLD@example.test', 'tool1', 'hash1');
    INSERT INTO tool_history VALUES ('history1', 'old@example.test', 'old@example.test');
    INSERT INTO integration_identity_links VALUES ('l1', 'old@example.test');
    INSERT INTO agent_trace_spans VALUES ('span1', 'OLD@example.test');
    INSERT INTO agent_trace_summaries VALUES ('run1', 'old@example.test');
    INSERT INTO agent_feedback VALUES ('feedback1', 'old@example.test');
    INSERT INTO agent_human_review_summaries VALUES ('run1', 'old@example.test');
    INSERT INTO agent_satisfaction_scores VALUES ('score1', 'old@example.test');
    INSERT INTO agent_evals VALUES ('eval1', 'old@example.test');
    INSERT INTO agent_experiment_assignments VALUES ('exp1', 'old@example.test');
    INSERT INTO agent_experiments VALUES ('exp1', 'old@example.test');
    INSERT INTO workspace_user_groups VALUES ('w1', '["OLD@example.test","other@example.test"]');
    INSERT INTO workspace_app_shares VALUES ('ws1', 'resource1', 'user', 'old@example.test', 'old@example.test');
    INSERT INTO tool_shares VALUES ('ts1', 'tool1', 'user', 'old@example.test', 'old@example.test');
    INSERT INTO app_secrets VALUES ('secret1', 'user', 'old@example.test', 'KEY');
    INSERT INTO app_secrets VALUES ('secret2', 'workspace', 'solo:old@example.test', 'KEY2');
    INSERT INTO settings VALUES ('u:old@example.test:theme', 'dark');
    INSERT INTO application_state VALUES ('old@example.test', 'state', '{}');
  `);
}

async function seedEveryRegisteredIdentityColumn(
  db: Awaited<ReturnType<typeof createTestPglite>>,
) {
  const oldEmail = "old@example.test";
  const existingRows = await db
    .prepare(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    )
    .all();
  const existingTables = new Set(
    existingRows.map((row) => String(row.table_name)),
  );
  const entriesByTable = new Map<
    string,
    (typeof IDENTITY_REKEY_COLUMNS)[number][]
  >();
  for (const entry of IDENTITY_REKEY_COLUMNS) {
    const entries = entriesByTable.get(entry.table) ?? [];
    entries.push(entry);
    entriesByTable.set(entry.table, entries);
  }

  const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
  for (const [table, entries] of entriesByTable) {
    if (table === "user") continue;
    const tableAlreadyExisted = existingTables.has(table);
    if (!tableAlreadyExisted) {
      const columns = new Set(["id"]);
      for (const entry of entries) columns.add(entry.column);
      for (const entry of entries) {
        if (entry.mode === "user-share") {
          columns.add("principal_type");
          columns.add("resource_id");
        }
        if (entry.mode === "user-scope") {
          columns.add("scope");
          columns.add("key");
        }
        if (entry.mode === "secret-scope") columns.add("secret_scope");
        if (entry.mode === "typed-scope") columns.add("scope_type");
        if (entry.mode === "custom-scope") columns.add("scope");
      }
      await db.exec(
        `CREATE TABLE ${quoteIdentifier(table)} (${[
          '"id" TEXT PRIMARY KEY',
          ...[...columns]
            .filter((column) => column !== "id")
            .map((column) => `${quoteIdentifier(column)} TEXT`),
        ].join(", ")})`,
      );
      existingTables.add(table);
    }

    if (table === "oauth_tokens") {
      await db
        .prepare(
          "INSERT INTO oauth_tokens (provider, account_id, owner, tokens, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("fixture", "raw-owner", oldEmail, "{}", 1, 1);
      await db
        .prepare(
          "INSERT INTO oauth_tokens (provider, account_id, owner, tokens, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("fixture", "user-owner", `user:${oldEmail}`, "{}", 1, 1);
      continue;
    }
    if (tableAlreadyExisted) continue;

    let rowNumber = 0;
    for (const entry of entries) {
      if (entry.mode === "unsupported-oauth") continue;
      const values = new Map<string, unknown>([
        ["id", `${table}-fixture-${rowNumber++}`],
        [entry.column, oldEmail],
      ]);
      if (entry.mode === "user-share") {
        values.set("principal_type", "user");
        values.set("resource_id", `${table}-resource-${rowNumber}`);
      }
      if (entry.mode === "user-scope") {
        values.set("scope", "user");
        values.set("key", `${table}-key-${rowNumber}`);
      }
      if (entry.mode === "secret-scope") values.set("secret_scope", "user");
      if (entry.mode === "typed-scope") values.set("scope_type", "user");
      if (entry.mode === "custom-scope") values.set("scope", "user");
      const names = [...values.keys()];
      await db
        .prepare(
          `INSERT INTO ${quoteIdentifier(table)} (${names.map(quoteIdentifier).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
        )
        .run(...names.map((name) => values.get(name)));

      if (entry.mode === "secret-scope") {
        values.set("id", `${table}-fixture-${rowNumber++}`);
        values.set("secret_scope", "user");
        values.set(entry.column, `user:${oldEmail}`);
        const userPrefixNames = [...values.keys()];
        await db
          .prepare(
            `INSERT INTO ${quoteIdentifier(table)} (${userPrefixNames.map(quoteIdentifier).join(", ")}) VALUES (${userPrefixNames.map(() => "?").join(", ")})`,
          )
          .run(...userPrefixNames.map((name) => values.get(name)));

        values.set("id", `${table}-fixture-${rowNumber++}`);
        values.set("secret_scope", "workspace");
        values.set(entry.column, `solo:${oldEmail}`);
        const workspaceNames = [...values.keys()];
        await db
          .prepare(
            `INSERT INTO ${quoteIdentifier(table)} (${workspaceNames.map(quoteIdentifier).join(", ")}) VALUES (${workspaceNames.map(() => "?").join(", ")})`,
          )
          .run(...workspaceNames.map((name) => values.get(name)));
      }
    }
  }
}

describe("rekeyIdentity", () => {
  it("moves every registered identity column, including denormalized secret scopes", async () => {
    const pg = await createTestPglite();
    try {
      await seed(pg);
      await seedEveryRegisteredIdentityColumn(pg);

      const result = await pg.db.transaction((tx) =>
        rekeyIdentity(dbAdapter(tx), "old@example.test", "new@example.test"),
      );

      for (const entry of IDENTITY_REKEY_COLUMNS) {
        expect(result.counts[`${entry.table}.${entry.column}`]).toBeGreaterThan(
          0,
        );
      }
      for (const table of [
        "integration_installations",
        "automation_webhook_tokens",
      ]) {
        const rows = await pg
          .prepare(`SELECT secret_scope, secret_scope_id FROM ${table}`)
          .all();
        expect(rows).toEqual(
          expect.arrayContaining([
            { secret_scope: "user", secret_scope_id: "new@example.test" },
            {
              secret_scope: "user",
              secret_scope_id: "user:new@example.test",
            },
            {
              secret_scope: "workspace",
              secret_scope_id: "solo:new@example.test",
            },
          ]),
        );
      }
    } finally {
      await pg.close();
    }
  });

  it("moves registered active identity references, revokes sessions, and appends audit", async () => {
    const pg = await createTestPglite();
    try {
      await seed(pg);
      await pg.exec(`
        CREATE TABLE discovered_owned_rows (id TEXT PRIMARY KEY, owner_email TEXT);
        INSERT INTO discovered_owned_rows VALUES ('dynamic1', 'OLD@example.test');
        INSERT INTO settings VALUES ('feature-flag:editor', '{"mode":"rules","emails":["OLD@example.test","new@example.test","other@example.test"],"updatedBy":"OLD@example.test"}');
        INSERT INTO settings VALUES ('o:org1:feature-flag:editor', '{"mode":"rules","emails":["old@example.test"],"updatedBy":"someone@example.test"}');
      `);
      const result = await pg.db.transaction((tx) =>
        rekeyIdentity(dbAdapter(tx), "old@example.test", "new@example.test"),
      );
      expect(Object.keys(result.counts)).toContain("org_members.email");
      expect(result.sessionCount).toBe(1);
      const user = await pg
        .prepare(`SELECT email FROM "user" WHERE id = 'u1'`)
        .get();
      expect(user.email).toBe("new@example.test");
      const members = await pg.prepare("SELECT email FROM org_members").all();
      expect(members[0].email).toBe("new@example.test");
      const group = await pg
        .prepare("SELECT member_emails_json FROM workspace_user_groups")
        .get();
      expect(JSON.parse(group.member_emails_json)).toEqual([
        "new@example.test",
        "other@example.test",
      ]);
      const secrets = await pg
        .prepare("SELECT scope_id FROM app_secrets ORDER BY id")
        .all();
      expect(secrets.map((row) => row.scope_id)).toEqual([
        "new@example.test",
        "solo:new@example.test",
      ]);
      expect(
        await pg.prepare('SELECT count(*)::int AS count FROM "session"').get(),
      ).toEqual({ count: 0 });
      expect(
        await pg
          .prepare(
            "SELECT count(*)::int AS count FROM application_state WHERE session_id = 'new@example.test'",
          )
          .get(),
      ).toEqual({ count: 1 });
      const audit = await pg
        .prepare("SELECT action, input FROM agent_audit_log")
        .get();
      expect(audit.action).toBe("identity.rekeyed");
      expect(JSON.parse(audit.input)).toEqual({
        oldEmail: "old@example.test",
        newEmail: "new@example.test",
      });
      expect(IDENTITY_REKEY_COLUMNS.length).toBeGreaterThan(0);
      expect(
        await pg.prepare("SELECT owner_email FROM discovered_owned_rows").get(),
      ).toEqual({ owner_email: "new@example.test" });
      expect(
        await pg.prepare("SELECT owner_email FROM agent_experiments").get(),
      ).toEqual({ owner_email: "new@example.test" });
      expect(
        await pg.prepare("SELECT viewer_email FROM tool_consents").get(),
      ).toEqual({ viewer_email: "new@example.test" });
      expect(
        await pg
          .prepare("SELECT actor_email, owner_email FROM tool_history")
          .get(),
      ).toEqual({
        actor_email: "old@example.test",
        owner_email: "old@example.test",
      });
      expect(
        await pg
          .prepare("SELECT created_by FROM agent_human_review_summaries")
          .get(),
      ).toEqual({ created_by: "old@example.test" });
      expect(
        await pg.prepare("SELECT user_id FROM agent_trace_spans").get(),
      ).toEqual({ user_id: "new@example.test" });
      expect(
        await pg
          .prepare("SELECT user_id FROM agent_experiment_assignments")
          .get(),
      ).toEqual({ user_id: "new@example.test" });
      const flags = await pg
        .prepare(
          "SELECT key, value FROM settings WHERE key LIKE '%feature-flag:%' ORDER BY key",
        )
        .all();
      expect(JSON.parse(flags[0].value)).toMatchObject({
        emails: ["new@example.test", "other@example.test"],
        updatedBy: "new@example.test",
      });
      expect(JSON.parse(flags[1].value)).toMatchObject({
        emails: ["new@example.test"],
      });
    } finally {
      await pg.close();
    }
  });

  it("revokes OAuth rows with inconsistent lifecycle ownership", async () => {
    const pg = await createTestPglite();
    try {
      await seed(pg);
      await pg.exec(
        `INSERT INTO oauth_tokens VALUES ('google', 'acct-user', 'old@example.test', '{"oauthLifecycle":{"owner":"user:another@example.test"}}', 1, 10)`,
      );
      const result = await pg.db.transaction((tx) =>
        rekeyIdentity(dbAdapter(tx), "old@example.test", "new@example.test"),
      );
      expect(result.oauthRevokedCount).toBe(1);
      expect(
        await pg
          .prepare("SELECT count(*)::int AS count FROM oauth_tokens")
          .get(),
      ).toEqual({ count: 0 });
      expect(
        (await pg.prepare(`SELECT email FROM "user" WHERE id = 'u1'`).get())
          .email,
      ).toBe("new@example.test");
    } finally {
      await pg.close();
    }
  });

  it("refuses an already-owned destination email", async () => {
    const pg = await createTestPglite();
    try {
      await seed(pg);
      await pg.exec(`INSERT INTO "user" VALUES ('u2', 'new@example.test')`);
      await expect(
        rekeyIdentity(dbAdapter(pg.db), "old@example.test", "new@example.test"),
      ).rejects.toThrow(/already belongs/);
    } finally {
      await pg.close();
    }
  });

  it("fails closed when an unregistered bare scope_id column exists", async () => {
    const pg = await createTestPglite();
    try {
      await seed(pg);
      await pg.exec(
        `CREATE TABLE unregistered_scopes (id TEXT PRIMARY KEY, scope_id TEXT)`,
      );
      await expect(
        rekeyIdentity(dbAdapter(pg.db), "old@example.test", "new@example.test"),
      ).rejects.toThrow(/unregistered_scopes\.scope_id/);
    } finally {
      await pg.close();
    }
  });

  it("rekeys raw and user-scoped OAuth owners while preserving encrypted lifecycle metadata", async () => {
    const pg = await createTestPglite();
    const previousKey = process.env.SECRETS_ENCRYPTION_KEY;
    process.env.SECRETS_ENCRYPTION_KEY = "identity-rekey-oauth-test-key";
    try {
      await seed(pg);
      const encrypted = encryptSecretValue(
        JSON.stringify({
          tokens: {
            access_token: "access-token",
            refresh_token: "refresh-token",
          },
          oauthLifecycle: {
            version: 1,
            provider: "google",
            resource: "calendar",
            owner: "user:old@example.test",
          },
        }),
      );
      await pg.exec(
        `INSERT INTO oauth_tokens VALUES ('google', 'acct-user', 'user:Old@Example.test', '${encrypted}', 2, 10); INSERT INTO oauth_tokens VALUES ('slack', 'acct-raw', 'old@example.test', '{"tokens":{"access_token":"legacy-token"}}', 3, 11);`,
      );
      const result = await pg.db.transaction((tx) =>
        rekeyIdentity(dbAdapter(tx), "old@example.test", "new@example.test"),
      );
      expect(result.counts["oauth_tokens.owner"]).toBe(2);
      const rows = await pg
        .prepare(
          "SELECT provider, owner, tokens, revision FROM oauth_tokens ORDER BY provider",
        )
        .all();
      expect(rows.map((row) => row.owner)).toEqual([
        "user:new@example.test",
        "new@example.test",
      ]);
      const encryptedRow = rows.find((row) => row.provider === "google");
      expect(isEncryptedSecretValue(encryptedRow.tokens)).toBe(true);
      expect(JSON.parse(decryptSecretValue(encryptedRow.tokens))).toMatchObject(
        {
          tokens: {
            access_token: "access-token",
            refresh_token: "refresh-token",
          },
          oauthLifecycle: { owner: "user:new@example.test" },
        },
      );
      expect(Number(encryptedRow.revision)).toBeGreaterThan(2);
      const legacyRow = rows.find((row) => row.provider === "slack");
      expect(JSON.parse(legacyRow.tokens)).toEqual({
        tokens: { access_token: "legacy-token" },
      });
    } finally {
      if (previousKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
      else process.env.SECRETS_ENCRYPTION_KEY = previousKey;
      await pg.close();
    }
  });

  it("revokes an undecryptable owned OAuth row while completing the rekey", async () => {
    const pg = await createTestPglite();
    const previousKey = process.env.SECRETS_ENCRYPTION_KEY;
    process.env.SECRETS_ENCRYPTION_KEY = "identity-rekey-oauth-test-key";
    try {
      await seed(pg);
      await pg.exec(
        `INSERT INTO oauth_tokens VALUES ('google', 'acct-user', 'user:old@example.test', 'v1:00:00:00', 2, 10)`,
      );
      const result = await pg.db.transaction((tx) =>
        rekeyIdentity(dbAdapter(tx), "old@example.test", "new@example.test"),
      );
      expect(result.oauthRevokedCount).toBe(1);
      expect(
        await pg
          .prepare("SELECT count(*)::int AS count FROM oauth_tokens")
          .get(),
      ).toEqual({ count: 0 });
      expect(await pg.prepare('SELECT email FROM "user"').get()).toEqual({
        email: "new@example.test",
      });
      expect(await pg.prepare("SELECT email FROM org_members").get()).toEqual({
        email: "new@example.test",
      });
    } finally {
      if (previousKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
      else process.env.SECRETS_ENCRYPTION_KEY = previousKey;
      await pg.close();
    }
  });

  it("refuses duplicate experiment assignments for the destination email", async () => {
    const pg = await createTestPglite();
    try {
      await seed(pg);
      await pg.exec(
        `INSERT INTO agent_experiment_assignments VALUES ('exp1', 'new@example.test')`,
      );
      await expect(
        pg.db.transaction((tx) =>
          rekeyIdentity(dbAdapter(tx), "old@example.test", "new@example.test"),
        ),
      ).rejects.toThrow(/Experiment assignment collision/);
      expect(
        await pg
          .prepare(
            "SELECT user_id FROM agent_experiment_assignments ORDER BY user_id",
          )
          .all(),
      ).toEqual([
        { user_id: "new@example.test" },
        { user_id: "old@example.test" },
      ]);
    } finally {
      await pg.close();
    }
  });

  it("refuses a destination tool-consent key collision", async () => {
    const pg = await createTestPglite();
    try {
      await seed(pg);
      await pg.exec(
        `INSERT INTO tool_consents VALUES ('new@example.test', 'tool1', 'hash1')`,
      );
      await expect(
        pg.db.transaction((tx) =>
          rekeyIdentity(dbAdapter(tx), "old@example.test", "new@example.test"),
        ),
      ).rejects.toThrow(/Extension consent collision/);
      expect(
        await pg
          .prepare(
            "SELECT viewer_email FROM tool_consents ORDER BY viewer_email",
          )
          .all(),
      ).toEqual([
        { viewer_email: "OLD@example.test" },
        { viewer_email: "new@example.test" },
      ]);
    } finally {
      await pg.close();
    }
  });

  it("fails closed on malformed feature-flag targeting JSON", async () => {
    const pg = await createTestPglite();
    try {
      await seed(pg);
      await pg.exec(
        `INSERT INTO settings VALUES ('feature-flag:broken', 'not-json')`,
      );
      await expect(
        pg.db.transaction((tx) =>
          rekeyIdentity(dbAdapter(tx), "old@example.test", "new@example.test"),
        ),
      ).rejects.toThrow(/Invalid feature-flag settings JSON/);
      expect(await pg.prepare('SELECT email FROM "user"').get()).toEqual({
        email: "old@example.test",
      });
    } finally {
      await pg.close();
    }
  });

  it("rekeys only after Better Auth's signed new-address verification", async () => {
    const pg = await createTestPglite();
    try {
      await seed(pg);
      await pg.exec(
        `UPDATE "user" SET email = 'new@example.test' WHERE id = 'u1'`,
      );
      const token = await new SignJWT({
        email: "old@example.test",
        updateTo: "new@example.test",
        requestType: "change-email-verification",
      })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("1h")
        .sign(new TextEncoder().encode("identity-rekey-test-secret"));
      const result = await pg.db.transaction((tx) =>
        rekeyIdentityAfterEmailVerification(dbAdapter(tx), {
          token,
          secret: "identity-rekey-test-secret",
          verifiedEmail: "new@example.test",
        }),
      );
      expect(result?.counts["org_members.email"]).toBe(1);
      expect(result?.sessionCount).toBe(1);
      expect(await pg.prepare("SELECT email FROM org_members").get()).toEqual({
        email: "new@example.test",
      });
      expect(
        await pg.prepare('SELECT count(*)::int AS count FROM "session"').get(),
      ).toEqual({ count: 0 });
    } finally {
      await pg.close();
    }
  });

  it("refuses a verified token whose destination differs from the updated account", async () => {
    const pg = await createTestPglite();
    try {
      await seed(pg);
      await pg.exec(
        `UPDATE "user" SET email = 'new@example.test' WHERE id = 'u1'`,
      );
      const token = await new SignJWT({
        email: "old@example.test",
        updateTo: "new@example.test",
        requestType: "change-email-verification",
      })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("1h")
        .sign(new TextEncoder().encode("identity-rekey-test-secret"));
      await expect(
        rekeyIdentityAfterEmailVerification(dbAdapter(pg.db), {
          token,
          secret: "identity-rekey-test-secret",
          verifiedEmail: "other@example.test",
        }),
      ).rejects.toThrow(/does not match/);
      expect(await pg.prepare("SELECT email FROM org_members").get()).toEqual({
        email: "OLD@example.test",
      });
    } finally {
      await pg.close();
    }
  });
});
