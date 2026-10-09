import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";
import { ownableColumns, table, text } from "../db/schema.js";
import { accessFilter } from "./access.js";
import { ensureSharingAccessIndexes } from "./indexes.js";
import { createSharesTable } from "./schema.js";

const docs = table("bl_docs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  ...ownableColumns(),
});
const docShares = createSharesTable("bl_doc_shares");

const DDL = `
  CREATE TABLE bl_docs (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, owner_email TEXT NOT NULL,
    org_id TEXT, visibility TEXT NOT NULL DEFAULT 'private'
  );
  CREATE TABLE bl_doc_shares (
    id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, principal_type TEXT NOT NULL,
    principal_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer',
    created_by TEXT NOT NULL, created_at TEXT NOT NULL, notified_at TEXT
  );
  CREATE TABLE bl_notes (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL);
  CREATE VIEW bl_docs_view AS SELECT * FROM bl_docs;
  CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL,
    created_at BIGINT NOT NULL, identity_authority TEXT, identity_id TEXT);
  CREATE TABLE org_members (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
    role TEXT NOT NULL, joined_at BIGINT NOT NULL, federation_removal_pending_at INTEGER);
  CREATE TABLE workspace_user_groups (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL,
    member_emails_json TEXT NOT NULL DEFAULT '[]', created_by_email TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL DEFAULT 0);
  INSERT INTO bl_docs (id, title, owner_email, org_id, visibility)
    SELECT 'd' || g, 't' || g, 'owner' || (g % 300) || '@example.com', 'org-a',
           CASE WHEN g % 7 = 0 THEN 'org' ELSE 'private' END
    FROM generate_series(1, 3000) g;
  INSERT INTO bl_doc_shares (id, resource_id, principal_type, principal_id, created_by, created_at)
    SELECT 's' || g, 'd' || (1 + (g * 37) % 3000), 'user',
           CASE WHEN g % 5 = 0 THEN 'Viewer@Example.com' ELSE 'other' || g || '@example.com' END,
           'x', 'now'
    FROM generate_series(1, 6000) g;
  ANALYZE;
`;

const viewerContext = { userEmail: "viewer@example.com", orgId: "org-a" };

async function createSeededDb() {
  const pg = await createTestPglite();
  await pg.exec(DDL);
  const exec: DbExec = {
    execute: async (statement) => {
      const result = await pg.query(
        typeof statement === "string" ? statement : statement.sql,
        typeof statement === "string" ? [] : statement.args,
      );
      return {
        rows: result.rows as Record<string, unknown>[],
        rowsAffected: result.affectedRows ?? 0,
      };
    },
  };
  return { pg, exec, db: drizzle(pg.db) };
}

async function indexDefinitions(
  pg: Awaited<ReturnType<typeof createSeededDb>>["pg"],
) {
  const { rows } = await pg.query(
    `SELECT tablename, indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' ORDER BY indexname`,
  );
  return rows as Array<{
    tablename: string;
    indexname: string;
    indexdef: string;
  }>;
}

async function schemaShape(
  pg: Awaited<ReturnType<typeof createSeededDb>>["pg"],
) {
  const columns = await pg.query(
    `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns WHERE table_schema = 'public'
      ORDER BY table_name, column_name`,
  );
  const constraints = await pg.query(
    `SELECT conrelid::regclass::text AS table_name, conname, contype
       FROM pg_constraint WHERE connamespace = 'public'::regnamespace
      ORDER BY conname`,
  );
  return { columns: columns.rows, constraints: constraints.rows };
}

async function dataFingerprint(
  pg: Awaited<ReturnType<typeof createSeededDb>>["pg"],
) {
  const { rows } = await pg.query(
    `SELECT (SELECT md5(string_agg(d::text, '|' ORDER BY d.id)) FROM bl_docs d) AS docs,
            (SELECT md5(string_agg(s::text, '|' ORDER BY s.id)) FROM bl_doc_shares s) AS shares`,
  );
  return rows[0];
}

interface PlanStats {
  shareRowsRead: number;
  shareSeqScans: number;
  indexNames: string[];
  executionMs: number;
}

type PlanNode = {
  "Node Type"?: string;
  "Relation Name"?: string;
  "Index Name"?: string;
  "Actual Rows"?: number;
  "Actual Loops"?: number;
  "Rows Removed by Filter"?: number;
  Plans?: PlanNode[];
};

function summarizePlan(
  root: PlanNode,
  executionMs: number,
  shareTable: string,
): PlanStats {
  const stats: PlanStats = {
    shareRowsRead: 0,
    shareSeqScans: 0,
    indexNames: [],
    executionMs,
  };
  const visit = (node: PlanNode) => {
    if (node["Relation Name"] === shareTable) {
      stats.shareRowsRead +=
        ((node["Actual Rows"] ?? 0) + (node["Rows Removed by Filter"] ?? 0)) *
        (node["Actual Loops"] ?? 1);
      if (node["Node Type"] === "Seq Scan") stats.shareSeqScans++;
    }
    if (node["Index Name"]) stats.indexNames.push(node["Index Name"]);
    for (const child of node.Plans ?? []) visit(child);
  };
  visit(root);
  return stats;
}

