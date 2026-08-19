import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, rmdirSync, symlinkSync } from "node:fs";
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
    CREATE TABLE documents (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL
    );
    INSERT INTO content_databases (id, updated_at)
      VALUES ('synthetic_pglite_database', '2026-01-01T00:00:00.000Z');
    INSERT INTO content_database_items (id, database_id, updated_at)
      VALUES (
        'synthetic_pglite_membership',
        'synthetic_pglite_database',
        '2026-01-01T00:00:00.000Z'
      );
    INSERT INTO documents (id, content)
      VALUES ('synthetic_pglite_document', '# Before');
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

  let releaseTransaction = () => {};
  const transactionReleased = new Promise((resolve) => {
    releaseTransaction = resolve;
  });
  let lockAcquired = () => {};
  const transactionLocked = new Promise((resolve) => {
    lockAcquired = resolve;
  });
  const transaction = client.transaction(async (tx) => {
    await tx.query(`
      UPDATE content_databases
      SET updated_at = updated_at
      WHERE id = 'synthetic_pglite_database'
    `);
    lockAcquired();
    await transactionReleased;
  });
  await transactionLocked;

  let editorWriteFinished = false;
  const editorWrite = client
    .query(`
      UPDATE documents
      SET content = '# Saved editor body'
      WHERE id = 'synthetic_pglite_document'
    `)
    .then(() => {
      editorWriteFinished = true;
    });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(editorWriteFinished, false);

  releaseTransaction();
  await transaction;
  await editorWrite;
  assert.equal(editorWriteFinished, true);
} finally {
  await client.close();
}

const driverPackage = join(
  installPrefix,
  "node_modules",
  "@electric-sql",
  "pglite",
);
const driverScopes = [
  join(process.cwd(), "node_modules", "@electric-sql"),
  join(process.cwd(), "packages", "core", "node_modules", "@electric-sql"),
];
const driverLinks = driverScopes.map((scopeDirectory) => ({
  scopeDirectory,
  scopeExisted: existsSync(scopeDirectory),
  driverLink: join(scopeDirectory, "pglite"),
}));
for (const { driverLink } of driverLinks) {
  if (existsSync(driverLink)) {
    throw new Error(
      `Refusing to replace existing PGlite driver at ${driverLink}`,
    );
  }
}
try {
  for (const { scopeDirectory, driverLink } of driverLinks) {
    mkdirSync(scopeDirectory, { recursive: true });
    symlinkSync(driverPackage, driverLink, "dir");
  }
  const actionSuite = spawnSync(
    "pnpm",
    [
      "--filter",
      "content",
      "exec",
      "vitest",
      "--run",
      "actions/migrate-content-database-rows.db.test.ts",
      "--config",
      "vitest.config.ts",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CONTENT_MIGRATION_TEST_BACKEND: "pglite",
      },
      stdio: "inherit",
    },
  );
  if (actionSuite.error) throw actionSuite.error;
  if (actionSuite.status !== 0) {
    throw new Error(
      `PGlite migration action suite failed with status ${actionSuite.status}.`,
    );
  }
} finally {
  for (const { scopeDirectory, scopeExisted, driverLink } of driverLinks) {
    if (existsSync(driverLink)) rmSync(driverLink);
    if (!scopeExisted && existsSync(scopeDirectory)) rmdirSync(scopeDirectory);
  }
}
