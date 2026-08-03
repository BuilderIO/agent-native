import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const installPrefix = process.env.S2573_PGLITE_INSTALL_PREFIX;
if (!installPrefix) {
  throw new Error("S2573_PGLITE_INSTALL_PREFIX is required.");
}

const requireFromFixture = createRequire(join(installPrefix, "package.json"));
const entry = requireFromFixture.resolve("@electric-sql/pglite");
const { PGlite } = await import(pathToFileURL(entry).href);
const client = await PGlite.create("memory://");

try {
  await client.exec(`
    CREATE TABLE content_databases (
      id TEXT PRIMARY KEY,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE content_database_items (
      id TEXT PRIMARY KEY,
      database_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO content_databases (id, updated_at)
      VALUES ('synthetic_pglite_database', '2026-01-01T00:00:00.000Z');
    INSERT INTO content_database_items (id, database_id, updated_at)
      VALUES (
        'synthetic_pglite_membership',
        'synthetic_pglite_database',
        '2026-01-01T00:00:00.000Z'
      );
  `);

  const databaseLock = await client.query(`
    UPDATE content_databases
    SET updated_at = updated_at
    WHERE id = 'synthetic_pglite_database'
    RETURNING id, updated_at
  `);
  const membershipLock = await client.query(`
    UPDATE content_database_items
    SET updated_at = updated_at
    WHERE id = 'synthetic_pglite_membership'
    RETURNING id, updated_at
  `);
  assert.deepEqual(databaseLock.rows, [
    {
      id: "synthetic_pglite_database",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ]);
  assert.deepEqual(membershipLock.rows, [
    {
      id: "synthetic_pglite_membership",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ]);

  await client.query(`
    UPDATE content_databases
    SET updated_at = '2026-01-02T00:00:00.000Z'
    WHERE id = 'synthetic_pglite_database'
  `);
  const touched = await client.query(`
    SELECT updated_at
    FROM content_databases
    WHERE id = 'synthetic_pglite_database'
  `);
  assert.equal(touched.rows[0]?.updated_at, "2026-01-02T00:00:00.000Z");
} finally {
  await client.close();
}
