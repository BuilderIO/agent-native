import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanReleaseSchemaCoverage } from "./release-schema-complete.js";
import {
  STORE_REGISTRY_FILE,
  discoverStores,
  renderStoreRegistry,
} from "./store-registry-codegen.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function write(coreDir: string, rel: string, content: string): void {
  const abs = path.join(coreDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

function makeCore(
  files: Record<string, string>,
  { generate = true }: { generate?: boolean } = {},
): { root: string; coreDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-schema-guard-"));
  tempRoots.push(root);
  const coreDir = path.join(root, "packages", "core");
  for (const [rel, content] of Object.entries(files)) {
    write(coreDir, rel, content);
  }
  if (generate) {
    write(
      coreDir,
      STORE_REGISTRY_FILE,
      renderStoreRegistry(discoverStores(coreDir)),
    );
  }
  return { root, coreDir };
}

const store = (id: string) => `
import { ensureTableExists } from "../db/ddl-guard.js";
import { defineStore } from "../db/store-registry.js";
export const ${id}Store = defineStore({
  id: "${id}",
  migrations: [
    {
      name: "baseline",
      run: () => ensureTableExists("${id}", "CREATE TABLE IF NOT EXISTS ${id} (id TEXT)"),
    },
  ],
});
`;

const UNREGISTERED = `
import { ensureTableExists } from "../db/ddl-guard.js";
export async function ensureTable(): Promise<void> {
  await ensureTableExists("gadgets", "CREATE TABLE IF NOT EXISTS gadgets (id TEXT)");
}
`;

describe("scanReleaseSchemaCoverage", () => {
  it("passes when every module defining schema is a registered store", () => {
    const { root } = makeCore({ "src/widgets/store.ts": store("widgets") });

    expect(scanReleaseSchemaCoverage({ root }).findings).toEqual([]);
  });

  it("flags a module that creates tables outside a store", () => {
    const { root } = makeCore({
      "src/widgets/store.ts": store("widgets"),
      "src/gadgets/store.ts": UNREGISTERED,
    });

    const { findings } = scanReleaseSchemaCoverage({ root });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      file: "src/gadgets/store.ts",
      message: expect.stringContaining("never created on a hosted deploy"),
    });
  });

  it("flags a module that runs DDL held in a named constant", () => {
    const { root } = makeCore({
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

  it("flags a module that executes DDL from a local variable", () => {
    const { root } = makeCore({
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

  it("treats a module imported by release-migrations.ts as covered", () => {
    const { root } = makeCore({
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

  it("ignores modules that hold DDL without executing it", () => {
    const { root } = makeCore({
      "src/slots/schema.ts":
        'export const SLOT_CREATE_SQL = "CREATE TABLE IF NOT EXISTS slots (id TEXT)";',
      "src/slots/migrations.ts":
        'export const SLOT_MIGRATIONS = [{ version: 1, sql: "CREATE TABLE slots (id TEXT)" }];',
    });

    expect(scanReleaseSchemaCoverage({ root }).findings).toEqual([]);
  });

  it("ignores a non-DDL constant that happens to be executed", () => {
    const { root } = makeCore({
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
    const { root } = makeCore({
      "src/docs/notes.ts": `
        // Stores call ensureTableExists() to define their schema.
        /* See ensureTableExists( ) in db/ddl-guard.ts. */
        export const NOTE = 1;
      `,
    });

    expect(scanReleaseSchemaCoverage({ root }).findings).toEqual([]);
  });

  it("ignores specs, and the ddl-guard that implements the probe", () => {
    const { root } = makeCore({
      "src/widgets/store.spec.ts": UNREGISTERED,
      "src/db/ddl-guard.ts": UNREGISTERED,
    });

    expect(scanReleaseSchemaCoverage({ root }).findings).toEqual([]);
  });

  it("honours a reviewed opt-out marker", () => {
    const { root } = makeCore({
      "src/widgets/store.ts": `// guard:allow-unreleased-schema - local dev tooling only\n${UNREGISTERED}`,
    });

    expect(scanReleaseSchemaCoverage({ root }).findings).toEqual([]);
  });

  it("fails loudly when the generated registry is gone", () => {
    const { root } = makeCore(
      { "src/widgets/store.ts": store("widgets") },
      { generate: false },
    );

    const { findings } = scanReleaseSchemaCoverage({ root });

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe(STORE_REGISTRY_FILE);
  });

  it("flags a registry that no longer matches the stores in src", () => {
    const { root, coreDir } = makeCore({
      "src/widgets/store.ts": store("widgets"),
    });
    write(coreDir, "src/gadgets/store.ts", store("gadgets"));

    const { findings } = scanReleaseSchemaCoverage({ root });

    expect(findings.map((f) => f.message)).toEqual(
      expect.arrayContaining([expect.stringContaining("is stale")]),
    );
  });

  it("flags two stores that share an id", () => {
    const { root } = makeCore({
      "src/widgets/store.ts": store("widgets"),
      "src/widgets/copy.ts": store("widgets"),
    });

    const { findings } = scanReleaseSchemaCoverage({ root });

    expect(findings.map((f) => f.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('id "widgets" is declared more than once'),
      ]),
    );
  });
});
