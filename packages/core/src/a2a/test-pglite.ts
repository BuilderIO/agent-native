import { PGlite } from "@electric-sql/pglite";

function postgresSql(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

export async function createTestPglite() {
  const db = await PGlite.create("memory://");
  return {
    db,
    async exec(sql: string) {
      await (db as any).exec(sql);
    },
    async query(sql: string, args: unknown[] = []) {
      return db.query(
        postgresSql(sql),
        args.map((value) => (value === undefined ? null : value)),
      );
    },
    prepare(sql: string) {
      const query = postgresSql(sql);
      return {
        async all(...args: unknown[]) {
          return (await db.query(query, args)).rows;
        },
        async get(...args: unknown[]) {
          return (await db.query(query, args)).rows[0];
        },
        async run(...args: unknown[]) {
          const result = await db.query(query, args);
          return { changes: result.affectedRows ?? result.rowCount ?? 0 };
        },
      };
    },
    async close() {
      await db.close();
    },
  };
}
