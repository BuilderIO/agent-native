import assert from "node:assert/strict";
import test from "node:test";

import {
  isMigrationSourceFile,
  scanMigrationSource,
} from "./guard-additive-migrations.mjs";

test("selects and rejects destructive SQL in independently exported module migrations", () => {
  const fixture = [
    {
      file: "templates/example/server/db/report-migrations.ts",
      source:
        "export const change: MigrationEntry = { version: 12, sql: `DROP TABLE saved_records;` };",
    },
    {
      file: "templates/example/server/db/sequence-migrations.ts",
      source:
        "export const changes = [{ version: 13, sql: `ALTER TABLE saved_records DROP COLUMN title;` }];",
    },
    {
      file: "templates/example/actions/synthetic.spec.ts",
      source: "const fixture = `DROP TABLE saved_records;`;",
    },
  ];
  const selected = fixture.filter(({ file }) => isMigrationSourceFile(file));
  assert.equal(selected.length, 2);
  const findings = selected.flatMap(({ file, source }) =>
    scanMigrationSource(file, source),
  );
  assert.equal(findings.length, 2);
  assert.match(findings[0].message, /DROP TABLE/);
  assert.match(findings[1].message, /DROP COLUMN/);
});

test("retains existing entrypoints and excludes tests and the migration engine", () => {
  for (const file of [
    "templates/example/server/db/migrations.ts",
    "templates/example/server/plugins/db.ts",
    "templates/example/supabase/migrations/001.sql",
  ])
    assert.equal(isMigrationSourceFile(file), true, file);
  for (const file of [
    "templates/example/server/db/module-migrations.spec.ts",
    "templates/example/server/db/module-migrations.test.ts",
    "packages/core/src/db/migrations.ts",
    "templates/example/actions/edit-record.ts",
  ])
    assert.equal(isMigrationSourceFile(file), false, file);
});

test("accepts additive module SQL and rejects blocking columns without a usable default", () => {
  const file = "templates/example/server/db/task-migrations.ts";
  assert.equal(isMigrationSourceFile(file), true);
  assert.deepEqual(
    scanMigrationSource(
      file,
      "export const migration = { version: 1, sql: `CREATE TABLE item (id TEXT PRIMARY KEY); ALTER TABLE item ADD COLUMN title TEXT;` };",
    ),
    [],
  );
  const findings = scanMigrationSource(
    file,
    "export const migration = { version: 2, sql: `ALTER TABLE item ADD COLUMN title TEXT NOT NULL;` };",
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /no DEFAULT/);
  assert.deepEqual(
    scanMigrationSource(
      file,
      "export const migration = { version: 3, sql: `ALTER TABLE item ADD COLUMN title TEXT NOT NULL DEFAULT '';` };",
    ),
    [],
  );
});

test("retains duplicate-version detection within each independent migration array", () => {
  const file = "templates/example/server/db/record-migrations.ts";
  const findings = scanMigrationSource(
    file,
    "export const changes = [{ version: 1, sql: `CREATE TABLE first_item (id TEXT);` }, { version: 1, sql: `CREATE TABLE second_item (id TEXT);` }];",
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /duplicate migration version 1/);
  assert.deepEqual(
    scanMigrationSource(
      file,
      "export const first = [{ version: 1, sql: `CREATE TABLE first_item (id TEXT);` }]; export const second = [{ version: 1, sql: `CREATE TABLE second_item (id TEXT);` }];",
    ),
    [],
  );
});
