import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

test("discovers ownable tables outside db/schema.ts, including sibling files", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "guard-ownable-discovery-"));
  const schemaDir = path.join(root, "packages/demo/src/schema");
  const serverDir = path.join(root, "packages/demo/src/server");
  mkdirSync(schemaDir, { recursive: true });
  mkdirSync(serverDir, { recursive: true });
  writeFileSync(
    path.join(schemaDir, "workflows.ts"),
    'export const workflows = pgTable("workflows", { ...ownableColumns() });',
  );
  writeFileSync(
    path.join(schemaDir, "webhooks.ts"),
    'export const webhooks = pgTable("webhooks", { ...ownableColumns() });',
  );
  writeFileSync(
    path.join(serverDir, "hooks.ts"),
    "export async function list() { return db.select().from(schema.webhooks); }",
  );

  try {
    const guard = (await import(
      pathToFileURL(path.resolve("scripts/guard-no-unscoped-queries.mjs")).href
    )) as {
      collectOwnableTables(root: string): Promise<Map<string, Set<string>>>;
      scanFiles(
        ownables: Map<string, Set<string>>,
        root: string,
      ): Promise<Array<{ file: string; hits: Array<{ name: string }> }>>;
    };
    const ownables = await guard.collectOwnableTables(root);
    const tables = ownables.get("packages/demo/src/schema");
    assert.ok(tables?.has("workflows"));
    assert.ok(tables?.has("webhooks"));

    const violations = await guard.scanFiles(ownables, root);
    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.file, "packages/demo/src/server/hooks.ts");
    assert.equal(violations[0]?.hits[0]?.name, "webhooks");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
