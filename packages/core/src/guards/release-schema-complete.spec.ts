import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanReleaseSchemaCoverage } from "./release-schema-complete.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/** A miniature core package: the release list plus whatever stores are given. */
function makeCore(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-schema-guard-"));
  tempRoots.push(root);
  const coreDir = path.join(root, "packages", "core");
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(coreDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return root;
}

const listWith = (specs: string[]) =>
  specs.map((spec) => `import { ensureTable } from "${spec}";`).join("\n");

const STORE = `
import { ensureTableExists } from "../db/ddl-guard.js";
export async function ensureTable(): Promise<void> {
  await ensureTableExists("widgets", "CREATE TABLE IF NOT EXISTS widgets (id TEXT)");
}
`;

describe("scanReleaseSchemaCoverage", () => {
  it("passes when every store defining schema is in the release list", () => {
    const root = makeCore({
      "src/server/release-schema.ts": listWith(["../widgets/store.js"]),
      "src/widgets/store.ts": STORE,
    });

    expect(scanReleaseSchemaCoverage({ root }).findings).toEqual([]);
  });

  // The bug this guard exists for: a store whose tables nothing can create on a
  // hosted deploy, because production serverless never runs `ensureTable()`.
  it("flags a store that defines schema and is not in the list", () => {
    const root = makeCore({
      "src/server/release-schema.ts": listWith(["../widgets/store.js"]),
      "src/widgets/store.ts": STORE,
      "src/gadgets/store.ts": STORE,
    });

    const { findings } = scanReleaseSchemaCoverage({ root });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      file: "src/gadgets/store.ts",
      message: expect.stringContaining("never created on a hosted deploy"),
    });
  });

  // extensions/slots/store.ts creates its tables by executing named SQL
  // constants, so the ensureTableExists check alone could not see it.
  it("flags a store that runs DDL held in a named constant", () => {
    const root = makeCore({
      "src/server/release-schema.ts": listWith([]),
      "src/slots/store.ts": `
        import { SLOT_CREATE_SQL, SLOT_BY_KEY_INDEX_SQL } from "./schema.js";
        export async function ensureSlotTables(): Promise<void> {
          const client = getDbExec();
          await client.execute(SLOT_CREATE_SQL);
          await client.execute(SLOT_BY_KEY_INDEX_SQL);
        }
      `,
    });

    const { findings } = scanReleaseSchemaCoverage({ root });

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe("src/slots/store.ts");
  });

  // The commonest shape in the codebase: DDL built into a local variable and
  // executed directly, with no `ensureTableExists` and no recognisable constant
  // name. A guard keyed on the executed expression's NAME would miss this.
  it("flags a store that executes DDL from a local variable", () => {
    const root = makeCore({
      "src/server/release-schema.ts": listWith([]),
      "src/widgets/store.ts": `
        export async function ensureTable(): Promise<void> {
          const client = getDbExec();
          const createSql = \`CREATE TABLE IF NOT EXISTS widgets (id TEXT)\`;
          await client.execute(createSql);
        }
      `,
    });

    const { findings } = scanReleaseSchemaCoverage({ root });

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe("src/widgets/store.ts");
  });

  // Reached through the migration half of the release path rather than the
  // ensure list, so it is created at release either way.
  it("treats a module imported by release-migrations.ts as covered", () => {
    const root = makeCore({
      "src/server/release-schema.ts": listWith([]),
      "src/server/release-migrations.ts":
        'import { runBetterAuthMigrations } from "./better-auth-migrations.js";',
      "src/server/better-auth-migrations.ts": `
        export async function runBetterAuthMigrations(): Promise<void> {
          const createSql = \`CREATE TABLE IF NOT EXISTS auth_user (id TEXT)\`;
          await getDbExec().execute(createSql);
        }
      `,
    });

    expect(scanReleaseSchemaCoverage({ root }).findings).toEqual([]);
  });

  // A `schema.ts` holding the SQL is not the thing that runs it, and a migration
  // list is applied by runMigrations. Flagging either is pure noise.
  it("ignores modules that hold DDL without executing it", () => {
    const root = makeCore({
      "src/server/release-schema.ts": listWith([]),
      "src/slots/schema.ts":
        'export const SLOT_CREATE_SQL = "CREATE TABLE IF NOT EXISTS slots (id TEXT)";',
      "src/slots/migrations.ts":
        'export const SLOT_MIGRATIONS = [{ version: 1, sql: "CREATE TABLE slots (id TEXT)" }];',
    });

    expect(scanReleaseSchemaCoverage({ root }).findings).toEqual([]);
  });

  // A plain SELECT held in a constant is not schema.
  it("ignores a non-DDL constant that happens to be executed", () => {
    const root = makeCore({
      "src/server/release-schema.ts": listWith([]),
      "src/server/db-pressure.ts": `
        import { DB_PRESSURE_SQL } from "./sql.js";
        export async function probe(exec) {
          return exec.execute(DB_PRESSURE_SQL);
        }
      `,
    });

    expect(scanReleaseSchemaCoverage({ root }).findings).toEqual([]);
  });

  it("ignores files that only name ensureTableExists in a comment", () => {
    const root = makeCore({
      "src/server/release-schema.ts": listWith([]),
      "src/docs/notes.ts": `
        // Stores call ensureTableExists() to define their schema.
        /* See ensureTableExists( ) in db/ddl-guard.ts. */
        export const NOTE = 1;
      `,
    });

    expect(scanReleaseSchemaCoverage({ root }).findings).toEqual([]);
  });

  it("ignores specs, and the ddl-guard that implements the probe", () => {
    const root = makeCore({
      "src/server/release-schema.ts": listWith([]),
      "src/widgets/store.spec.ts": STORE,
      "src/db/ddl-guard.ts": STORE,
    });

    expect(scanReleaseSchemaCoverage({ root }).findings).toEqual([]);
  });

  it("honours a reviewed opt-out marker", () => {
    const root = makeCore({
      "src/server/release-schema.ts": listWith([]),
      "src/widgets/store.ts": `// guard:allow-unreleased-schema - local dev tooling only\n${STORE}`,
    });

    expect(scanReleaseSchemaCoverage({ root }).findings).toEqual([]);
  });

  // A missing list is the one failure that must not read as "nothing to check":
  // deleting it would stop every framework table from being created at release.
  it("fails loudly when the release list itself is gone", () => {
    const root = makeCore({ "src/widgets/store.ts": STORE });

    const { findings } = scanReleaseSchemaCoverage({ root });

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe("src/server/release-schema.ts");
  });
});