async function explainAccessFilter(
  pg: Awaited<ReturnType<typeof createSeededDb>>["pg"],
  db: Awaited<ReturnType<typeof createSeededDb>>["db"],
) {
  const { sql, params } = db
    .select({ id: docs.id })
    .from(docs)
    .where(accessFilter(docs, docShares, viewerContext))
    .toSQL();
  const explained = await pg.query(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
    params,
  );
  const [
    {
      "QUERY PLAN": [{ Plan, "Execution Time": executionMs }],
    },
  ] = explained.rows as unknown as Array<{
    "QUERY PLAN": Array<{ Plan: PlanNode; "Execution Time": number }>;
  }>;
  const result = await pg.query(sql, params);
  const ids = result.rows.map((row) => (row as { id: string }).id).sort();
  return {
    stats: summarizePlan(Plan, executionMs, "bl_doc_shares"),
    ids,
  };
}

describe("ensureSharingAccessIndexes", () => {
  it("adds only non-unique indexes to ownable and share tables; columns, constraints, and rows are unchanged", async () => {
    const { pg, exec } = await createSeededDb();
    const shapeBefore = await schemaShape(pg);
    const dataBefore = await dataFingerprint(pg);
    const indexesBefore = (await indexDefinitions(pg)).map((i) => i.indexname);

    const created = await ensureSharingAccessIndexes({ injectedClient: exec });

    expect(created).toBe(4);
    expect(await schemaShape(pg)).toEqual(shapeBefore);
    expect(await dataFingerprint(pg)).toEqual(dataBefore);

    const added = (await indexDefinitions(pg)).filter(
      (index) => !indexesBefore.includes(index.indexname),
    );
    expect(added.map((index) => index.indexname)).toEqual([
      "bl_doc_shares_access_principal_idx",
      "bl_doc_shares_access_principal_lower_idx",
      "bl_doc_shares_access_resource_idx",
      "bl_docs_access_owner_lower_idx",
    ]);
    for (const index of added) {
      expect(index.indexdef).not.toMatch(/UNIQUE/);
    }

    // A table without the ownable or share column shape gets no new index, and
    // a view with the ownable shape is skipped rather than failing CREATE INDEX.
    expect(added.filter((i) => i.tablename === "bl_notes")).toEqual([]);
    expect(added.filter((i) => i.tablename === "bl_docs_view")).toEqual([]);

    expect(await ensureSharingAccessIndexes({ injectedClient: exec })).toBe(0);
    await pg.close();
  });

  it("lets the user-share branch of the access filter use an index scan", async () => {
    const { pg, exec, db } = await createSeededDb();
    const before = await explainAccessFilter(pg, db);

    await ensureSharingAccessIndexes({ injectedClient: exec });
    await pg.exec("ANALYZE");
    const after = await explainAccessFilter(pg, db);

    expect(after.ids).toEqual(before.ids);
    expect(after.stats.indexNames).toContain(
      "bl_doc_shares_access_principal_lower_idx",
    );
    expect(after.stats.shareSeqScans).toBe(0);
    expect(after.stats.shareRowsRead).toBeLessThan(before.stats.shareRowsRead);
    await pg.close();
  });

  it("lets the owner clause use the lower(owner_email) index", async () => {
    const { pg, exec } = await createSeededDb();
    const owner = `SELECT id FROM bl_docs
                    WHERE lower(owner_email) = $1 AND (org_id = $2 OR org_id IS NULL)`;
    const params = ["owner7@example.com", "org-a"];
    const plan = async () => {
      const explained = await pg.query(
        `EXPLAIN (ANALYZE, FORMAT JSON) ${owner}`,
        params,
      );
      const [
        {
          "QUERY PLAN": [{ Plan }],
        },
      ] = explained.rows as unknown as Array<{
        "QUERY PLAN": Array<{ Plan: PlanNode }>;
      }>;
      return summarizePlan(Plan, 0, "bl_docs");
    };
    const before = await plan();
    await ensureSharingAccessIndexes({ injectedClient: exec });
    await pg.exec("ANALYZE");
    const after = await plan();

    expect(before.indexNames).not.toContain("bl_docs_access_owner_lower_idx");
    expect(after.indexNames).toContain("bl_docs_access_owner_lower_idx");
    await pg.close();
  });

  it("names every index within Postgres' 63-byte limit, including long registered table names", async () => {
    const { pg, exec } = await createSeededDb();
    // The two archive names share a 27-byte prefix, so plain truncation would
    // give both the same index name and IF NOT EXISTS would skip the second.
    await pg.exec(`
      CREATE TABLE creative_context_brand_profiles (
        id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, org_id TEXT,
        visibility TEXT NOT NULL DEFAULT 'private'
      );
      CREATE TABLE creative_context_brand_profile_shares (
        id TEXT PRIMARY KEY, resource_id TEXT NOT NULL,
        principal_type TEXT NOT NULL, principal_id TEXT NOT NULL
      );
      CREATE TABLE creative_context_brand_profile_shares_archive_one (
        id TEXT PRIMARY KEY, resource_id TEXT NOT NULL,
        principal_type TEXT NOT NULL, principal_id TEXT NOT NULL
      );
      CREATE TABLE creative_context_brand_profile_shares_archive_two (
        id TEXT PRIMARY KEY, resource_id TEXT NOT NULL,
        principal_type TEXT NOT NULL, principal_id TEXT NOT NULL
      );
    `);

    await ensureSharingAccessIndexes({ injectedClient: exec });

    const access = (await indexDefinitions(pg)).filter((index) =>
      index.indexname.includes("_access_"),
    );
    for (const index of access) {
      expect(
        new TextEncoder().encode(index.indexname).length,
      ).toBeLessThanOrEqual(63);
    }
    for (const table of [
      "creative_context_brand_profile_shares",
      "creative_context_brand_profile_shares_archive_one",
      "creative_context_brand_profile_shares_archive_two",
    ]) {
      expect(access.filter((index) => index.tablename === table)).toHaveLength(
        3,
      );
    }
    await pg.close();
  });
});
