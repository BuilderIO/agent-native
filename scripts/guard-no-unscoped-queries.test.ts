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

test("ignores ownable tables that only appear in comments", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "guard-ownable-comments-"));
  const schemaDir = path.join(root, "packages/demo/src/templates/app/drizzle");
  mkdirSync(schemaDir, { recursive: true });
  writeFileSync(
    path.join(schemaDir, "schema.ts"),
    [
      '// export const notes = pgTable("notes", {',
      "//   ...ownableColumns(),",
      "// });",
      'export const tasks = pgTable("tasks", { ...ownableColumns() });',
    ].join("\n"),
  );

  try {
    const guard = (await import(
      pathToFileURL(path.resolve("scripts/guard-no-unscoped-queries.mjs")).href
    )) as {
      collectOwnableTables(root: string): Promise<Map<string, Set<string>>>;
    };
    const tables = (await guard.collectOwnableTables(root)).get(
      "packages/demo/src/templates/app/drizzle",
    );
    assert.ok(tables?.has("tasks"));
    assert.equal(tables?.has("notes"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test("scopes ownable table matching to the owning unit plus packages/core", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "guard-ownable-units-"));
  const write = (rel: string, text: string) => {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };
  write(
    "packages/core/src/chat-threads/schema.ts",
    'export const chatThreads = pgTable("chat_threads", { ...ownableColumns() });',
  );
  write(
    "templates/notes/server/db/schema.ts",
    'export const notes = pgTable("notes", { ...ownableColumns() });',
  );
  write(
    "templates/notes/server/lib/store.ts",
    "export async function list() { return db.select().from(schema.notes); }",
  );
  write(
    "templates/analytics/server/lib/data-notes-store.ts",
    "const notes = schema.analyticsDataNotes;\nexport async function list() { return db.select().from(notes); }",
  );
  write(
    "templates/analytics/server/lib/core-leak.ts",
    "export async function leak() { return db.select().from(schema.chatThreads); }",
  );
  write(
    "templates/analytics/server/plugins/chat.ts",
    "export const cfg = { mentionProviders: { notes: { search: async () => { return db.select().from(notes); } } } };",
  );
  write(
    "templates/notes/server/plugins/chat.ts",
    "export const cfg = { mentionProviders: { notes: { search: async () => { return db.select().from(schema.notes); } } } };",
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
      scanMentionProviders(
        ownables: Map<string, Set<string>>,
        root: string,
      ): Promise<Array<{ file: string; table: string }>>;
    };
    const ownables = await guard.collectOwnableTables(root);
    const violations = await guard.scanFiles(ownables, root);
    assert.deepEqual(
      violations
        .map((v) => ({
          file: v.file,
          tables: v.hits.map((h) => h.name),
        }))
        .sort((a, b) => a.file.localeCompare(b.file)),
      [
        {
          file: "templates/analytics/server/lib/core-leak.ts",
          tables: ["chatThreads"],
        },
        {
          file: "templates/notes/server/lib/store.ts",
          tables: ["notes"],
        },
        {
          file: "templates/notes/server/plugins/chat.ts",
          tables: ["notes"],
        },
      ],
    );

    const mentionViolations = await guard.scanMentionProviders(ownables, root);
    assert.deepEqual(
      mentionViolations.map((v) => ({ file: v.file, table: v.table })),
      [{ file: "templates/notes/server/plugins/chat.ts", table: "notes" }],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
