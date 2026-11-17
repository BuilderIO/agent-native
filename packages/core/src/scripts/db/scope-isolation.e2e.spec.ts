import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { frameworkTables } from "./framework-columns.test-helpers.js";
import {
  createPostgresScriptClient,
  type PostgresScriptClient,
} from "./postgres-client.js";

type Client = PostgresScriptClient;

async function createClient({ url }: { url: string }) {
  const client = await createPostgresScriptClient(url);
  return {
    async execute(input: string | { sql: string; args?: unknown[] }) {
      return client.unsafe(
        typeof input === "string" ? input : input.sql,
        typeof input === "string" ? undefined : input.args,
      );
    },
    close: () => client.end(),
  };
}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("db tools cross-tenant isolation (e2e, real postgres)", () => {
  let dir: string;
  let dbFile: string;
  let url: string;

  async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const c = await createClient({ url });
    try {
      return await fn(c);
    } finally {
      c.close();
    }
  }

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "an-scope-"));
    dbFile = path.join(dir, "app");
    url = "pglite:" + dbFile;
    await withClient(async (c) => {
      await c.execute(
        `CREATE TABLE notes (id TEXT PRIMARY KEY, owner_email TEXT, body TEXT)`,
      );
      await c.execute(
        `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
      );
      await c.execute(
        `CREATE TABLE chat_threads (id TEXT PRIMARY KEY, owner_email TEXT, thread_data TEXT)`,
      );
      await c.execute({
        sql: `INSERT INTO notes VALUES (?, ?, ?)`,
        args: ["n1", "a@x.com", "A-secret"],
      });
      await c.execute({
        sql: `INSERT INTO notes VALUES (?, ?, ?)`,
        args: ["n2", "b@x.com", "B-secret"],
      });
      await c.execute({
        sql: `INSERT INTO settings VALUES (?, ?, ?)`,
        args: [
          "u:a@x.com:credential:OPENAI_API_KEY",
          JSON.stringify({ value: "sk-AAA-secret" }),
          1,
        ],
      });
      await c.execute({
        sql: `INSERT INTO settings VALUES (?, ?, ?)`,
        args: ["u:a@x.com:pref:theme", JSON.stringify({ value: "dark" }), 1],
      });
      await c.execute({
        sql: `INSERT INTO chat_threads VALUES (?, ?, ?)`,
        args: ["thread-a", "a@x.com", "current thread"],
      });
      await c.execute({
        sql: `INSERT INTO chat_threads VALUES (?, ?, ?)`,
        args: ["thread-b", "a@x.com", "another private thread"],
      });
    });
    vi.stubEnv("AGENT_USER_EMAIL", "a@x.com");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  async function runQuery(sql: string): Promise<any> {
    const logs: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((...a: unknown[]) => {
        logs.push(a.map(String).join(" "));
      });
    try {
      const { default: dbQuery } = await import("./query.js");
      await dbQuery(["--sql", sql, "--db", dbFile, "--format", "json"]);
    } finally {
      spy.mockRestore();
    }
    const jsonLine = logs.find((l) => l.trim().startsWith("{"));
    return jsonLine ? JSON.parse(jsonLine) : { rows: [] };
  }

  async function runExec(sql: string): Promise<void> {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { default: dbExec } = await import("./exec.js");
      await dbExec(["--sql", sql, "--db", dbFile]);
    } finally {
      spy.mockRestore();
    }
  }

  it("rejects a schema-qualified read (the scope bypass)", async () => {
    const { default: dbQuery } = await import("./query.js");
    await expect(
      dbQuery(["--sql", "SELECT * FROM main.notes", "--db", dbFile]),
    ).rejects.toThrow(/schema-qualified/i);
  });

  it("scopes a normal SELECT to the current tenant only", async () => {
    const res = await runQuery("SELECT id, body FROM notes ORDER BY id");
    const bodies = res.rows.map((r: any) => r.body);
    expect(bodies).toContain("A-secret");
    expect(bodies).not.toContain("B-secret");
  });

  it("hides credential rows from the settings view, keeps other prefs", async () => {
    const res = await runQuery("SELECT key FROM settings");
    const keys = res.rows.map((r: any) => r.key);
    expect(keys).toContain("u:a@x.com:pref:theme");
    expect(keys.some((k: string) => k.includes(":credential:"))).toBe(false);
  });

  it("rejects raw reads of another private chat thread", async () => {
    await expect(
      runQuery("SELECT thread_data FROM chat_threads WHERE id = 'thread-b'"),
    ).rejects.toThrow(/Sensitive framework table "chat_threads"/);
  });

  it.each([
    "sandbox_executions",
    "automation_runs",
    "agent_trace_spans",
    "agent_trace_summaries",
    "agent_feedback",
    "agent_instruction_updates",
  ])("refuses member B any read of %s in a shared org", async (table) => {
    await withClient(async (c) => {
      await c.execute(
        `CREATE TABLE ${table} (id TEXT PRIMARY KEY, org_id TEXT, body TEXT)`,
      );
      // raw-sql-ok: the table name is one of the fixed names in this test's list; every value is bound
      await c.execute({
        sql: `INSERT INTO ${table} VALUES (?, ?, ?)`,
        args: ["row-a", "org-1", "A-private-run"],
      });
    });
    vi.stubEnv("AGENT_USER_EMAIL", "b@x.com");
    vi.stubEnv("AGENT_ORG_ID", "org-1");
    await expect(runQuery(`SELECT body FROM ${table}`)).rejects.toThrow(
      new RegExp(`Sensitive framework table "${table}"`),
    );
  });

  // The scoping views alone, with the db-query blocklist out of the picture:
  // what member B sees of the framework tables that carry org_id but no
  // owner_email, in an org shared with member A.
  async function seedOrgTable(table: string): Promise<void> {
    const { createSql, columns } = frameworkTables().get(table)!;
    await withClient(async (c) => {
      await c.execute(createSql);
      for (const column of columns) {
        await c.execute(
          `ALTER TABLE "${table}" ALTER COLUMN "${column}" DROP NOT NULL`,
        );
      }
      const ownerColumn = ["owner", "user_id"].find((column) =>
        columns.includes(column),
      );
      const rows = ownerColumn
        ? [
            ["a@x.com", "org-1"],
            ["b@x.com", "org-1"],
            ["b@x.com", "org-2"],
          ]
        : [
            [null, "org-1"],
            [null, "org-1"],
            [null, "org-2"],
          ];
      for (const [owner, org] of rows) {
        // raw-sql-ok: table and column names come from the framework schema snapshot; every value is bound
        await c.execute({
          sql: ownerColumn
            ? `INSERT INTO "${table}" ("${ownerColumn}", "org_id") VALUES (?, ?)`
            : `INSERT INTO "${table}" ("org_id") VALUES (?)`,
          args: ownerColumn ? [owner, org] : [org],
        });
      }
    });
  }

  async function rowsVisibleToMemberB(table: string): Promise<number> {
    vi.stubEnv("AGENT_USER_EMAIL", "b@x.com");
    vi.stubEnv("AGENT_ORG_ID", "org-1");
    const { buildScopingPostgres } = await import("./scoping.js");
    const client = await createPostgresScriptClient(url);
    try {
      let visible = -1;
      await client.begin(async (tx) => {
        const scoping = await buildScopingPostgres(tx);
        for (const setup of scoping.setup) await tx.unsafe(setup);
        const rows = await tx.unsafe(
          `SELECT count(*)::int AS n FROM "${table}"`,
        );
        visible = Number(rows[0].n);
      });
      return visible;
    } finally {
      await client.end();
    }
  }

  it.each([
    ["agent_feedback", 1],
    ["agent_instruction_updates", 1],
    ["agent_trace_spans", 1],
    ["agent_trace_summaries", 1],
    ["org_scim_memberships", 1],
    ["automation_runs", 1],
    ["sandbox_executions", 1],
    ["sync_events", 1],
    ["app_permission_overrides", 2],
    ["agent_human_review_summaries", 0],
    ["agent_turn_initiators", 0],
    ["app_member_roles", 0],
    ["automation_scheduler_health", 0],
    ["email_log", 0],
    ["integration_identity_links", 0],
    ["org_invitations", 0],
    ["org_members", 0],
    ["workspace_user_groups", 0],
  ])(
    "shows member B %s rows: %i of the 2 in B's org",
    async (table, visible) => {
      await seedOrgTable(table);
      expect(await rowsVisibleToMemberB(table)).toBe(visible);
    },
  );

  it("lets the org read the allowlisted table through db-query and nothing from an unlisted one", async () => {
    await seedOrgTable("app_permission_overrides");
    await seedOrgTable("workspace_user_groups");
    vi.stubEnv("AGENT_USER_EMAIL", "b@x.com");
    vi.stubEnv("AGENT_ORG_ID", "org-1");
    const shared = await runQuery(
      "SELECT org_id FROM app_permission_overrides",
    );
    expect(shared.rows.map((r: any) => r.org_id)).toEqual(["org-1", "org-1"]);
    const hidden = await runQuery("SELECT org_id FROM workspace_user_groups");
    expect(hidden.rows).toEqual([]);
  });

  it("keeps an app-defined org-only table readable by the whole org, and only that org", async () => {
    await withClient(async (c) => {
      await c.execute(
        `CREATE TABLE inventory_items (id TEXT PRIMARY KEY, org_id TEXT, sku TEXT)`,
      );
      for (const [id, org] of [
        ["i1", "org-1"],
        ["i2", "org-1"],
        ["i3", "org-2"],
      ]) {
        await c.execute({
          sql: `INSERT INTO inventory_items VALUES (?, ?, ?)`,
          args: [id, org, `sku-${id}`],
        });
      }
    });
    vi.stubEnv("AGENT_USER_EMAIL", "b@x.com");
    vi.stubEnv("AGENT_ORG_ID", "org-1");
    const result = await runQuery("SELECT id FROM inventory_items ORDER BY id");
    expect(result.rows.map((r: any) => r.id)).toEqual(["i1", "i2"]);
  });

  it("does not let member B delete an unlisted org table's rows", async () => {
    await seedOrgTable("email_log");
    vi.stubEnv("AGENT_USER_EMAIL", "b@x.com");
    vi.stubEnv("AGENT_ORG_ID", "org-1");
    await runExec("DELETE FROM email_log");
    const remaining = await withClient((c) =>
      c
        .execute(`SELECT count(*)::int AS n FROM email_log`)
        .then((r) => r as any[]),
    );
    expect(remaining[0].n).toBe(3);
  });

  it("refuses member B any read or write of the BI migration claim table in a shared org", async () => {
    await withClient(async (c) => {
      await c.execute(
        `CREATE TABLE bi_migration_external_dashboards (id TEXT PRIMARY KEY, org_id TEXT, migration_claim_token TEXT)`,
      );
      await c.execute({
        sql: `INSERT INTO bi_migration_external_dashboards VALUES (?, ?, ?)`,
        args: ["row-a", "org-1", "claim-token-a"],
      });
    });
    vi.stubEnv("AGENT_USER_EMAIL", "b@x.com");
    vi.stubEnv("AGENT_ORG_ID", "org-1");
    await expect(
      runQuery(
        "SELECT migration_claim_token FROM bi_migration_external_dashboards",
      ),
    ).rejects.toThrow(
      /Sensitive framework table "bi_migration_external_dashboards"/,
    );
    await expect(
      runExec(
        "DELETE FROM bi_migration_external_dashboards WHERE id = 'row-a'",
      ),
    ).rejects.toThrow(
      /Sensitive framework table "bi_migration_external_dashboards"/,
    );
  });

  it("rejects a schema-qualified write", async () => {
    const { default: dbExec } = await import("./exec.js");
    await expect(
      dbExec([
        "--sql",
        "UPDATE main.notes SET body = 'hacked'",
        "--db",
        dbFile,
      ]),
    ).rejects.toThrow(/schema-qualified/i);
    const rows = await withClient((c) =>
      c
        .execute(`SELECT body FROM notes WHERE owner_email = 'b@x.com'`)
        .then((r) => r),
    );
    expect(rows[0].body).toBe("B-secret");
  });

  it("scopes a normal DELETE to the current tenant (no cross-tenant wipe)", async () => {
    await runExec("DELETE FROM notes");
    const remaining = await withClient((c) =>
      c.execute(`SELECT owner_email, body FROM notes`).then((r) => r as any[]),
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0].owner_email).toBe("b@x.com");
  });

  it("scopes a normal UPDATE to the current tenant", async () => {
    await runExec("UPDATE notes SET body = 'edited'");
    const rows = await withClient((c) =>
      c
        .execute(`SELECT owner_email, body FROM notes ORDER BY owner_email`)
        .then((r) => r as any[]),
    );
    const byOwner = Object.fromEntries(
      rows.map((r) => [r.owner_email, r.body]),
    );
    expect(byOwner["a@x.com"]).toBe("edited");
    expect(byOwner["b@x.com"]).toBe("B-secret");
  });
});
