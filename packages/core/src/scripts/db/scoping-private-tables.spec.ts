import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runWithRequestContext } from "../../server/request-context.js";
import { finalRawDbSql, verifyRawDbStatement } from "./safety.js";
import { buildScopingPostgres } from "./scoping.js";

let client: PGlite;
beforeAll(async () => {
  client = await PGlite.create();
  await client.exec(`
    CREATE TABLE private_payload(id TEXT PRIMARY KEY,owner_email TEXT,org_id TEXT,body TEXT);
    CREATE TABLE private_claim(id TEXT PRIMARY KEY,org_id TEXT,body TEXT);
    CREATE TABLE normal_payload(id TEXT PRIMARY KEY,owner_email TEXT,body TEXT,private_description TEXT);
    INSERT INTO private_payload VALUES('evidence','owner@example.com','org-a','private');
    INSERT INTO private_claim VALUES('claim','org-a','private');
    INSERT INTO normal_payload VALUES('normal','owner@example.com','ordinary','private source text');
    COMMENT ON COLUMN normal_payload.private_description IS 'agent-native:raw-db-denied';
    COMMENT ON TABLE private_payload IS 'agent-native:raw-db-denied';
    COMMENT ON TABLE private_claim IS 'agent-native:raw-db-denied';
  `);
});
afterAll(async () => client.close());

const runner = {
  unsafe: async (sql: string, args: unknown[] = []) =>
    (await client.query(sql, args)).rows,
};

describe("persisted action-only SQL policy", () => {
  it.each(["owner@example.com", "member@example.com"])(
    "refuses reads, counts and mutations for %s even with owner or organization columns",
    async (userEmail) => {
      await runWithRequestContext({ userEmail, orgId: "org-a" }, async () => {
        const scope = await buildScopingPostgres(runner);
        expect([...scope.deniedTables]).toEqual([
          "private_claim",
          "private_payload",
        ]);
        await client.exec(scope.setup.join(";"));
        for (const table of ["private_payload", "private_claim"]) {
          for (const [sql, kind] of [
            [`SELECT body FROM ${table}`, "read"],
            [`SELECT count(*) FROM ${table}`, "read"],
            [`SELECT body FROM (SELECT * FROM ${table}) nested`, "read"],
            [`UPDATE ${table} SET body='changed' RETURNING body`, "write"],
            [`DELETE FROM ${table} RETURNING body`, "write"],
            [
              `INSERT INTO ${table}(id,body) VALUES('new','changed') RETURNING body`,
              "write",
            ],
          ] as const) {
            const statement = finalRawDbSql(sql, kind).statement;
            await expect(
              verifyRawDbStatement(runner, statement, {
                deniedTables: scope.deniedTables,
              }),
            ).rejects.toMatchObject({
              errorCode: "raw_db_table_forbidden",
              statusCode: 403,
            });
          }
          expect(
            await client.query(`SELECT count(*) AS count FROM ${table}`),
          ).toMatchObject({ rows: [{ count: 0 }] });
        }
        const ordinary = finalRawDbSql(
          "SELECT body FROM normal_payload",
          "read",
        );
        await expect(
          verifyRawDbStatement(runner, ordinary.statement, {
            deniedTables: scope.deniedTables,
          }),
        ).resolves.toBeUndefined();
        expect(
          await client.query("SELECT body FROM public.private_payload"),
        ).toMatchObject({ rows: [{ body: "private" }] });
        await client.exec(scope.teardown.join(";"));
      });
    },
  );
  it("keeps ordinary columns queryable while denying marked columns and stripping them from star and row projections", async () => {
    await runWithRequestContext(
      { userEmail: "owner@example.com", orgId: "org-a" },
      async () => {
        const scope = await buildScopingPostgres(runner);
        await client.exec(scope.setup.join(";"));
        for (const [sql, kind] of [
          ["SELECT private_description FROM normal_payload", "read"],
          [
            "SELECT normal_payload.private_description FROM normal_payload",
            "read",
          ],
          ["SELECT count(private_description) FROM normal_payload", "read"],
          [
            "SELECT private_description FROM (SELECT * FROM normal_payload) nested",
            "read",
          ],
          [
            "UPDATE normal_payload SET private_description='changed' RETURNING body",
            "write",
          ],
          [
            "INSERT INTO normal_payload(id,private_description) VALUES('new','changed') RETURNING body",
            "write",
          ],
        ] as const)
          await expect(
            verifyRawDbStatement(runner, finalRawDbSql(sql, kind).statement, {
              deniedColumns: scope.deniedColumns,
            }),
          ).rejects.toMatchObject({
            errorCode: "raw_db_column_forbidden",
            statusCode: 403,
          });
        const ordinary = finalRawDbSql("SELECT * FROM normal_payload", "read");
        await expect(
          verifyRawDbStatement(runner, ordinary.statement, {
            deniedColumns: scope.deniedColumns,
          }),
        ).resolves.toBeUndefined();
        expect(await client.query(ordinary.sql)).toMatchObject({
          rows: [
            {
              id: "normal",
              owner_email: "owner@example.com",
              body: "ordinary",
            },
          ],
        });
        const row = await client.query<{ row: Record<string, unknown> }>(
          "SELECT to_jsonb(normal_payload) AS row FROM normal_payload",
        );
        expect(row.rows[0]?.row).not.toHaveProperty("private_description");
        await client.query(
          "UPDATE normal_payload SET body='edited' WHERE id='normal'",
        );
        expect(
          await client.query(
            "SELECT private_description FROM public.normal_payload",
          ),
        ).toMatchObject({
          rows: [{ private_description: "private source text" }],
        });
        await client.exec(scope.teardown.join(";"));
      },
    );
  });
  it.each([
    "SELECT * FROM public.private_payload",
    'SELECT * FROM public."private_payload"',
    "COMMENT ON TABLE private_payload IS ''",
    "ALTER TABLE private_payload RENAME TO public_payload",
    "DROP VIEW private_payload",
  ])("refuses schema or DDL bypasses: %s", (sql) => {
    expect(() =>
      finalRawDbSql(sql, sql.startsWith("SELECT") ? "read" : "write"),
    ).toThrow();
  });
});
