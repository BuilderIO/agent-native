import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  addChangedSqlCallSiteModules,
  addChangedSqlExecuteWrapperModules,
  findRawSqlInterpolationViolations,
  findRawSqlInterpolationViolationsInSources,
  findChangedSqlHelperExports,
  removedPragmaAffectedLines,
  resolveImportedSourceFile,
  type RawSqlGuardSource,
} from "./guard-no-raw-sql-interpolation.js";
import { parseRemovedLines } from "./lib/changed-lines.mjs";

const FILE = "packages/core/src/example.ts";

function source(lines: string[]): string {
  const hasDatabaseBinding = lines.some((line) =>
    /\b(?:const|let|var)\s+database\b/.test(line),
  );
  return [
    ...lines,
    'import { getDbExec } from "./db/client.js";',
    ...(hasDatabaseBinding ? [] : ["const database = getDbExec();"]),
  ].join("\n");
}

describe("raw SQL interpolation guard", () => {
  it("finds interpolated SQL template properties on added lines", () => {
    const text = source([
      "const query = {",
      "  sql: `SELECT * FROM records WHERE id = ${recordId}`",
      "};",
    ]);

    expect(findRawSqlInterpolationViolations(FILE, text, new Set([2]))).toEqual(
      [
        {
          file: FILE,
          line: 2,
          snippet: "sql: `SELECT * FROM records WHERE id = ${recordId}`",
        },
      ],
    );
  });

  it("catches a multiline template when only its interpolation line was added", () => {
    const text = source([
      "const query = {",
      "  sql: `SELECT id FROM records",
      "    WHERE workspace_id =",
      "      ${workspaceId}`",
      "};",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([4])),
    ).toHaveLength(1);
  });

  it("finds interpolated templates passed directly to execute", () => {
    const text = source([
      "const database = getDbExec();",
      "database.execute(`SELECT * FROM records WHERE id = ${recordId}`);",
      "const execute = database.execute;",
      "execute(`DELETE FROM records WHERE id = ${recordId}`);",
      'database["execute"](`UPDATE records SET active = ${active}`);',
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([2, 4, 5])),
    ).toEqual([
      {
        file: FILE,
        line: 2,
        snippet:
          "database.execute(`SELECT * FROM records WHERE id = ${recordId}`);",
      },
      {
        file: FILE,
        line: 4,
        snippet: "execute(`DELETE FROM records WHERE id = ${recordId}`);",
      },
      {
        file: FILE,
        line: 5,
        snippet:
          'database["execute"](`UPDATE records SET active = ${active}`);',
      },
    ]);
  });

  it("finds interpolated templates passed through an execute alias", () => {
    const text = source([
      "const database = getDbExec();",
      "const runQuery = database.execute;",
      "const alias = runQuery;",
      "alias(`SELECT * FROM records WHERE id = ${recordId}`);",
    ]);

    expect(findRawSqlInterpolationViolations(FILE, text, new Set([4]))).toEqual(
      [
        {
          file: FILE,
          line: 4,
          snippet: "alias(`SELECT * FROM records WHERE id = ${recordId}`);",
        },
      ],
    );
  });

  it("recognizes execute bindings destructured from DbExec values", () => {
    const direct = source([
      "const { execute } = getDbExec();",
      "execute(`DELETE FROM records WHERE id = ${recordId}`);",
    ]);
    const renamed = source([
      "const database = getDbExec();",
      "const { execute: runQuery } = database;",
      "runQuery(`DELETE FROM records WHERE id = ${recordId}`);",
    ]);
    const assigned = source([
      "const database = getDbExec();",
      "let runQuery: (...args: unknown[]) => unknown;",
      "({ execute: runQuery } = database);",
      "runQuery(`DELETE FROM records WHERE id = ${recordId}`);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, direct, new Set([2])),
    ).toHaveLength(1);
    expect(
      findRawSqlInterpolationViolations(FILE, renamed, new Set([3])),
    ).toHaveLength(1);
    expect(
      findRawSqlInterpolationViolations(FILE, assigned, new Set([4])),
    ).toHaveLength(1);
  });

  it("recognizes DbExec factory calls through a core namespace import", () => {
    const safe = source([
      'import * as coreDb from "./db/index.js";',
      "coreDb.getDbExec().execute(`SELECT * FROM records WHERE id = ${recordId}`);",
    ]);
    const unrelated = source([
      'import * as coreDb from "./other.js";',
      "coreDb.getDbExec().execute(`SELECT * FROM records WHERE id = ${recordId}`);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, safe, new Set([2])),
    ).toHaveLength(1);
    expect(
      findRawSqlInterpolationViolations(FILE, unrelated, new Set([2])),
    ).toEqual([]);
  });

  it("recognizes optional execute calls from the scoped DbExec factory", () => {
    const text = source([
      'import { getScopedDbExec } from "./db/client.js";',
      "getScopedDbExec()?.execute(`SELECT * FROM records WHERE id = ${recordId}`);",
    ]);

    expect(findRawSqlInterpolationViolations(FILE, text, new Set([2]))).toEqual(
      [
        {
          file: FILE,
          line: 2,
          snippet:
            "getScopedDbExec()?.execute(`SELECT * FROM records WHERE id = ${recordId}`);",
        },
      ],
    );
  });

  it("recognizes bound and call-wrapped DbExec execute methods", () => {
    const text = source([
      "const database = getDbExec();",
      "database.execute.bind(database)(`SELECT * FROM records WHERE id = ${recordId}`);",
      "database.execute.call(database, `SELECT * FROM records WHERE id = ${recordId}`);",
      'database["execute"]["bind"](database)(`SELECT * FROM records WHERE id = ${recordId}`);',
      'database["execute"]["call"](database, `SELECT * FROM records WHERE id = ${recordId}`);',
      "const boundExecute = database.execute.bind(database);",
      "boundExecute(`SELECT * FROM records WHERE id = ${recordId}`);",
    ]);

    expect(
      findRawSqlInterpolationViolations(
        FILE,
        text,
        new Set([2, 3, 4, 5, 7]),
      ).map((finding) => finding.line),
    ).toEqual([2, 3, 4, 5, 7]);
  });

  it("recognizes execute calls routed through apply", () => {
    const text = source([
      "const database = getDbExec();",
      "database.execute.apply(database, [`SELECT * FROM records WHERE id = ${recordId}`]);",
      'database["execute"]["apply"](database, [`DELETE FROM records WHERE id = ${recordId}`]);',
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([2, 3])).map(
        (finding) => finding.line,
      ),
    ).toEqual([2, 3]);
  });

  it("tracks SQL passed through a variable argument list to apply", () => {
    const text = source([
      "const database = getDbExec();",
      "const args = [`SELECT * FROM records WHERE id = ${recordId}`];",
      "database.execute.apply(database, args);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([2, 3])).map(
        (finding) => finding.line,
      ),
    ).toEqual([2]);
  });

  it("recognizes awaited createDbExec results as SQL sinks", () => {
    const text = source([
      'import { createDbExec } from "./db/client.js";',
      "const database = await createDbExec();",
      "database.execute(`SELECT * FROM records WHERE id = ${recordId}`);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([3])),
    ).toHaveLength(1);
  });

  it("does not treat a non-DbExec execute method as a SQL sink", () => {
    const text = source([
      'import { sql } from "drizzle-orm";',
      "declare const transaction: { execute(query: unknown): Promise<unknown> };",
      "transaction.execute(sql`SELECT * FROM records WHERE id = ${recordId}`);",
    ]);

    expect(findRawSqlInterpolationViolations(FILE, text, new Set([3]))).toEqual(
      [],
    );
  });

  it("recognizes DbExec-typed parameters as SQL sinks", () => {
    const text = source([
      'import type { DbExec } from "./db/client.js";',
      "declare const transaction: DbExec;",
      "transaction.execute(`SELECT * FROM records WHERE id = ${recordId}`);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([3])),
    ).toHaveLength(1);
  });

  it("recognizes optional execute calls on union-typed DbExec values", () => {
    const text = source([
      'import type { DbExec } from "./db/client.js";',
      "declare const transaction: DbExec | undefined;",
      "transaction?.execute(`SELECT * FROM records WHERE id = ${recordId}`);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([3])),
    ).toHaveLength(1);
  });

  it("recognizes DbExec receivers reached through class and object properties", () => {
    const classProperty = source([
      'import type { DbExec } from "./db/client.js";',
      "class Context {",
      "  db: DbExec;",
      "  run(recordId: string) {",
      "    this.db.execute(`SELECT * FROM records WHERE id = ${recordId}`);",
      "  }",
      "}",
    ]);
    const inferredClassProperty = source([
      "class Context {",
      "  private db = getDbExec();",
      "  run(recordId: string) {",
      "    this.db.execute(`SELECT * FROM records WHERE id = ${recordId}`);",
      "  }",
      "}",
    ]);
    const objectProperty = source([
      "const context = { db: getDbExec() };",
      "context.db.execute(`SELECT * FROM records WHERE id = ${recordId}`);",
    ]);
    const unrelated = source([
      "const context = { db: { execute: (query: unknown) => query } };",
      "context.db.execute(`SELECT * FROM records WHERE id = ${recordId}`);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, classProperty, new Set([5])),
    ).toHaveLength(1);
    expect(
      findRawSqlInterpolationViolations(
        FILE,
        inferredClassProperty,
        new Set([4]),
      ),
    ).toHaveLength(1);
    expect(
      findRawSqlInterpolationViolations(FILE, objectProperty, new Set([2])),
    ).toHaveLength(1);
    expect(
      findRawSqlInterpolationViolations(FILE, unrelated, new Set([2])),
    ).toEqual([]);
  });

  it("recognizes the fenced-write callback's contextual DbExec parameter", () => {
    const text = source([
      'import { withFencedExecutionWrite } from "./agent/execution-fence.js";',
      "withFencedExecutionWrite((tx) =>",
      "  tx.execute(`SELECT * FROM records WHERE id = ${recordId}`),",
      ");",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([3])),
    ).toHaveLength(1);
  });

  it("recognizes a transaction callback on a DbExec receiver", () => {
    const text = source([
      "database.transaction((tx) =>",
      "  tx.execute(`SELECT * FROM records WHERE id = ${recordId}`),",
      ");",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([2])),
    ).toHaveLength(1);
  });

  it("recognizes callbacks typed with DbExec through local transaction wrappers", () => {
    const text = source([
      "async function withDbTransaction<T>(client: ReturnType<typeof getDbExec>, fn: (tx: ReturnType<typeof getDbExec>) => Promise<T>): Promise<T> {",
      "  return fn(client);",
      "}",
      "withDbTransaction(database, async (tx) =>",
      "  tx.execute(`SELECT * FROM records WHERE id = ${recordId}`),",
      ");",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([5])),
    ).toHaveLength(1);
  });

  it("recognizes a DbExec callback in the first argument of a local wrapper", () => {
    const text = source([
      "async function withTransaction<T>(fn: (tx: ReturnType<typeof getDbExec>) => Promise<T>): Promise<T> {",
      "  return fn(getDbExec());",
      "}",
      "withTransaction(async (tx) =>",
      "  tx.execute(`SELECT * FROM records WHERE id = ${recordId}`),",
      ");",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([5])),
    ).toHaveLength(1);
  });

  it("recognizes a DbExec callback typed by an imported transaction wrapper", () => {
    const text = source([
      'import { withServicePrincipalLifecycleLock } from "./org/service-principal-policy.js";',
      'withServicePrincipalLifecycleLock("org", "service", async (tx) =>',
      "  tx.execute(`SELECT * FROM records WHERE id = ${recordId}`),",
      ");",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([3])),
    ).toHaveLength(1);
  });

  it("recognizes DbExec factories from trusted dynamic imports", () => {
    const immediate = source([
      '(await import("./db/index.js")).getDbExec().execute(`SELECT * FROM records WHERE id = ${recordId}`);',
    ]);
    const namespace = source([
      'const coreDb = await import("./db/index.js");',
      "coreDb.getDbExec().execute(`SELECT * FROM records WHERE id = ${recordId}`);",
    ]);
    const namespaceAlias = source([
      'const coreDb = await import("./db/index.js");',
      "const dbModule = coreDb;",
      "dbModule.getDbExec().execute(`SELECT * FROM records WHERE id = ${recordId}`);",
    ]);
    const destructured = source([
      'const { getDbExec: createDbExec } = await import("./db/index.js");',
      "createDbExec().execute(`SELECT * FROM records WHERE id = ${recordId}`);",
    ]);
    const unrelated = source([
      'const { getDbExec: createDbExec } = await import("./other.js");',
      "createDbExec().execute(`SELECT * FROM records WHERE id = ${recordId}`);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, immediate, new Set([1])),
    ).toHaveLength(1);
    expect(
      findRawSqlInterpolationViolations(FILE, namespace, new Set([2])),
    ).toHaveLength(1);
    expect(
      findRawSqlInterpolationViolations(FILE, namespaceAlias, new Set([3])),
    ).toHaveLength(1);
    expect(
      findRawSqlInterpolationViolations(FILE, destructured, new Set([2])),
    ).toHaveLength(1);
    expect(
      findRawSqlInterpolationViolations(FILE, unrelated, new Set([2])),
    ).toEqual([]);
  });

  it("finds interpolated templates assigned to a variable before execute", () => {
    const text = source([
      "const statement = `SELECT * FROM records WHERE id = ${recordId}`;",
      "const alias = statement;",
      "database.execute(alias);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([1, 2, 3])),
    ).toEqual([
      {
        file: FILE,
        line: 1,
        snippet:
          "const statement = `SELECT * FROM records WHERE id = ${recordId}`;",
      },
      {
        file: FILE,
        line: 2,
        snippet: "const alias = statement;",
      },
    ]);
  });

  it("finds a new execute call that reuses an existing interpolated template", () => {
    const text = source([
      "const statement = `SELECT * FROM records WHERE id = ${recordId}`;",
      "database.execute(statement);",
    ]);

    expect(findRawSqlInterpolationViolations(FILE, text, new Set([2]))).toEqual(
      [
        {
          file: FILE,
          line: 2,
          snippet: "database.execute(statement);",
        },
      ],
    );
  });

  it("skips tracing calls that cannot reach an execute sink", () => {
    // Each step reads the two before it inside a loop, so tracing every path
    // through the reassignments doubles per step. A helper that never executes
    // SQL must not trigger that trace, or a large file never finishes.
    const steps = 32;
    const text = source([
      "declare const seed: string;",
      "function note(value: string) { return value.length; }",
      ...Array.from(
        { length: steps },
        (_, index) => `let step${index}: string = seed;`,
      ),
      "while (true) {",
      ...Array.from(
        { length: steps - 1 },
        (_, index) =>
          `  if (seed.length > ${index + 1}) step${index + 1} = step${index} + step${Math.max(0, index - 1)} + seed;`,
      ),
      `  note(step${steps - 1});`,
      "  if (seed) break;",
      "}",
      'database.execute("SELECT 1");',
    ]);

    expect(findRawSqlInterpolationViolations(FILE, text, new Set([1]))).toEqual(
      [],
    );
  });

  it("finds an unsafe template source flowing into an unchanged execute sink", () => {
    const text = source([
      "declare const name: string;",
      "const where = `WHERE owner_email = '${name}'`;",
      "database.execute(`SELECT * FROM accounts ${where}`);",
    ]);

    expect(findRawSqlInterpolationViolations(FILE, text, new Set([2]))).toEqual(
      [
        {
          file: FILE,
          line: 2,
          snippet: "const where = `WHERE owner_email = '${name}'`;",
        },
      ],
    );
  });

  it("traces a keyword-free exported SQL helper into an unchanged module sink", () => {
    const helperFile = "packages/core/src/sql-helpers.ts";
    const storeFile = "packages/core/src/store.ts";
    const helper = [
      "export function ownerFilter(ownerId: string) {",
      "  return `owner_id = '${ownerId}'`;",
      "}",
    ].join("\n");
    const store = source([
      'import { ownerFilter } from "./sql-helpers.js";',
      "database.execute(`SELECT * FROM records ${ownerFilter(ownerId)}`);",
    ]);

    expect(
      findChangedSqlHelperExports(helper, helperFile, new Set([2])),
    ).toEqual(new Set(["ownerFilter"]));
    expect(
      findRawSqlInterpolationViolationsInSources(
        new Map([
          [helperFile, { source: helper, addedLines: new Set([2]) }],
          [storeFile, { source: store, addedLines: new Set<number>() }],
        ]),
      ),
    ).toEqual([
      {
        file: helperFile,
        line: 2,
        snippet: "return `owner_id = '${ownerId}'`;",
      },
    ]);
  });

  it("traces an exported SQL helper built with string concatenation", () => {
    const helperFile = "packages/core/src/sql-helpers.ts";
    const storeFile = "packages/core/src/store.ts";
    const helper = [
      "export function ownerFilter(ownerId: string) {",
      '  return "owner_id = \'" + ownerId + "\'";',
      "}",
    ].join("\n");
    const store = source([
      'import { ownerFilter } from "./sql-helpers.js";',
      "database.execute(`SELECT * FROM records WHERE ${ownerFilter(ownerId)}`);",
    ]);

    expect(
      findChangedSqlHelperExports(helper, helperFile, new Set([2])),
    ).toEqual(new Set(["ownerFilter"]));
    expect(
      findRawSqlInterpolationViolationsInSources(
        new Map([
          [helperFile, { source: helper, addedLines: new Set([2]) }],
          [storeFile, { source: store, addedLines: new Set<number>() }],
        ]),
      ),
    ).toEqual([
      {
        file: helperFile,
        line: 2,
        snippet: 'return "owner_id = \'" + ownerId + "\'";',
      },
    ]);
  });

  it("traces an exported SQL helper that returns a dynamic value directly", () => {
    const helperFile = "packages/core/src/sql-helpers.ts";
    const storeFile = "packages/core/src/store.ts";
    const helper = [
      "export function ownerFilter(ownerId: string) {",
      "  return ownerId;",
      "}",
    ].join("\n");
    const store = source([
      'import { ownerFilter } from "./sql-helpers.js";',
      "database.execute(`SELECT * FROM records WHERE ${ownerFilter(ownerId)}`);",
    ]);

    expect(
      findChangedSqlHelperExports(helper, helperFile, new Set([2])),
    ).toEqual(new Set(["ownerFilter"]));
    expect(
      findRawSqlInterpolationViolationsInSources(
        new Map([
          [helperFile, { source: helper, addedLines: new Set([2]) }],
          [storeFile, { source: store, addedLines: new Set<number>() }],
        ]),
      ),
    ).toEqual([
      {
        file: helperFile,
        line: 2,
        snippet: "return ownerId;",
      },
    ]);
  });

  it("traces exported SQL helpers that return reassigned local strings", () => {
    const helperFile = "packages/core/src/sql-helpers.ts";
    const storeFile = "packages/core/src/store.ts";
    const helper = [
      "export function ownerFilter(ownerId: string) {",
      '  let clause = "";',
      "  clause += ownerId;",
      "  return clause;",
      "}",
    ].join("\n");
    const store = source([
      'import { ownerFilter } from "./sql-helpers.js";',
      "database.execute(`SELECT * FROM records ${ownerFilter(ownerId)}`);",
    ]);

    expect(
      findRawSqlInterpolationViolationsInSources(
        new Map([
          [helperFile, { source: helper, addedLines: new Set([3]) }],
          [storeFile, { source: store, addedLines: new Set<number>() }],
        ]),
      ),
    ).toEqual([
      {
        file: helperFile,
        line: 3,
        snippet: "clause += ownerId;",
      },
    ]);
  });

  it("traces exported SQL helpers through export-list aliases", () => {
    const helperFile = "packages/core/src/sql-helpers.ts";
    const storeFile = "packages/core/src/store.ts";
    const helper = [
      "function ownerFilter(ownerId: string) {",
      "  return `owner_id = ${ownerId}`;",
      "}",
      "export { ownerFilter as ownerPredicate };",
    ].join("\n");
    const store = source([
      'import { ownerPredicate } from "./sql-helpers.js";',
      "database.execute(`SELECT * FROM records WHERE ${ownerPredicate(ownerId)}`);",
    ]);

    expect(
      findChangedSqlHelperExports(helper, helperFile, new Set([2])),
    ).toEqual(new Set(["ownerPredicate"]));
    expect(
      findRawSqlInterpolationViolationsInSources(
        new Map([
          [helperFile, { source: helper, addedLines: new Set([2]) }],
          [storeFile, { source: store, addedLines: new Set<number>() }],
        ]),
      ),
    ).toEqual([
      {
        file: helperFile,
        line: 2,
        snippet: "return `owner_id = ${ownerId}`;",
      },
    ]);
  });

  it("traces an exported SQL helper into JavaScript callers", () => {
    const helperFile = "packages/core/src/sql-helpers.ts";
    const storeFile = "packages/core/src/store.js";
    const helper = [
      "export function ownerFilter(ownerId: string) {",
      "  return `owner_id = ${ownerId}`;",
      "}",
    ].join("\n");
    const store = source([
      'import { ownerFilter } from "./sql-helpers.js";',
      "database.execute(`SELECT * FROM records WHERE ${ownerFilter(ownerId)}`);",
    ]);

    expect(
      findRawSqlInterpolationViolationsInSources(
        new Map([
          [helperFile, { source: helper, addedLines: new Set([2]) }],
          [storeFile, { source: store, addedLines: new Set<number>() }],
        ]),
      ),
    ).toEqual([
      {
        file: helperFile,
        line: 2,
        snippet: "return `owner_id = ${ownerId}`;",
      },
    ]);
  });

  it("reports a new interpolated string passed to an unchanged execute wrapper", () => {
    const wrapperFile = "packages/core/src/sql-helpers.ts";
    const storeFile = "packages/core/src/store.ts";
    const wrapper = [
      'import { getDbExec } from "./db/client.js";',
      "export function runQuery(query: string) {",
      "  getDbExec().execute({ sql: query, args: [] });",
      "}",
    ].join("\n");
    const store = [
      'import { runQuery } from "./sql-helpers.js";',
      "runQuery(`SELECT * FROM records WHERE id = ${recordId}`);",
    ].join("\n");

    expect(
      findRawSqlInterpolationViolationsInSources(
        new Map([
          [wrapperFile, { source: wrapper, addedLines: new Set<number>() }],
          [storeFile, { source: store, addedLines: new Set([2]) }],
        ]),
      ),
    ).toEqual([
      {
        file: storeFile,
        line: 2,
        snippet: "runQuery(`SELECT * FROM records WHERE id = ${recordId}`);",
      },
    ]);
  });

  it("reports a new wrapper call that reuses an unchanged unsafe SQL value", () => {
    const wrapperFile = "packages/core/src/sql-helpers.ts";
    const storeFile = "packages/core/src/store.ts";
    const wrapper = [
      'import { getDbExec } from "./db/client.js";',
      "export function runQuery(query: string) {",
      "  getDbExec().execute({ sql: query, args: [] });",
      "}",
    ].join("\n");
    const store = [
      'import { runQuery } from "./sql-helpers.js";',
      "const query = `SELECT * FROM records WHERE id = ${recordId}`;",
      "runQuery(query);",
    ].join("\n");
    const sources = new Map<string, RawSqlGuardSource>([
      [wrapperFile, { source: wrapper, addedLines: new Set<number>() }],
      [storeFile, { source: store, addedLines: new Set([3]) }],
    ]);

    expect(findRawSqlInterpolationViolationsInSources(sources)).toEqual([
      {
        file: storeFile,
        line: 3,
        snippet: "runQuery(query);",
      },
    ]);
  });

  it("traces a template assigned before an unchanged imported wrapper call", () => {
    const wrapperFile = "packages/core/src/sql-helpers.ts";
    const storeFile = "packages/core/src/store.ts";
    const wrapper = [
      'import { getDbExec } from "./db/client.js";',
      "export function runQuery(query: string) {",
      "  getDbExec().execute({ sql: query, args: [] });",
      "}",
    ].join("\n");
    const store = [
      'import { runQuery } from "./sql-helpers.js";',
      "const statement = `SELECT * FROM records WHERE id = ${recordId}`;",
      "const query = statement;",
      "runQuery(query);",
    ].join("\n");
    const sources = new Map<string, RawSqlGuardSource>([
      [storeFile, { source: store, addedLines: new Set([2]) }],
    ]);
    const wrapperSource = ts.createSourceFile(
      wrapperFile,
      wrapper,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    addChangedSqlExecuteWrapperModules(sources, () => wrapperSource);

    expect(sources.has(resolve(wrapperFile))).toBe(true);
    expect(findRawSqlInterpolationViolationsInSources(sources)).toEqual([
      {
        file: storeFile,
        line: 2,
        snippet:
          "const statement = `SELECT * FROM records WHERE id = ${recordId}`;",
      },
    ]);
  });

  it("discovers an unchanged wrapper from a changed SQL helper caller", () => {
    const fixtureRoot = resolve(process.cwd(), ".tmp");
    mkdirSync(fixtureRoot, { recursive: true });
    const fixtureDir = mkdtempSync(
      resolve(fixtureRoot, "raw-sql-wrapper-discovery-"),
    );
    const helperFile = resolve(fixtureDir, "sql-helpers.ts");
    const callerFile = resolve(fixtureDir, "store.ts");
    const wrapperFile = resolve(fixtureDir, "query-wrapper.ts");
    const helper = [
      "export function ownerFilter(ownerId: string) {",
      "  return `owner_id = ${ownerId}`;",
      "}",
    ].join("\n");
    const caller = [
      'import { ownerFilter } from "./sql-helpers.js";',
      'import { runQuery } from "./query-wrapper.js";',
      "runQuery(`SELECT * FROM records WHERE ${ownerFilter(ownerId)}`);",
    ].join("\n");
    const wrapper = [
      'import { getDbExec } from "@agent-native/core/db";',
      "export function runQuery(query: string) {",
      "  getDbExec().execute({ sql: query, args: [] });",
      "}",
    ].join("\n");

    try {
      writeFileSync(callerFile, caller);
      writeFileSync(wrapperFile, wrapper);
      const sources = new Map<string, RawSqlGuardSource>([
        [helperFile, { source: helper, addedLines: new Set([2]) }],
      ]);

      addChangedSqlCallSiteModules(sources, () => [callerFile]);

      expect(sources.has(callerFile)).toBe(true);
      expect(sources.has(wrapperFile)).toBe(true);
      expect(findRawSqlInterpolationViolationsInSources(sources)).toEqual([
        {
          file: relative(process.cwd(), helperFile),
          line: 2,
          snippet: "return `owner_id = ${ownerId}`;",
        },
      ]);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it("traces imported wrappers that forward SQL through another wrapper", () => {
    const wrapperFile = "packages/core/src/sql-helpers.ts";
    const executorFile = "packages/core/src/query-executor.ts";
    const storeFile = "packages/core/src/store.ts";
    const wrapper = [
      'import { executeQuery } from "./query-executor.js";',
      'import { logValue } from "./logger.js";',
      "export function runQuery(query: string) {",
      "  executeQuery(query);",
      "}",
      "function unrelated(value: string) {",
      "  logValue(value);",
      "}",
    ].join("\n");
    const executor = [
      'import { getDbExec } from "./db/client.js";',
      "export function executeQuery(query: string) {",
      "  getDbExec().execute({ sql: query, args: [] });",
      "}",
    ].join("\n");
    const store = [
      'import { runQuery } from "./sql-helpers.js";',
      "runQuery(`SELECT * FROM records WHERE id = ${recordId}`);",
    ].join("\n");
    const modules = new Map([
      [
        "./sql-helpers.js",
        ts.createSourceFile(
          wrapperFile,
          wrapper,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS,
        ),
      ],
      [
        "./query-executor.js",
        ts.createSourceFile(
          executorFile,
          executor,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS,
        ),
      ],
    ]);
    const sources = new Map<string, RawSqlGuardSource>([
      [storeFile, { source: store, addedLines: new Set([2]) }],
    ]);
    const resolvedModules: string[] = [];

    addChangedSqlExecuteWrapperModules(sources, (moduleName) => {
      resolvedModules.push(moduleName);
      return modules.get(moduleName);
    });

    expect(sources.has(resolve(wrapperFile))).toBe(true);
    expect(sources.has(resolve(executorFile))).toBe(true);
    expect(sources.has(resolve("packages/core/src/logger.ts"))).toBe(false);
    expect(resolvedModules).not.toContain("./logger.js");
    expect(findRawSqlInterpolationViolationsInSources(sources)).toEqual([
      {
        file: storeFile,
        line: 2,
        snippet: "runQuery(`SELECT * FROM records WHERE id = ${recordId}`);",
      },
    ]);
  });

  it("re-traces a nested wrapper used at multiple call sites", () => {
    const wrapperFile = "packages/core/src/sql-helpers.ts";
    const storeFile = "packages/core/src/store.ts";
    const wrapper = [
      'import { getDbExec } from "./db/client.js";',
      "function executeQuery(query: string) {",
      "  getDbExec().execute({ sql: query, args: [] });",
      "}",
      "export function runQuery(query: string) {",
      '  executeQuery("fixed SQL");',
      "  executeQuery(query);",
      "}",
    ].join("\n");
    const store = [
      'import { runQuery } from "./sql-helpers.js";',
      "runQuery(`SELECT * FROM records WHERE id = ${recordId}`);",
    ].join("\n");

    expect(
      findRawSqlInterpolationViolationsInSources(
        new Map([
          [wrapperFile, { source: wrapper, addedLines: new Set<number>() }],
          [storeFile, { source: store, addedLines: new Set([2]) }],
        ]),
      ),
    ).toEqual([
      {
        file: storeFile,
        line: 2,
        snippet: "runQuery(`SELECT * FROM records WHERE id = ${recordId}`);",
      },
    ]);
  });

  it("traces each callsite when a wrapper is reused", () => {
    const wrapperFile = "packages/core/src/sql-helpers.ts";
    const storeFile = "packages/core/src/store.ts";
    const wrapper = [
      'import { getDbExec } from "./db/client.js";',
      "export function runQuery(query: string) {",
      "  getDbExec().execute({ sql: query, args: [] });",
      "}",
    ].join("\n");
    const store = [
      'import { runQuery } from "./sql-helpers.js";',
      "runQuery(`SELECT * FROM records WHERE id = ${firstId}`);",
      "runQuery(`SELECT * FROM records WHERE id = ${secondId}`);",
    ].join("\n");

    expect(
      findRawSqlInterpolationViolationsInSources(
        new Map([
          [wrapperFile, { source: wrapper, addedLines: new Set<number>() }],
          [storeFile, { source: store, addedLines: new Set([2, 3]) }],
        ]),
      ),
    ).toEqual([
      {
        file: storeFile,
        line: 2,
        snippet: "runQuery(`SELECT * FROM records WHERE id = ${firstId}`);",
      },
      {
        file: storeFile,
        line: 3,
        snippet: "runQuery(`SELECT * FROM records WHERE id = ${secondId}`);",
      },
    ]);
  });

  it("traces unsafe SQL through mutually recursive wrappers", () => {
    const wrapperFile = "packages/core/src/sql-helpers.ts";
    const storeFile = "packages/core/src/store.ts";
    const wrapper = [
      'import { getDbExec } from "./db/client.js";',
      "function first(query: string) {",
      "  second(query);",
      "  getDbExec().execute({ sql: query, args: [] });",
      "}",
      "function second(query: string) {",
      "  first(query);",
      "}",
      "export function runQuery(query: string) {",
      '  first("fixed SQL");',
      "  second(query);",
      "}",
    ].join("\n");
    const store = [
      'import { runQuery } from "./sql-helpers.js";',
      "runQuery(`SELECT * FROM records WHERE id = ${recordId}`);",
    ].join("\n");

    expect(
      findRawSqlInterpolationViolationsInSources(
        new Map([
          [wrapperFile, { source: wrapper, addedLines: new Set<number>() }],
          [storeFile, { source: store, addedLines: new Set([2]) }],
        ]),
      ),
    ).toEqual([
      {
        file: storeFile,
        line: 2,
        snippet: "runQuery(`SELECT * FROM records WHERE id = ${recordId}`);",
      },
    ]);
  });

  it("traces namespace element calls through re-exported wrappers", () => {
    const wrapperFile = "packages/core/src/sql-helpers.ts";
    const executorFile = "packages/core/src/query-executor.ts";
    const storeFile = "packages/core/src/store.ts";
    const wrapper =
      'export { executeQuery as runQuery } from "./query-executor.js";';
    const executor = [
      'import { getDbExec } from "./db/client.js";',
      "export function executeQuery(query: string) {",
      "  getDbExec().execute({ sql: query, args: [] });",
      "}",
    ].join("\n");
    const store = [
      'import * as helpers from "./sql-helpers.js";',
      'helpers["runQuery"](`SELECT * FROM records WHERE id = ${recordId}`);',
    ].join("\n");
    const modules = new Map([
      [
        "./sql-helpers.js",
        ts.createSourceFile(
          wrapperFile,
          wrapper,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS,
        ),
      ],
      [
        "./query-executor.js",
        ts.createSourceFile(
          executorFile,
          executor,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS,
        ),
      ],
    ]);
    const sources = new Map<string, RawSqlGuardSource>([
      [storeFile, { source: store, addedLines: new Set([2]) }],
    ]);

    addChangedSqlExecuteWrapperModules(sources, (moduleName) =>
      modules.get(moduleName),
    );

    expect(sources.has(resolve(wrapperFile))).toBe(true);
    expect(sources.has(resolve(executorFile))).toBe(true);
    expect(findRawSqlInterpolationViolationsInSources(sources)).toEqual([
      {
        file: storeFile,
        line: 2,
        snippet:
          'helpers["runQuery"](`SELECT * FROM records WHERE id = ${recordId}`);',
      },
    ]);
  });

  it("traces rest parameters forwarded directly to execute", () => {
    const wrapperFile = "packages/core/src/sql-helpers.ts";
    const storeFile = "packages/core/src/store.ts";
    const wrapper = [
      'import { getDbExec } from "./db/client.js";',
      "export function runQuery(...args: string[]) {",
      "  getDbExec().execute(...args);",
      "}",
    ].join("\n");
    const store = [
      'import { runQuery } from "./sql-helpers.js";',
      'runQuery("safe", `SELECT * FROM records WHERE id = ${recordId}`);',
    ].join("\n");
    const sources = new Map<string, RawSqlGuardSource>([
      [storeFile, { source: store, addedLines: new Set([2]) }],
    ]);
    const wrapperSource = ts.createSourceFile(
      wrapperFile,
      wrapper,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    addChangedSqlExecuteWrapperModules(sources, () => wrapperSource);

    expect(findRawSqlInterpolationViolationsInSources(sources)).toEqual([
      {
        file: storeFile,
        line: 2,
        snippet:
          'runQuery("safe", `SELECT * FROM records WHERE id = ${recordId}`);',
      },
    ]);
  });

  it("treats imported execute receivers and imported factories as SQL sinks", () => {
    const direct = [
      'import { exec } from "./database.js";',
      "exec.execute(`SELECT * FROM records WHERE id = ${recordId}`);",
    ].join("\n");
    const factory = [
      'import { getExec } from "./database.js";',
      "getExec().execute(`SELECT * FROM records WHERE id = ${recordId}`);",
    ].join("\n");

    expect(
      findRawSqlInterpolationViolations(FILE, direct, new Set([2])),
    ).toHaveLength(1);
    expect(
      findRawSqlInterpolationViolations(FILE, factory, new Set([2])),
    ).toHaveLength(1);
  });

  it("recognizes type-cast execute callees", () => {
    const text = source([
      "const database = getDbExec();",
      "(database.execute as typeof database.execute)(`SELECT * FROM records WHERE id = ${recordId}`);",
    ]);

    expect(findRawSqlInterpolationViolations(FILE, text, new Set([2]))).toEqual(
      [
        {
          file: FILE,
          line: 2,
          snippet:
            "(database.execute as typeof database.execute)(`SELECT * FROM records WHERE id = ${recordId}`);",
        },
      ],
    );
  });

  it("does not load wrappers for unchanged templates after unrelated edits", () => {
    const wrapperFile = "packages/core/src/sql-helpers.ts";
    const storeFile = "packages/core/src/store.ts";
    const wrapper = [
      'import { getDbExec } from "./db/client.js";',
      "export function runQuery(query: string) {",
      "  getDbExec().execute({ sql: query, args: [] });",
      "}",
    ].join("\n");
    const store = [
      'import { runQuery } from "./sql-helpers.js";',
      "runQuery(`SELECT * FROM records WHERE id = ${recordId}`);",
      "const unrelated = true;",
    ].join("\n");
    const sources = new Map<string, RawSqlGuardSource>([
      [storeFile, { source: store, addedLines: new Set([3]) }],
    ]);
    const wrapperSource = ts.createSourceFile(
      wrapperFile,
      wrapper,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    let resolutionCount = 0;

    addChangedSqlExecuteWrapperModules(sources, () => {
      resolutionCount += 1;
      return wrapperSource;
    });

    expect(resolutionCount).toBe(0);
    expect(sources.has(resolve(wrapperFile))).toBe(false);
  });

  it("traces exported SQL helpers with local string type aliases", () => {
    const helperFile = "packages/core/src/sql-helpers.ts";
    const storeFile = "packages/core/src/store.ts";
    const helper = [
      "type Column = string;",
      "export function ownerFilter(ownerId: Column) {",
      "  return ownerId;",
      "}",
    ].join("\n");
    const store = source([
      'import { ownerFilter } from "./sql-helpers.js";',
      "database.execute(`SELECT * FROM records WHERE ${ownerFilter(ownerId)}`);",
    ]);

    expect(
      findRawSqlInterpolationViolationsInSources(
        new Map([
          [helperFile, { source: helper, addedLines: new Set([3]) }],
          [storeFile, { source: store, addedLines: new Set<number>() }],
        ]),
      ),
    ).toEqual([
      {
        file: helperFile,
        line: 3,
        snippet: "return ownerId;",
      },
    ]);
  });

  it("traces generic SQL helpers constrained to string", () => {
    const helper = source([
      "export function passthrough<T extends string>(value: T) {",
      "  return value;",
      "}",
      "database.execute(`SELECT * FROM records WHERE id = ${passthrough(recordId)}`);",
    ]);

    expect(findChangedSqlHelperExports(helper, FILE, new Set([2]))).toEqual(
      new Set(["passthrough"]),
    );
    expect(
      findRawSqlInterpolationViolations(FILE, helper, new Set([2])),
    ).toHaveLength(1);
  });

  it("traces SQL passed through the PostgreSQL placeholder formatter", () => {
    const formatterFile = "packages/core/src/db/client.ts";
    const storeFile = "packages/core/src/store.ts";
    const formatter = [
      "export function toPostgresParams(sql: string) {",
      '  let out = "";',
      "  for (const character of sql) {",
      "    out += character;",
      "  }",
      "  return out;",
      "}",
    ].join("\n");
    const store = source([
      'import { toPostgresParams } from "./db/client.js";',
      "database.execute(toPostgresParams(`SELECT * FROM records WHERE id = ${recordId}`));",
    ]);

    expect(
      findRawSqlInterpolationViolationsInSources(
        new Map([
          [formatterFile, { source: formatter, addedLines: new Set<number>() }],
          [storeFile, { source: store, addedLines: new Set([2]) }],
        ]),
      ),
    ).toEqual([
      {
        file: storeFile,
        line: 2,
        snippet:
          "database.execute(toPostgresParams(`SELECT * FROM records WHERE id = ${recordId}`));",
      },
    ]);
  });

  it("does not register an exported helper for strings used only in a log", () => {
    const helper = [
      "export function logOwner(ownerId: string) {",
      "  console.log(`owner ${ownerId}`);",
      "}",
    ].join("\n");

    expect(
      findChangedSqlHelperExports(
        helper,
        "packages/core/src/sql-helpers.ts",
        new Set([2]),
      ),
    ).toEqual(new Set());
  });

  it("does not classify a returned object by its unrelated string fields", () => {
    const helper = [
      "export function makeDefinition(ownerId: string) {",
      "  return { name: ownerId, run: () => `owner ${ownerId}` };",
      "}",
    ].join("\n");

    expect(
      findChangedSqlHelperExports(
        helper,
        "packages/core/src/sql-helpers.ts",
        new Set([2]),
      ),
    ).toEqual(new Set());
  });

  it("registers a returned SQL object property with a dynamic value", () => {
    const helper = [
      "export function queryFor(ownerId: string) {",
      "  return { sql: `SELECT * FROM records WHERE owner_id = '${ownerId}'` };",
      "}",
    ].join("\n");

    expect(
      findChangedSqlHelperExports(
        helper,
        "packages/core/src/sql-helpers.ts",
        new Set([2]),
      ),
    ).toEqual(new Set(["queryFor"]));
  });

  it("finds an interpolated template aliased into a sql property", () => {
    const text = source([
      "const statement = `SELECT * FROM records WHERE id = ${recordId}`;",
      "const query = { sql: statement };",
    ]);

    expect(findRawSqlInterpolationViolations(FILE, text, new Set([2]))).toEqual(
      [
        {
          file: FILE,
          line: 2,
          snippet: "const query = { sql: statement };",
        },
      ],
    );
  });

  it("rechecks the following sink after a preceding pragma was removed", () => {
    const diff = [
      `diff --git a/${FILE} b/${FILE}`,
      "index 1111111..2222222 100644",
      `--- a/${FILE}`,
      `+++ b/${FILE}`,
      "@@ -2 +1,0 @@",
      "-// raw-sql-ok: old exception",
    ].join("\n");
    const removed = parseRemovedLines(diff, process.cwd());
    const entry = removed?.get(resolve(FILE));
    if (!entry) throw new Error("Expected the removed pragma diff entry.");
    const removedPragmaLines = removedPragmaAffectedLines(entry.lines);
    const text = source([
      "const unchanged = true;",
      "database.execute(`SELECT * FROM records WHERE id = ${recordId}`);",
    ]);

    expect([...removedPragmaLines]).toEqual([1, 2]);
    expect(
      findRawSqlInterpolationViolationsInSources(
        new Map([
          [
            FILE,
            {
              source: text,
              addedLines: new Set<number>(),
              removedPragmaLines,
            },
          ],
        ]),
      ),
    ).toEqual([
      {
        file: FILE,
        line: 2,
        snippet:
          "database.execute(`SELECT * FROM records WHERE id = ${recordId}`);",
      },
    ]);
  });

  it("checks an overloaded SQL helper implementation before its alias", () => {
    const helperFile = "packages/core/src/sql-helpers.ts";
    const helper = [
      "function ownerFilter(ownerId: string): string;",
      "function ownerFilter(ownerId: string) {",
      "  return `owner_id = ${ownerId}`;",
      "}",
      "export { ownerFilter as ownerPredicate };",
    ].join("\n");

    expect(
      findChangedSqlHelperExports(helper, helperFile, new Set([3])),
    ).toEqual(new Set(["ownerPredicate"]));
  });

  it("resolves an explicit JavaScript wrapper when no TypeScript sibling exists", () => {
    const sourceFile = resolveImportedSourceFile(
      "./agent-friction-report.mjs",
      resolve(process.cwd(), "scripts/guard-no-raw-sql-interpolation.test.ts"),
    );

    expect(sourceFile?.fileName).toBe(
      resolve(process.cwd(), "scripts/agent-friction-report.mjs"),
    );
  });

  it("tracks interpolated templates assigned after variable declaration", () => {
    const text = source([
      'let statement = "";',
      "statement = `SELECT * FROM records WHERE id = ${recordId}`;",
      "database.execute(statement);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([1, 2, 3])),
    ).toEqual([
      {
        file: FILE,
        line: 2,
        snippet: "statement = `SELECT * FROM records WHERE id = ${recordId}`;",
      },
    ]);
  });

  it("tracks raw strings appended with compound assignment", () => {
    const text = source([
      "declare const userId: string;",
      'let statement = "SELECT * FROM records WHERE id = ";',
      "statement += userId;",
      "database.execute(statement);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([3])),
    ).toHaveLength(1);
  });

  it("attributes a new compound assignment even when its sink is unchanged", () => {
    const text = source([
      "declare const userId: string;",
      'let statement = "SELECT * FROM records WHERE id = ";',
      "statement += userId;",
      "database.execute(statement);",
    ]);

    expect(findRawSqlInterpolationViolations(FILE, text, new Set([3]))).toEqual(
      [
        {
          file: FILE,
          line: 3,
          snippet: "statement += userId;",
        },
      ],
    );
  });

  it("attributes a plain assignment from an existing string source", () => {
    const text = source([
      "declare const input: string;",
      'let statement = "SELECT 1";',
      "statement = input;",
      "database.execute(statement);",
    ]);

    expect(findRawSqlInterpolationViolations(FILE, text, new Set([3]))).toEqual(
      [
        {
          file: FILE,
          line: 3,
          snippet: "statement = input;",
        },
      ],
    );
  });

  it("clears branch taint after a later unconditional static overwrite", () => {
    const text = source([
      "declare const enabled: boolean;",
      "declare const userId: string;",
      "let statement = `SELECT * FROM records WHERE id = ${userId}`;",
      "if (enabled) {",
      "  statement = `SELECT * FROM records WHERE id = ${userId}`;",
      "}",
      'statement = "SELECT 1";',
      "database.execute(statement);",
    ]);

    expect(
      findRawSqlInterpolationViolations(
        FILE,
        text,
        new Set([1, 2, 3, 4, 5, 6, 7, 8]),
      ),
    ).toEqual([]);
  });

  it("handles expression-bodied compound assignments without recursion", () => {
    const text = source([
      "declare const userId: string;",
      'let statement = "SELECT * FROM records";',
      "const appendUserId = () => (statement += userId);",
      "database.execute(statement);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([3])),
    ).toHaveLength(1);
  });

  it("includes writes carried around a loop back edge", () => {
    const text = source([
      "declare const again: boolean;",
      "declare const userId: string;",
      'let statement = "SELECT * FROM records";',
      "while (again) {",
      "  database.execute(statement);",
      "  statement += userId;",
      "}",
    ]);

    expect(findRawSqlInterpolationViolations(FILE, text, new Set([6]))).toEqual(
      [
        {
          file: FILE,
          line: 6,
          snippet: "statement += userId;",
        },
      ],
    );
  });

  it("tracks values assigned through for-of and for-in loops", () => {
    const forOf = source([
      "declare const queries: string[];",
      'let statement = "SELECT * FROM records";',
      "for (statement of queries) {}",
      "database.execute(statement);",
    ]);
    const forIn = source([
      "declare const records: Record<string, number>;",
      'let statement = "SELECT * FROM records";',
      "for (statement in records) {}",
      "database.execute(statement);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, forOf, new Set([3])),
    ).toHaveLength(1);
    expect(
      findRawSqlInterpolationViolations(FILE, forIn, new Set([3])),
    ).toHaveLength(1);
  });

  it("tracks object and array destructuring writes", () => {
    const object = source([
      "declare const userId: string;",
      'let statement = "SELECT * FROM records";',
      "({ statement } = { statement: `SELECT * FROM records WHERE id = ${userId}` });",
      "database.execute(statement);",
    ]);
    const array = source([
      "declare const userId: string;",
      'let statement = "SELECT * FROM records";',
      "[statement] = [`SELECT * FROM records WHERE id = ${userId}`];",
      "database.execute(statement);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, object, new Set([3])),
    ).toHaveLength(1);
    expect(
      findRawSqlInterpolationViolations(FILE, array, new Set([3])),
    ).toHaveLength(1);
  });

  it("tracks mutations of the SQL field through object aliases", () => {
    const direct = source([
      "declare const userId: string;",
      'const query: { sql: string; args: unknown[] } = { sql: "SELECT 1", args: [] };',
      "query.sql = `SELECT * FROM records WHERE id = ${userId}`;",
      "database.execute(query);",
    ]);
    const alias = source([
      "declare const userId: string;",
      'const query: { sql: string; args: unknown[] } = { sql: "SELECT 1", args: [] };',
      "const alias = query;",
      'alias["sql"] = `SELECT * FROM records WHERE id = ${userId}`;',
      "database.execute(query);",
    ]);
    const compound = source([
      "declare const userId: string;",
      'const query: { sql: string; args: unknown[] } = { sql: "SELECT 1", args: [] };',
      "query.sql += userId;",
      "database.execute(query);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, direct, new Set([3])),
    ).toHaveLength(1);
    expect(
      findRawSqlInterpolationViolations(FILE, alias, new Set([4])),
    ).toHaveLength(1);
    expect(
      findRawSqlInterpolationViolations(FILE, compound, new Set([3])),
    ).toHaveLength(1);
  });

  it("flags new unsafe SQL-property writes on nested or destructured objects", () => {
    const nested = source([
      "declare const userId: string;",
      'const holder = { query: { sql: "SELECT 1", args: [] as unknown[] } };',
      "holder.query.sql = `SELECT * FROM records WHERE id = ${userId}`;",
      "database.execute(holder.query);",
    ]);
    const destructured = source([
      "declare const userId: string;",
      'const query = { sql: "SELECT 1", args: [] as unknown[] };',
      "const { query: alias } = { query };",
      "alias.sql = `SELECT * FROM records WHERE id = ${userId}`;",
      "database.execute(query);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, nested, new Set([3])),
    ).toHaveLength(1);
    expect(
      findRawSqlInterpolationViolations(FILE, destructured, new Set([4])),
    ).toHaveLength(1);
  });

  it("recognizes parenthesized and asserted static SQL property names", () => {
    const parenthesized = source([
      "declare const userId: string;",
      'const query: { sql: string; args: unknown[] } = { sql: "SELECT 1", args: [] };',
      'query[("sql")] = `SELECT * FROM records WHERE id = ${userId}`;',
    ]);
    const asserted = source([
      "declare const userId: string;",
      'const query: { sql: string; args: unknown[] } = { sql: "SELECT 1", args: [] };',
      'query["sql" as const] = `SELECT * FROM records WHERE id = ${userId}`;',
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, parenthesized, new Set([3])),
    ).toHaveLength(1);
    expect(
      findRawSqlInterpolationViolations(FILE, asserted, new Set([3])),
    ).toHaveLength(1);
  });

  it("catches interpolated tagged templates outside the SQL fragment tag", () => {
    const text = source([
      "const statement = String.raw`SELECT * FROM records WHERE id = ${recordId}`;",
      "database.execute(statement);",
      "database.execute(String.raw`DELETE FROM records WHERE id = ${recordId}`);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([1, 2, 3])),
    ).toEqual([
      {
        file: FILE,
        line: 1,
        snippet:
          "const statement = String.raw`SELECT * FROM records WHERE id = ${recordId}`;",
      },
      {
        file: FILE,
        line: 3,
        snippet:
          "database.execute(String.raw`DELETE FROM records WHERE id = ${recordId}`);",
      },
    ]);
  });

  it("tracks raw SQL string concatenation and local helper returns", () => {
    const concatenated = source([
      'const statement = "SELECT * FROM records WHERE id = " + recordId;',
      "database.execute(statement);",
    ]);
    const helper = source([
      "function buildQuery(recordId: string) {",
      "  return `SELECT * FROM records WHERE id = ${recordId}`;",
      "}",
      "database.execute(buildQuery(recordId));",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, concatenated, new Set([1, 2])),
    ).toHaveLength(1);
    expect(
      findRawSqlInterpolationViolations(FILE, helper, new Set([1, 2, 3, 4])),
    ).toHaveLength(1);
  });

  it("finds shorthand and computed sql properties", () => {
    const text = source([
      "const sql = `SELECT * FROM records WHERE id = ${recordId}`;",
      "database.execute({ sql });",
      'database.execute({ ["sql"]: sql });',
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([2, 3])),
    ).toEqual([
      {
        file: FILE,
        line: 2,
        snippet: "database.execute({ sql });",
      },
      {
        file: FILE,
        line: 3,
        snippet: 'database.execute({ ["sql"]: sql });',
      },
    ]);
  });

  it("does not carry taint past a later static assignment", () => {
    const text = source([
      "let statement = `SELECT * FROM records WHERE id = ${recordId}`;",
      'statement = "SELECT * FROM records";',
      "database.execute(statement);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([1, 2, 3])),
    ).toEqual([]);
  });

  it("keeps taint from earlier values when a branch may not replace them", () => {
    const text = source([
      "declare const enabled: boolean;",
      "declare const userId: string;",
      "let statement = `SELECT * FROM records WHERE id = ${userId}`;",
      "if (enabled) {",
      '  statement = "SELECT * FROM records";',
      "}",
      "database.execute(statement);",
    ]);

    expect(
      findRawSqlInterpolationViolations(
        FILE,
        text,
        new Set([1, 2, 3, 4, 5, 6, 7]),
      ),
    ).toHaveLength(1);
  });

  it("keeps taint from closure assignments despite later textual writes", () => {
    const text = source([
      "declare const userId: string;",
      'let statement = "SELECT * FROM records";',
      "const replace = () => {",
      "  statement = `SELECT * FROM records WHERE id = ${userId}`;",
      "};",
      'statement = "SELECT * FROM records";',
      "replace();",
      "database.execute(statement);",
    ]);

    expect(
      findRawSqlInterpolationViolations(
        FILE,
        text,
        new Set([1, 2, 3, 4, 5, 6, 7, 8]),
      ),
    ).toHaveLength(1);
  });

  it("tracks writes before a deferred sink call despite source order", () => {
    const text = source([
      "declare const userId: string;",
      'let statement = "SELECT * FROM records";',
      "function runQuery() {",
      "  database.execute(statement);",
      "}",
      "statement = `SELECT * FROM records WHERE id = ${userId}`;",
      "runQuery();",
    ]);

    expect(
      findRawSqlInterpolationViolations(
        FILE,
        text,
        new Set([1, 2, 3, 4, 5, 6, 7]),
      ),
    ).toHaveLength(1);
  });

  it("treats union types containing strings as potentially raw SQL", () => {
    const text = source([
      "type Query = string | { sql: string; args: unknown[] };",
      "declare const query: Query;",
      "database.execute(query);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([1, 2, 3])),
    ).toHaveLength(1);
  });

  it("leaves tagged SQL fragments to the tag's binding rules", () => {
    const text = source([
      'import { sql } from "./db/sql.js";',
      "const statement = sql`SELECT * FROM records WHERE id = ${recordId}`;",
      "database.execute(statement);",
      "database.execute(sql.in([recordId]));",
      'database.execute(sql.ident("id"));',
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([1, 2, 3, 4, 5])),
    ).toEqual([]);
  });

  it("recognizes safe SQL tags and helpers from a core namespace import", () => {
    const safe = source([
      'import * as db from "./db/index.js";',
      "const statement = db.sql`SELECT * FROM records WHERE id = ${db.sql.value(recordId)}`;",
      "database.execute(statement);",
    ]);
    const unrelated = source([
      'import * as db from "./other.js";',
      "const statement = db.sql`SELECT * FROM records WHERE id = ${recordId}`;",
      "database.execute(statement);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, safe, new Set([2, 3])),
    ).toEqual([]);
    expect(
      findRawSqlInterpolationViolations(FILE, unrelated, new Set([2, 3])),
    ).toHaveLength(1);
  });

  it("only trusts sqlIn calls on a locally defined state machine", () => {
    const safe = source([
      'import { defineMachine } from "./state-machine/index.js";',
      "const machine = defineMachine({",
      '  id: "run",',
      '  states: ["queued", "done"],',
      '  initial: "queued",',
      '  terminal: ["done"],',
      '  transitions: { finish: { from: ["queued"], to: "done" } },',
      "});",
      'database.execute(machine.sqlIn("finish"));',
    ]);
    const unsafe = source([
      "declare const userId: string;",
      "declare const helper: { sqlIn(value: string): string };",
      "database.execute(helper.sqlIn(userId));",
    ]);
    const reassigned = source([
      'import { defineMachine } from "./state-machine/index.js";',
      "declare const userId: string;",
      "declare const helper: { sqlIn(value: string): string };",
      "let machine = defineMachine({",
      '  id: "run",',
      '  states: ["queued", "done"],',
      '  initial: "queued",',
      '  terminal: ["done"],',
      '  transitions: { finish: { from: ["queued"], to: "done" } },',
      "});",
      "machine = helper;",
      "database.execute(machine.sqlIn(userId));",
    ]);

    expect(findRawSqlInterpolationViolations(FILE, safe, new Set([9]))).toEqual(
      [],
    );
    expect(
      findRawSqlInterpolationViolations(FILE, unsafe, new Set([3])),
    ).toHaveLength(1);
    expect(
      findRawSqlInterpolationViolations(FILE, reassigned, new Set([12])),
    ).toHaveLength(1);
  });

  it("recognizes exact imported SqlFragment annotations", () => {
    const text = source([
      'import type { SqlFragment } from "./db/sql.js";',
      "declare const query: SqlFragment;",
      "database.execute(query);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([1, 2, 3])),
    ).toEqual([]);
  });

  it("recognizes pure imported fragment aliases without trusting raw casts", () => {
    const safeAlias = source([
      'import type { SqlFragment } from "./db/sql.js";',
      "type Fragment = SqlFragment;",
      "declare const query: Fragment;",
      "database.execute(query);",
    ]);
    const rawCast = source([
      'import type { SqlFragment } from "./db/sql.js";',
      "declare const userId: string;",
      "const raw = `SELECT * FROM records WHERE id = ${userId}`;",
      "const query: SqlFragment = raw as unknown as SqlFragment;",
      "database.execute(query);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, safeAlias, new Set([1, 2, 3, 4])),
    ).toEqual([]);
    expect(
      findRawSqlInterpolationViolations(FILE, rawCast, new Set([4])),
    ).toHaveLength(1);
  });

  it("retains a string parameter's incoming value after conditional writes", () => {
    const text = source([
      "function runQuery(query: string, enabled: boolean) {",
      '  if (enabled) query = "SELECT 1";',
      "  database.execute(query);",
      "}",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([1, 2, 3, 4])),
    ).toHaveLength(1);
  });

  it("ignores unchanged SQL templates and added lines outside the property", () => {
    const text = source([
      "const query = { sql: `SELECT * FROM records WHERE id = ${recordId}` };",
      "const label = 'changed';",
      "const safe = { sql: `SELECT * FROM records` };",
      "const other = { query: `SELECT ${recordId}` };",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([2, 3, 4])),
    ).toEqual([]);
  });

  it("ignores SQL-looking strings, comments, and non-interpolated templates", () => {
    const text = source([
      "// sql: `SELECT ${recordId}`",
      'const label = "sql: `SELECT ${recordId}`";',
      "const query = { sql: `SELECT * FROM records` };",
      'const queryText = { sql: "SELECT ${recordId}" };',
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([1, 2, 3, 4])),
    ).toEqual([]);
  });

  it("accepts a reasoned pragma adjacent to the sink statement", () => {
    const examples = [
      source([
        "// raw-sql-ok: supports reviewed legacy filter clauses",
        "const query = { sql: `SELECT * FROM records WHERE id = ${recordId}` };",
      ]),
      source([
        "/* raw-sql-ok: supports reviewed legacy filter clauses */",
        "const query = { sql: `SELECT * FROM records WHERE id = ${recordId}` };",
      ]),
      source([
        "const query = { sql: `SELECT * FROM records WHERE id = ${recordId}` }; // raw-sql-ok: compatibility query",
      ]),
    ];

    for (const text of examples) {
      const addedLines = new Set(text.split("\n").map((_, index) => index + 1));
      expect(findRawSqlInterpolationViolations(FILE, text, addedLines)).toEqual(
        [],
      );
    }
  });

  it("does not accept a pragma marker inside SQL text or a nested callback", () => {
    const sqlText = source([
      "const query = {",
      "  sql: `SELECT * FROM records WHERE id = ${recordId}",
      "    -- raw-sql-ok: this is SQL text, not a code comment",
      "  `,",
      "};",
    ]);
    const callback = source([
      "const database = getDbExec();",
      "database.execute(`SELECT * FROM records WHERE id = ${recordId}`, () => {",
      "  // raw-sql-ok: this callback comment is not attached to the SQL sink",
      "  return true;",
      "});",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, sqlText, new Set([2, 3, 4])),
    ).toHaveLength(1);
    expect(
      findRawSqlInterpolationViolations(FILE, callback, new Set([2, 3, 4])),
    ).toHaveLength(1);
  });

  it("does not treat a property-level pragma as a statement opt-out", () => {
    const text = source([
      "const query = {",
      "  sql: `SELECT ${recordId}`, // raw-sql-ok: reviewed adapter boundary",
      "  args: [],",
      "};",
      "database.execute(query);",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([2])),
    ).toContainEqual({
      file: FILE,
      line: 2,
      snippet:
        "sql: `SELECT ${recordId}`, // raw-sql-ok: reviewed adapter boundary",
    });
  });

  it("scopes a same-line pragma to the statement it follows", () => {
    const text = source([
      "const reviewed = { sql: `SELECT ${reviewedId}` }; /* raw-sql-ok: reviewed legacy clause */ const unsafe = { sql: `SELECT ${unsafeId}` };",
    ]);

    expect(findRawSqlInterpolationViolations(FILE, text, new Set([1]))).toEqual(
      [
        {
          file: FILE,
          line: 1,
          snippet:
            "const reviewed = { sql: `SELECT ${reviewedId}` }; /* raw-sql-ok: reviewed legacy clause */ const unsafe = { sql: `SELECT ${unsafeId}` };",
        },
      ],
    );
  });

  it("does not let a later same-line pragma suppress an earlier statement", () => {
    const text = source([
      "const unsafe = { sql: `SELECT ${unsafeId}` }; const reviewed = { sql: `SELECT ${reviewedId}` }; // raw-sql-ok: reviewed compatibility clause",
    ]);

    expect(findRawSqlInterpolationViolations(FILE, text, new Set([1]))).toEqual(
      [
        {
          file: FILE,
          line: 1,
          snippet:
            "const unsafe = { sql: `SELECT ${unsafeId}` }; const reviewed = { sql: `SELECT ${reviewedId}` }; // raw-sql-ok: reviewed compatibility clause",
        },
      ],
    );
  });

  it("does not accept an empty pragma reason", () => {
    const text = source([
      "// raw-sql-ok:",
      "const query = { sql: `SELECT * FROM records WHERE id = ${recordId}` };",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([2])),
    ).toHaveLength(1);
  });

  it("does not let a pragma on a preceding code line suppress the sink", () => {
    const text = source([
      "const note = 1; // raw-sql-ok: this only describes the previous line",
      "const query = { sql: `SELECT * FROM records WHERE id = ${recordId}` };",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([2])),
    ).toHaveLength(1);
  });

  it("does not let a block-comment pragma leak past executable code", () => {
    const text = source([
      "/* raw-sql-ok: an executable suffix is not a standalone pragma */ const note = 1;",
      "const query = { sql: `SELECT * FROM records WHERE id = ${recordId}` };",
    ]);

    expect(
      findRawSqlInterpolationViolations(FILE, text, new Set([2])),
    ).toHaveLength(1);
  });

  it("does not treat generated source as application SQL", () => {
    const text = "const query = { sql: `SELECT ${recordId}` };";

    expect(
      findRawSqlInterpolationViolations(
        "packages/core/src/.generated/query.ts",
        text,
        new Set([1]),
      ),
    ).toEqual([]);
  });
});
